"""Aislamiento entre clientes del MISMO tenant (`app/tools.py`).

El exploit que cierran estas pruebas: por WhatsApp, "mi teléfono es 55"
(recordar_cliente) y luego "¿qué pedí la otra vez?" devolvía nombre, correo,
RFC e historial de OTRO cliente del negocio, porque historial_del_cliente
buscaba con el teléfono dicho por el cliente y `GET /customers?q=` hace
`contains`. Ahora la única llave es el teléfono autenticado por el canal
(`runtime.context["customer_phone"]`), comparado de forma exacta.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest

from app import tools
from app.commerce import CommerceError

CHANNEL_PHONE = "5215512345678"
ME = {"id": "c-me", "fullName": "Ana Real", "email": "ana@example.com", "phone": "5215512345678"}
OTHER = {
    "id": "c-other",
    "fullName": "Victima Ajena",
    "email": "victima@example.com",
    "phone": "5599998888",
    "taxId": "VIAJ800101AB1",
}


class FakeCommerce:
    """`GET /customers?q=` con `contains`, igual que commerce-api."""

    def __init__(self, customers: list[dict[str, Any]]) -> None:
        self.customers = customers
        self.queries: list[str] = []
        self.ensure_calls: list[dict[str, Any]] = []
        self.invoices: list[str] = []
        self.invoice_calls: list[dict[str, Any]] = []
        self.invoice_response: dict[str, Any] = {}
        self.quotes = {
            "Q-MINE": {"id": "Q-MINE", "customerId": "c-me", "customer": ME, "status": "ISSUED",
                       "total": "10.00", "expiresAt": "x", "lines": []},
            "Q-OTHER": {"id": "Q-OTHER", "customerId": "c-other", "customer": OTHER, "status": "ISSUED",
                        "total": "99.00", "expiresAt": "x", "lines": []},
        }
        self.orders = {
            "O-MINE": {"id": "O-MINE", "customerId": "c-me", "customer": ME, "status": "PAID", "total": "10.00"},
            "O-OTHER": {"id": "O-OTHER", "customerId": "c-other", "customer": OTHER, "status": "PAID",
                        "total": "99.00"},
        }

    async def find_customer(self, query: str) -> list[dict[str, Any]]:
        self.queries.append(query)
        q = query.lower()
        return [
            c for c in self.customers
            if q in c["fullName"].lower() or q in (c.get("email") or "").lower() or query in (c.get("phone") or "")
        ]

    async def customer_history(self, customer_id: str) -> dict[str, Any]:
        return {"quotes": [{"id": f"Q-{customer_id}", "total": "1", "status": "ISSUED", "createdAt": "d"}],
                "orders": []}

    async def ensure_customer(self, **kwargs: Any) -> dict[str, Any]:
        self.ensure_calls.append(kwargs)
        return {"id": "c-resolved", "fullName": kwargs["full_name"]}

    async def create_quote(self, **_k: Any) -> dict[str, Any]:
        return {"id": "Q-NEW", "total": "10.00"}

    async def share_quote(self, quote_id: str) -> dict[str, Any]:
        return {"url": f"https://app.test/q/{quote_id}"}

    async def order_from_quote(self, quote_id: str) -> dict[str, Any]:
        return {"id": "O-NEW"}

    async def start_checkout(self, order_id: str, **_k: Any) -> dict[str, Any]:
        return {"checkoutUrl": f"https://app.test/c/{order_id}"}

    async def get_quote_pdf_base64(self, quote_id: str) -> str:
        return ""

    async def get_quote(self, quote_id: str) -> dict[str, Any]:
        if quote_id not in self.quotes:
            raise CommerceError(404, "NOT_FOUND", "Cotización no accesible")
        return self.quotes[quote_id]

    async def get_order(self, order_id: str) -> dict[str, Any]:
        if order_id not in self.orders:
            raise CommerceError(404, "NOT_FOUND", "Pedido no accesible")
        return self.orders[order_id]

    async def request_invoice(self, order_id: str, **_k: Any) -> dict[str, Any]:
        self.invoices.append(order_id)
        self.invoice_calls.append(_k)
        if self.invoice_response:
            return self.invoice_response
        return {}


def _runtime(state: dict[str, Any] | None = None, *, phone: str | None = CHANNEL_PHONE) -> SimpleNamespace:
    return SimpleNamespace(
        state=state if state is not None else {"carts": {}, "customer": {}},
        context={
            "tenant_id": "t1",
            "customer_phone": phone,
            "scopes": list(tools.require_scope.__globals__["TOOL_SCOPES"].values()),
        },
        tool_call_id="call-1",
    )


@pytest.fixture
def fake() -> FakeCommerce:
    client = FakeCommerce([ME, OTHER])
    with patch.object(tools, "_client", return_value=client):
        yield client


def test_normalize_phone_is_exact_with_mx_mobile_fold() -> None:
    assert tools.same_phone("5215512345678", "+52 55 1234 5678")
    assert not tools.same_phone("55", "5599998888")
    assert not tools.same_phone("5512345678", "525512345678")  # sin lada ≠ con lada


@pytest.mark.asyncio
async def test_historial_ignores_customer_supplied_phone(fake: FakeCommerce) -> None:
    """El exploit: estado con el teléfono "55" que dijo el cliente."""
    state = {"carts": {}, "customer": {"phone": "55", "email": "victima@example.com", "name": "Victima"}}
    out = await tools.historial_del_cliente.coroutine(runtime=_runtime(state))
    assert "Victima" not in out and "VIAJ" not in out and "victima@" not in out
    assert "Ana Real" in out
    assert all(q != "55" for q in fake.queries)


@pytest.mark.asyncio
async def test_historial_requires_exact_phone_match(fake: FakeCommerce) -> None:
    """Un `contains` que pega en otra ficha no cuenta como el cliente."""
    fake.customers = [OTHER]
    out = await tools.historial_del_cliente.coroutine(runtime=_runtime(phone="99998888"))
    assert "Victima" not in out
    assert "No hay compras anteriores" in out


@pytest.mark.asyncio
async def test_historial_denied_without_channel_phone(fake: FakeCommerce) -> None:
    state = {"carts": {}, "customer": {"phone": "5599998888", "email": "victima@example.com"}}
    out = await tools.historial_del_cliente.coroutine(runtime=_runtime(state, phone=None))
    assert "No puedo consultar" in out
    assert fake.queries == []


@pytest.mark.asyncio
async def test_recordar_cliente_cannot_override_channel_phone(fake: FakeCommerce) -> None:
    command = await tools.recordar_cliente.coroutine(runtime=_runtime(), telefono="55")
    assert command.update["customer"]["phone"] == CHANNEL_PHONE
    # Sin canal (chat web) sí se guarda lo que dijo.
    command = await tools.recordar_cliente.coroutine(runtime=_runtime(phone=None), telefono="6671234567")
    assert command.update["customer"]["phone"] == "6671234567"


def _cart_state(customer: dict[str, Any]) -> dict[str, Any]:
    line = {"variantId": "v1", "sku": "S", "title": "T", "quantity": "1.000", "unitPrice": "10.00"}
    return {"carts": {"1": {"cartId": "1", "lines": [line]}}, "active_cart_id": "1", "customer": customer,
            "messages": []}


@pytest.mark.asyncio
async def test_emitir_cotizacion_uses_channel_phone_and_drops_foreign_email(fake: FakeCommerce) -> None:
    state = _cart_state({"name": "Ana", "phone": "5599998888", "email": "victima@example.com"})
    await tools.emitir_cotizacion.coroutine(runtime=_runtime(state))
    call = fake.ensure_calls[-1]
    assert call["phone"] == CHANNEL_PHONE
    assert call["email"] is None  # lo tiene otra ficha: no decide a quién va la cotización


@pytest.mark.asyncio
async def test_emitir_cotizacion_keeps_own_or_unclaimed_email(fake: FakeCommerce) -> None:
    await tools.emitir_cotizacion.coroutine(runtime=_runtime(_cart_state({"name": "Ana", "email": "ana@example.com"})))
    assert fake.ensure_calls[-1]["email"] == "ana@example.com"
    await tools.emitir_cotizacion.coroutine(runtime=_runtime(_cart_state({"name": "Ana", "email": "nuevo@example.com"})))
    assert fake.ensure_calls[-1]["email"] == "nuevo@example.com"


@pytest.mark.asyncio
async def test_emitir_cotizacion_web_chat_never_claims_existing_customer(fake: FakeCommerce) -> None:
    state = _cart_state({"name": "Pepe", "phone": "55 9999 8888", "email": "victima@example.com"})
    await tools.emitir_cotizacion.coroutine(runtime=_runtime(state, phone=None))
    call = fake.ensure_calls[-1]
    assert call["phone"] is None and call["email"] is None
    state = _cart_state({"name": "Pepe", "phone": "667 123 4567", "email": "pepe@example.com"})
    await tools.emitir_cotizacion.coroutine(runtime=_runtime(state, phone=None))
    call = fake.ensure_calls[-1]
    assert call["phone"] == "6671234567" and call["email"] == "pepe@example.com"


@pytest.mark.asyncio
async def test_emitir_cotizacion_web_chat_second_quote_keeps_own_contact(fake: FakeCommerce) -> None:
    """La ficha que ESTA conversación creó en la 1ª cotización no es "ajena".

    Sin esto, la 2ª cotización salía sin teléfono ni correo y duplicaba la
    ficha del mismo cliente.
    """
    own = {"id": "c-own", "fullName": "Pepe", "email": "pepe@example.com", "phone": "6671234567"}
    fake.customers = [ME, OTHER, own]
    state = _cart_state({"name": "Pepe", "phone": "6671234567", "email": "pepe@example.com",
                         "customerId": "c-own"})
    await tools.emitir_cotizacion.coroutine(runtime=_runtime(state, phone=None))
    call = fake.ensure_calls[-1]
    assert call["phone"] == "6671234567" and call["email"] == "pepe@example.com"


@pytest.mark.asyncio
async def test_detalle_de_cotizacion_scoped_to_conversation(fake: FakeCommerce) -> None:
    out = await tools.detalle_de_cotizacion.coroutine(quoteId="Q-OTHER", runtime=_runtime())
    assert out == "No encontré esa cotización en esta conversación."
    out = await tools.detalle_de_cotizacion.coroutine(quoteId="Q-MINE", runtime=_runtime())
    assert "Cotización Q-MINE" in out
    # Chat web: solo lo que está en los carritos de este hilo.
    out = await tools.detalle_de_cotizacion.coroutine(quoteId="Q-MINE", runtime=_runtime(phone=None))
    assert out.startswith("No encontré")
    state = {"carts": {"1": {"quoteId": "Q-OTHER"}}, "customer": {}}
    out = await tools.detalle_de_cotizacion.coroutine(quoteId="Q-OTHER", runtime=_runtime(state, phone=None))
    assert "Cotización Q-OTHER" in out
    out = await tools.detalle_de_cotizacion.coroutine(quoteId="Q-NOPE", runtime=_runtime())
    assert out == "No encontré esa cotización en esta conversación."


@pytest.mark.asyncio
async def test_estado_del_pedido_scoped_to_conversation(fake: FakeCommerce) -> None:
    out = await tools.estado_del_pedido.coroutine(runtime=_runtime(), orderId="O-OTHER")
    assert out == "No encontré ese pedido en esta conversación."
    out = await tools.estado_del_pedido.coroutine(runtime=_runtime(), orderId="O-MINE")
    assert "Pedido O-MINE" in out


@pytest.mark.asyncio
async def test_solicitar_factura_refuses_foreign_order(fake: FakeCommerce) -> None:
    out = await tools.solicitar_factura.coroutine(
        orderId="O-OTHER", rfc="AAAA800101AB1", razonSocial="X", codigoPostal="01000", usoCfdi="G03",
        runtime=_runtime(),
    )
    assert out == "No encontré ese pedido en esta conversación."
    assert fake.invoices == []


@pytest.mark.asyncio
async def test_solicitar_factura_needs_constancia_or_full_manual_data(fake: FakeCommerce) -> None:
    """Sin constancia, no basta con dictar solo parte de los datos."""
    out = await tools.solicitar_factura.coroutine(
        orderId="O-MINE", rfc="AAAA800101AB1", usoCfdi="G03", runtime=_runtime(),
    )
    assert "Faltan datos fiscales" in out
    assert fake.invoices == []


@pytest.mark.asyncio
async def test_solicitar_factura_constancia_only_is_enough(fake: FakeCommerce) -> None:
    """`constanciaUrl` sola (sin rfc/razonSocial/codigoPostal) basta: el
    backend los llena. El mensaje final usa lo que el backend guardó."""
    fake.invoice_response = {
        "invoiceRfc": "XAXX010101000",
        "invoiceLegalName": "Empresa de la Constancia SA de CV",
        "invoicePostalCode": "64000",
        "invoiceConstanciaUrl": "https://example.com/constancia.pdf",
    }
    out = await tools.solicitar_factura.coroutine(
        orderId="O-MINE",
        usoCfdi="G03",
        constanciaUrl="https://example.com/constancia.pdf",
        runtime=_runtime(),
    )
    assert fake.invoices == ["O-MINE"]
    call = fake.invoice_calls[-1]
    assert call["rfc"] is None and call["legal_name"] is None and call["postal_code"] is None
    assert call["constancia_url"] == "https://example.com/constancia.pdf"
    assert "XAXX010101000" in out
    assert "Empresa de la Constancia SA de CV" in out
