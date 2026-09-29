"""Modo de cobro por tenant: `checkout_mode` y el campo heredado `bot_pay_first`.

Cubren:
- `sanitize`: default, mapeo del payload viejo (`bot_pay_first`) y prioridad
  de `checkout_mode` cuando vienen los dos.
- Persistencia: un JSON viejo en disco con solo `bot_pay_first: true` se lee
  como `pay_first`.
- Prompt: cada modo mete (o no) su bloque en AJUSTES DEL NEGOCIO; v1.6.0
  trae el bloque estático MODO DE COBRO.
- Herramientas en `quote_only`: `emitir_cotizacion` no crea pedido ni
  checkout y `generar_enlace_pago` se niega, sin tocar la red.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from app.agent_settings import (
    DEFAULT_CHECKOUT_MODE,
    DEFAULT_QUOTE_ONLY_CLOSING,
    AgentSettings,
    get_settings_store,
    resolve_checkout_mode,
    sanitize,
)
from app.knowledge import BusinessProfile
from app.prompts import assemble_prompt
from app.prompts.registry import get_prompt_registry
from app.security import TOOL_SCOPES


class SanitizeCheckoutModeTests(TestCase):
    def test_default_is_quote_and_pay(self) -> None:
        s = sanitize({})
        self.assertEqual(s.checkout_mode, DEFAULT_CHECKOUT_MODE)
        self.assertFalse(s.bot_pay_first)
        self.assertTrue(s.payment_links_enabled())
        self.assertFalse(s.pay_first())

    def test_legacy_true_maps_to_pay_first(self) -> None:
        s = sanitize({"bot_pay_first": True})
        self.assertEqual(s.checkout_mode, "pay_first")
        self.assertTrue(s.bot_pay_first)
        self.assertTrue(s.pay_first())

    def test_checkout_mode_wins_over_legacy(self) -> None:
        s = sanitize({"checkout_mode": "quote_only", "bot_pay_first": True})
        self.assertEqual(s.checkout_mode, "quote_only")
        self.assertFalse(s.bot_pay_first, "bot_pay_first se deriva del modo")
        self.assertFalse(s.payment_links_enabled())

    def test_legacy_false_does_not_clobber_quote_only(self) -> None:
        base = AgentSettings(checkout_mode="quote_only")
        s = sanitize({"bot_pay_first": False, "tone": "x"}, base=base)
        self.assertEqual(s.checkout_mode, "quote_only")

    def test_legacy_false_leaves_pay_first(self) -> None:
        base = AgentSettings(checkout_mode="pay_first", bot_pay_first=True)
        s = sanitize({"bot_pay_first": False}, base=base)
        self.assertEqual(s.checkout_mode, DEFAULT_CHECKOUT_MODE)
        self.assertFalse(s.bot_pay_first)

    def test_invalid_mode_keeps_current(self) -> None:
        base = AgentSettings(checkout_mode="quote_only")
        self.assertEqual(sanitize({"checkout_mode": "gratis"}, base=base).checkout_mode, "quote_only")
        self.assertEqual(resolve_checkout_mode({"checkout_mode": "PAY_FIRST"}, ""), "pay_first")
        self.assertEqual(resolve_checkout_mode({}, "raro"), DEFAULT_CHECKOUT_MODE)

    def test_closing_message_limit_and_default(self) -> None:
        s = sanitize({"quote_only_closing_message": "x" * 400})
        self.assertEqual(len(s.quote_only_closing_message), 300)
        self.assertEqual(AgentSettings().quote_only_closing(), DEFAULT_QUOTE_ONLY_CLOSING)
        self.assertEqual(AgentSettings(quote_only_closing_message="  Te llamo  ").quote_only_closing(), "Te llamo")

    def test_to_dict_exposes_both_fields(self) -> None:
        d = AgentSettings(checkout_mode="pay_first", bot_pay_first=True).to_dict()
        self.assertEqual(d["checkout_mode"], "pay_first")
        self.assertTrue(d["bot_pay_first"])
        self.assertIn("quote_only_closing_message", d)


class PersistenceTests(TestCase):
    def test_old_json_on_disk_maps_legacy_flag(self) -> None:
        store = get_settings_store()
        store.reset("t-legacy")
        path = store._path("t-legacy")
        path.write_text(json.dumps({"bot_pay_first": True, "tone": "seco"}), encoding="utf-8")
        store._cache.pop("t-legacy", None)  # `reset` dejó cacheado el default
        current = store.get("t-legacy")
        self.assertEqual(current.checkout_mode, "pay_first")
        self.assertTrue(current.bot_pay_first)
        store.reset("t-legacy")

    def test_round_trip_quote_only(self) -> None:
        store = get_settings_store()
        store.update("t-qo", {"checkout_mode": "quote_only", "quote_only_closing_message": "Te marco"})
        store._cache.clear()
        current = store.get("t-qo")
        self.assertEqual(current.checkout_mode, "quote_only")
        self.assertEqual(current.quote_only_closing(), "Te marco")
        store.reset("t-qo")
        self.assertEqual(store.get("t-qo").checkout_mode, DEFAULT_CHECKOUT_MODE)


class PromptTests(TestCase):
    def _prompt(self, **kwargs) -> str:
        version = get_prompt_registry().get("1.6.0")
        return assemble_prompt(version, profile=BusinessProfile(name="X"), overrides=AgentSettings(**kwargs))

    def test_quote_and_pay_adds_nothing(self) -> None:
        # El bloque estático 57 nombra los tres modos; lo que NO debe aparecer
        # es la activación del bloque de AJUSTES DEL NEGOCIO.
        prompt = self._prompt()
        self.assertNotIn("MODO SOLO COTIZACIÓN habilitado por el admin", prompt)
        self.assertNotIn("FLUJO RÁPIDO habilitado por el admin", prompt)
        self.assertIn("MODO DE COBRO", prompt)

    def test_pay_first_via_checkout_mode(self) -> None:
        prompt = self._prompt(checkout_mode="pay_first")
        self.assertIn("FLUJO RÁPIDO habilitado por el admin", prompt)

    def test_quote_only_block_with_custom_closing(self) -> None:
        prompt = self._prompt(checkout_mode="quote_only", quote_only_closing_message="Te llamamos hoy")
        self.assertIn("MODO SOLO COTIZACIÓN habilitado por el admin", prompt)
        self.assertIn("Te llamamos hoy", prompt)
        self.assertIn("generar_enlace_pago", prompt)

    def test_quote_only_default_closing(self) -> None:
        prompt = self._prompt(checkout_mode="quote_only")
        self.assertIn(DEFAULT_QUOTE_ONLY_CLOSING, prompt)

    def test_v160_has_static_block(self) -> None:
        version = get_prompt_registry().get("1.6.0")
        block = version.block("57_modo_de_cobro")
        self.assertIsNotNone(block)
        self.assertIn("SOLO COTIZACIÓN", block.text)
        self.assertIn("generar_enlace_pago", block.text)


# ---------------------------------------------------------------- herramientas


def _runtime(state: dict, tenant_id: str) -> SimpleNamespace:
    return SimpleNamespace(
        state=state,
        context={"tenant_id": tenant_id, "scopes": list(TOOL_SCOPES.values()), "customer_name": "Ana López"},
        tool_call_id="call-1",
    )


def _cart_state() -> dict:
    return {
        "carts": {
            "1": {
                "cartId": "1",
                "lines": [{"variantId": "v1", "sku": "S1", "title": "Lata", "quantity": "2.000"}],
            }
        },
        "active_cart_id": "1",
        "customer": {"name": "Ana López"},
    }


class _NoNetworkClient:
    """Doble mínimo de CommerceClient: registra qué se llamó y explota si se
    intenta crear pedido o checkout."""

    live = True

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def ensure_customer(self, **_):
        self.calls.append("ensure_customer")
        return {"id": "cust-1"}

    async def create_quote(self, **_):
        self.calls.append("create_quote")
        return {"id": "Q-1", "total": "232.00"}

    async def share_quote(self, quote_id: str):
        self.calls.append("share_quote")
        return {"token": "tok", "url": "https://app.example.test/quotes/public/tok"}

    async def get_quote_pdf_base64(self, quote_id: str):
        self.calls.append("pdf")
        return "UERG"

    async def order_from_quote(self, *_, **__):
        raise AssertionError("quote_only no debe crear pedido")

    async def start_checkout(self, *_, **__):
        raise AssertionError("quote_only no debe abrir checkout")


async def test_emitir_cotizacion_quote_only_skips_checkout() -> None:
    from app import tools

    store = get_settings_store()
    store.update("t-qo-tools", {"checkout_mode": "quote_only", "quote_only_closing_message": "Te marca Luis"})
    client = _NoNetworkClient()
    with patch.object(tools, "_client", return_value=client), patch.object(
        tools, "_quote_identifiers", return_value=("5215512345678", None)
    ):
        cmd = await tools.emitir_cotizacion.coroutine(runtime=_runtime(_cart_state(), "t-qo-tools"))
    store.reset("t-qo-tools")

    text = cmd.update["messages"][0].content
    assert "Enlace de pago:" not in text
    assert "Te marca Luis" in text
    assert "https://app.example.test/quotes/public/tok" in text
    cart = cmd.update["carts"]["1"]
    assert cart["quoteId"] == "Q-1"
    assert cart["checkoutLink"] is None
    assert cart["orderId"] is None
    assert cart["stage"] == "COTIZACION_EMITIDA"
    assert "order_from_quote" not in client.calls


async def test_emitir_cotizacion_default_mode_still_creates_checkout() -> None:
    from app import tools

    class PayingClient(_NoNetworkClient):
        async def order_from_quote(self, quote_id: str, **_):
            self.calls.append("order_from_quote")
            return {"id": "O-1"}

        async def start_checkout(self, order_id: str, **_):
            self.calls.append("start_checkout")
            return {"checkoutToken": "ck", "checkoutUrl": "https://app.example.test/checkout/ck"}

    client = PayingClient()
    with patch.object(tools, "_client", return_value=client), patch.object(
        tools, "_quote_identifiers", return_value=(None, None)
    ):
        cmd = await tools.emitir_cotizacion.coroutine(runtime=_runtime(_cart_state(), "t-default-tools"))
    text = cmd.update["messages"][0].content
    assert "Enlace de pago: https://app.example.test/checkout/ck" in text
    assert cmd.update["carts"]["1"]["stage"] == "PAGO_ENVIADO"
    assert "order_from_quote" in client.calls and "start_checkout" in client.calls


async def test_generar_enlace_pago_denied_in_quote_only() -> None:
    from app import tools

    store = get_settings_store()
    store.update("t-qo-pay", {"checkout_mode": "quote_only"})
    state = _cart_state()
    state["carts"]["1"]["orderId"] = "O-9"
    with patch.object(tools, "_client", side_effect=AssertionError("no debe tocar el backend")):
        cmd = await tools.generar_enlace_pago.coroutine(runtime=_runtime(state, "t-qo-pay"))
    store.reset("t-qo-pay")
    text = cmd.update["messages"][0].content
    assert text.startswith("ERROR:")
    assert "SOLO COTIZACIÓN" in text
    assert DEFAULT_QUOTE_ONLY_CLOSING in text
    assert "carts" not in cmd.update


async def test_generar_enlace_pago_reused_quote_hint_in_quote_only() -> None:
    """Con cotización ya emitida, `emitir_cotizacion` no sugiere generar_enlace_pago."""
    from app import tools

    store = get_settings_store()
    store.update("t-qo-reuse", {"checkout_mode": "quote_only"})
    state = _cart_state()
    state["carts"]["1"].update(
        {"quoteId": "Q-1", "quoteLink": "https://x/q", "quoteSignature": tools._cart_signature(state["carts"]["1"]["lines"])}
    )
    cmd = await tools.emitir_cotizacion.coroutine(runtime=_runtime(state, "t-qo-reuse"))
    store.reset("t-qo-reuse")
    text = cmd.update["messages"][0].content
    assert "Ya existe la cotización Q-1" in text
    assert "generar_enlace_pago" not in text
    assert DEFAULT_QUOTE_ONLY_CLOSING in text
