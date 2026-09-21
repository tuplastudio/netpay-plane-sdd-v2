"""Pruebas de las tools con varios carritos a la vez (`app/tools.py`).

Llama las corrutinas de las tools directamente (`.coroutine`, el callable
crudo detrás del decorador `@tool` de LangChain) con un `ToolRuntime` de
juguete y un `CommerceClient` falso — sin red, sin grafo. Verifica la
resolución de `carritoId` (vacío = carrito activo) y que operar sobre un
carrito nunca toca los demás.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest

from app import tools

VARIANTS = [
    {"variantId": "v-playera", "sku": "PLAYERA-1", "title": "Playera azul", "productTitle": "Playera",
     "tags": [], "synonyms": [], "price": "100.00", "stock": 50, "status": "ACTIVE"},
    {"variantId": "v-taza", "sku": "TAZA-1", "title": "Taza blanca", "productTitle": "Taza",
     "tags": [], "synonyms": [], "price": "50.00", "stock": 20, "status": "ACTIVE"},
]


class FakeCommerceClient:
    """Doble de `CommerceClient`: sin red, respuestas deterministas y
    contadores para poder afirmar que cada carrito genera SU PROPIA
    cotización/pedido (ids distintos, incrementales)."""

    def __init__(self) -> None:
        self.live = True
        self._quote_seq = 0
        self._order_seq = 0
        self.created_quotes: list[dict[str, Any]] = []

    async def search_products(self, *_a: Any, **_k: Any) -> list[dict[str, Any]]:
        return VARIANTS

    async def price_preview(self, lines: list[dict[str, Any]], **_k: Any) -> dict[str, Any]:
        total = sum(
            float(next(v["price"] for v in VARIANTS if v["variantId"] == line["variantId"])) * float(line["quantity"])
            for line in lines
        )
        return {"totals": {"subtotal": f"{total:.2f}", "tax": "0.00", "shipping": "0.00", "total": f"{total:.2f}"}}

    async def ensure_customer(self, *, full_name: str, **_k: Any) -> dict[str, Any]:
        return {"id": "cust-1", "fullName": full_name}

    async def create_quote(self, *, lines: list[dict[str, Any]], **_k: Any) -> dict[str, Any]:
        self._quote_seq += 1
        quote = {"id": f"Q{self._quote_seq}", "total": "999.00", "lines": lines}
        self.created_quotes.append(quote)
        return quote

    async def share_quote(self, quote_id: str) -> dict[str, Any]:
        return {"url": f"https://app.test/quotes/public/{quote_id}"}

    async def order_from_quote(self, quote_id: str) -> dict[str, Any]:
        self._order_seq += 1
        return {"id": f"O{self._order_seq}", "status": "PENDING", "total": "999.00"}

    async def start_checkout(self, order_id: str, **_k: Any) -> dict[str, Any]:
        return {"checkoutUrl": f"https://app.test/checkout/{order_id}"}

    async def get_quote_pdf_base64(self, quote_id: str) -> str:
        return "cGRm"

    async def get_order(self, order_id: str) -> dict[str, Any]:
        return {"id": order_id, "status": "PAID", "total": "999.00", "paidAt": "2026-01-01"}


def _runtime(state: dict[str, Any], *, tool_call_id: str = "call-1") -> SimpleNamespace:
    return SimpleNamespace(
        state=state,
        context={"tenant_id": "t1", "scopes": list(tools.require_scope.__globals__["TOOL_SCOPES"].values())},
        tool_call_id=tool_call_id,
    )


@pytest.fixture(autouse=True)
def fake_client():
    client = FakeCommerceClient()
    with patch.object(tools, "_client", return_value=client):
        yield client


def _update_of(command) -> dict[str, Any]:
    return command.update


@pytest.mark.asyncio
async def test_agregar_al_carrito_default_uses_default_cart_id() -> None:
    state: dict[str, Any] = {"carts": {}, "active_cart_id": None}
    command = await tools.agregar_al_carrito.coroutine(variantId="v-playera", cantidad="2", runtime=_runtime(state))
    update = _update_of(command)
    assert update["active_cart_id"] == tools.DEFAULT_CART_ID
    assert tools.DEFAULT_CART_ID in update["carts"]
    assert update["carts"][tools.DEFAULT_CART_ID]["lines"][0]["variantId"] == "v-playera"


@pytest.mark.asyncio
async def test_agregar_al_carrito_empty_carritoId_continues_active_cart() -> None:
    """Sin `carritoId`, un segundo producto se agrega al carrito YA activo,
    no a uno nuevo — así un pedido normal nunca fragmenta su carrito."""
    state: dict[str, Any] = {"carts": {"mio": {"lines": []}}, "active_cart_id": "mio"}
    command = await tools.agregar_al_carrito.coroutine(variantId="v-taza", cantidad="1", runtime=_runtime(state))
    update = _update_of(command)
    assert set(update["carts"]) == {"mio"}
    assert update["active_cart_id"] == "mio"


@pytest.mark.asyncio
async def test_agregar_al_carrito_explicit_carritoId_opens_separate_cart() -> None:
    """Dos pedidos distintos en la misma conversación NO se mezclan cuando
    el modelo usa `carritoId` explícito para el segundo."""
    state: dict[str, Any] = {"carts": {}, "active_cart_id": None}
    first = await tools.agregar_al_carrito.coroutine(variantId="v-playera", cantidad="3", runtime=_runtime(state))
    state["carts"] = _update_of(first)["carts"]
    state["active_cart_id"] = _update_of(first)["active_cart_id"]

    second = await tools.agregar_al_carrito.coroutine(
        variantId="v-taza", cantidad="1", runtime=_runtime(state), carritoId="regalo"
    )
    update = _update_of(second)
    assert set(update["carts"]) == {"regalo"}, "el segundo carrito es un registro nuevo"
    assert update["active_cart_id"] == "regalo"
    # el carrito original sigue intacto en el estado (no lo tocó el delta)
    assert state["carts"][tools.DEFAULT_CART_ID]["lines"][0]["variantId"] == "v-playera"


@pytest.mark.asyncio
async def test_calcular_total_and_emitir_cotizacion_are_isolated_per_cart() -> None:
    """El caso central del pedido del usuario: dos cotizaciones a la vez, y
    pedir el total o emitir una NO afecta a la otra."""
    state: dict[str, Any] = {
        "carts": {
            "playeras": {"cartId": "playeras", "lines": [{"variantId": "v-playera", "sku": "PLAYERA-1", "title": "Playera azul", "quantity": "3", "unitPrice": "100.00"}]},
            "regalo": {"cartId": "regalo", "lines": [{"variantId": "v-taza", "sku": "TAZA-1", "title": "Taza blanca", "quantity": "2", "unitPrice": "50.00"}]},
        },
        "active_cart_id": "regalo",
        "customer": {"name": "Laura Martínez"},
    }

    total_cmd = await tools.calcular_total.coroutine(runtime=_runtime(state), carritoId="playeras")
    total_update = _update_of(total_cmd)
    assert set(total_update["carts"]) == {"playeras"}
    state["carts"]["playeras"].update(total_update["carts"]["playeras"])
    assert "lastTotals" not in state["carts"]["regalo"], "el otro carrito no debe tener total"

    quote_cmd = await tools.emitir_cotizacion.coroutine(runtime=_runtime(state), carritoId="playeras")
    quote_update = _update_of(quote_cmd)
    assert set(quote_update["carts"]) == {"playeras"}
    state["carts"]["playeras"].update(quote_update["carts"]["playeras"])
    assert state["carts"]["playeras"]["quoteId"] == "Q1"
    assert "quoteId" not in state["carts"]["regalo"], "cotizar 'playeras' no debe cotizar 'regalo'"

    # emitir la del otro carrito produce un folio DISTINTO
    quote_cmd_2 = await tools.emitir_cotizacion.coroutine(runtime=_runtime(state), carritoId="regalo")
    quote_update_2 = _update_of(quote_cmd_2)
    assert quote_update_2["carts"]["regalo"]["quoteId"] == "Q2"
    assert quote_update_2["carts"]["regalo"]["quoteId"] != state["carts"]["playeras"]["quoteId"]


@pytest.mark.asyncio
async def test_emitir_cotizacion_reuses_quote_for_unchanged_cart_signature() -> None:
    state: dict[str, Any] = {
        "carts": {"1": {"lines": [{"variantId": "v-playera", "sku": "PLAYERA-1", "title": "Playera azul", "quantity": "1", "unitPrice": "100.00"}]}},
        "active_cart_id": "1",
        "customer": {"name": "Laura"},
    }
    first = _update_of(await tools.emitir_cotizacion.coroutine(runtime=_runtime(state)))
    state["carts"]["1"].update(first["carts"]["1"])

    reply_text = await tools.emitir_cotizacion.coroutine(runtime=_runtime(state))
    # el segundo llamado sin cambios en el carrito reutiliza, no crea Q2
    content = reply_text.update["messages"][0].content
    assert "Ya existe la cotización Q1" in content


@pytest.mark.asyncio
async def test_generar_enlace_pago_requires_order_of_that_specific_cart() -> None:
    state: dict[str, Any] = {
        "carts": {
            "a": {"lines": [{"variantId": "v-playera", "quantity": "1"}], "orderId": "O1"},
            "b": {"lines": [{"variantId": "v-taza", "quantity": "1"}]},  # sin pedido
        },
        "active_cart_id": "a",
    }
    ok = await tools.generar_enlace_pago.coroutine(runtime=_runtime(state), carritoId="a")
    assert _update_of(ok)["carts"]["a"]["checkoutLink"].endswith("/checkout/O1")

    fail = await tools.generar_enlace_pago.coroutine(runtime=_runtime(state), carritoId="b")
    content = fail.update["messages"][0].content
    assert content.startswith("ERROR:") and "convertir_en_pedido" in content


@pytest.mark.asyncio
async def test_estado_del_pedido_resolves_active_cart_order_without_orderId() -> None:
    state: dict[str, Any] = {"carts": {"1": {"orderId": "O9"}}, "active_cart_id": "1"}
    result = await tools.estado_del_pedido.coroutine(runtime=_runtime(state))
    assert "Pedido O9" in result


@pytest.mark.asyncio
async def test_sanitize_cart_id_normalizes_free_text() -> None:
    assert tools._sanitize_cart_id("  Playeras del Equipo!! ") == "playeras-del-equipo"
    assert tools._sanitize_cart_id("") == ""
    assert tools._sanitize_cart_id("a" * 100) == "a" * 40


@pytest.mark.asyncio
async def test_emitir_cotizacion_reuses_delivery_mode_from_calcular_total(fake_client) -> None:
    """El enlace de pago que arma emitir_cotizacion debe cobrar el MISMO
    envío que el total que ya se le dijo al cliente (antes iba PICKUP fijo)."""
    seen: list[dict[str, Any]] = []

    async def start_checkout(order_id: str, **kwargs: Any) -> dict[str, Any]:
        seen.append(kwargs)
        return {"checkoutUrl": f"https://app.test/checkout/{order_id}"}

    async def price_preview(lines: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
        seen.append(kwargs)
        return {"totals": {"subtotal": "100.00", "tax": "0.00", "shipping": "50.00", "total": "150.00"}}

    fake_client.start_checkout = start_checkout
    fake_client.price_preview = price_preview

    state: dict[str, Any] = {
        "carts": {"mio": {"cartId": "mio", "lines": [{"variantId": "v-playera", "sku": "PLAYERA-1", "title": "Playera azul", "quantity": "1", "unitPrice": "100.00"}]}},
        "active_cart_id": "mio",
        "customer": {"name": "Ana"},
    }
    total = await tools.calcular_total.coroutine(runtime=_runtime(state), deliveryMode="LOCAL_DELIVERY")
    assert seen[-1]["delivery_mode"] == "LOCAL_DELIVERY"
    state["carts"]["mio"].update(_update_of(total)["carts"]["mio"])
    assert state["carts"]["mio"]["deliveryMode"] == "LOCAL_DELIVERY"

    await tools.emitir_cotizacion.coroutine(runtime=_runtime(state))
    assert seen[-1]["delivery_mode"] == "LOCAL_DELIVERY"

    # Sin modo recordado ni explícito: PICKUP.
    seen.clear()
    fresh: dict[str, Any] = {"carts": {"otro": {"cartId": "otro", "lines": state["carts"]["mio"]["lines"]}}, "active_cart_id": "otro", "customer": {"name": "Ana"}}
    await tools.calcular_total.coroutine(runtime=_runtime(fresh))
    assert seen[-1]["delivery_mode"] == "PICKUP"


@pytest.mark.asyncio
async def test_emitir_cotizacion_reissue_points_to_existing_checkout_link() -> None:
    state: dict[str, Any] = {
        "carts": {"mio": {
            "cartId": "mio",
            "lines": [{"variantId": "v-playera", "sku": "PLAYERA-1", "title": "Playera azul", "quantity": "1", "unitPrice": "100.00"}],
            "quoteId": "Q1", "quoteLink": "https://app.test/quotes/public/Q1", "checkoutLink": "https://app.test/checkout/O1",
        }},
        "active_cart_id": "mio",
        "customer": {"name": "Ana"},
    }
    state["carts"]["mio"]["quoteSignature"] = tools._cart_signature(state["carts"]["mio"]["lines"])
    command = await tools.emitir_cotizacion.coroutine(runtime=_runtime(state))
    text = command.update["messages"][0].content
    assert "https://app.test/checkout/O1" in text
    assert "convertir_en_pedido" not in text


@pytest.mark.asyncio
async def test_emitir_cotizacion_uses_name_from_sibling_recordar_cliente_call() -> None:
    """"Sí, emítela, soy Ana": recordar_cliente y emitir_cotizacion salen en
    el mismo lote y ven el mismo snapshot; la cotización no debe fallar por
    "sin nombre" cuando el nombre viene en la llamada hermana."""
    from langchain_core.messages import AIMessage

    lines = [{"variantId": "v-playera", "sku": "PLAYERA-1", "title": "Playera azul", "quantity": "1", "unitPrice": "100.00"}]
    batch = AIMessage(
        content="",
        tool_calls=[
            {"name": "recordar_cliente", "args": {"nombre": "Ana López"}, "id": "c1"},
            {"name": "emitir_cotizacion", "args": {}, "id": "c2"},
        ],
    )
    state: dict[str, Any] = {"carts": {"mio": {"cartId": "mio", "lines": lines}}, "active_cart_id": "mio", "customer": {}, "messages": [batch]}
    command = await tools.emitir_cotizacion.coroutine(runtime=_runtime(state, tool_call_id="c2"))
    text = command.update["messages"][0].content
    assert "Cotización Q" in text, text
    assert command.update["customer"]["name"] == "Ana López"

    # Sin llamada hermana ni nombre en estado: sigue negándose.
    state["messages"] = [AIMessage(content="", tool_calls=[{"name": "emitir_cotizacion", "args": {}, "id": "c3"}])]
    command = await tools.emitir_cotizacion.coroutine(runtime=_runtime(state, tool_call_id="c3"))
    assert "ERROR" in command.update["messages"][0].content


@pytest.mark.asyncio
async def test_agregar_al_carrito_accepts_sku_as_variant_key() -> None:
    state: dict[str, Any] = {"carts": {}, "active_cart_id": None}
    command = await tools.agregar_al_carrito.coroutine(variantId="TAZA-1", cantidad="1", runtime=_runtime(state))
    line = _update_of(command)["carts"][tools.DEFAULT_CART_ID]["lines"][0]
    assert line["variantId"] == "v-taza" and line["sku"] == "TAZA-1"


@pytest.mark.asyncio
async def test_placeholder_name_is_never_a_customer() -> None:
    """En prod el modelo inventó `nombre="Cliente"` y la cotización salió a
    nombre de nadie: ni recordar_cliente lo guarda ni emitir_cotizacion lo
    acepta, ni siquiera desde la llamada hermana del mismo lote."""
    from langchain_core.messages import AIMessage

    assert tools.is_placeholder_name("Cliente")
    assert tools.is_placeholder_name(" cliente de WhatsApp ")
    assert tools.is_placeholder_name("5216670000001")
    assert not tools.is_placeholder_name("Ana López")

    state: dict[str, Any] = {"carts": {}, "active_cart_id": None, "customer": {}}
    command = await tools.recordar_cliente.coroutine(runtime=_runtime(state), nombre="Cliente")
    assert "ERROR" in command.update["messages"][0].content
    assert "customer" not in command.update

    lines = [{"variantId": "v-playera", "sku": "PLAYERA-1", "title": "Playera azul", "quantity": "1", "unitPrice": "100.00"}]
    batch = AIMessage(content="", tool_calls=[
        {"name": "recordar_cliente", "args": {"nombre": "Cliente"}, "id": "c1"},
        {"name": "emitir_cotizacion", "args": {}, "id": "c2"},
    ])
    state = {"carts": {"mio": {"cartId": "mio", "lines": lines}}, "active_cart_id": "mio", "customer": {"name": "Cliente de WhatsApp"}, "messages": [batch]}
    command = await tools.emitir_cotizacion.coroutine(runtime=_runtime(state, tool_call_id="c2"))
    assert "Aún no tienes el nombre" in command.update["messages"][0].content


@pytest.mark.asyncio
async def test_escalar_a_humano_without_resumen() -> None:
    state: dict[str, Any] = {"carts": {}, "active_cart_id": None}
    command = await tools.escalar_a_humano.coroutine(runtime=_runtime(state), motivo="CLIENTE_LO_PIDE")
    assert command.update["handoff"] is True
