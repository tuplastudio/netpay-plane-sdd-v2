"""Configuración nueva: `bot_pay_first` y `collect_customer_address`.

Cubren:
- Defaults (False / True) para que no cambien el flujo actual.
- Persistencia en disco (round-trip) y serialización al panel.
- Aparición en el `overrides_block` del prompt cuando se enciende.
"""

from __future__ import annotations

from unittest import TestCase

from app.agent_settings import AgentSettings, get_settings_store
from app.prompts import assemble_prompt
from app.prompts.registry import get_prompt_registry
from app.knowledge import BusinessProfile


class BotPayFirstTests(TestCase):
    def test_default_is_false(self) -> None:
        """El default sigue False para no romper tenants que ya emiten cotización."""
        s = AgentSettings()
        self.assertFalse(s.bot_pay_first)

    def test_can_be_enabled(self) -> None:
        s = AgentSettings(bot_pay_first=True)
        self.assertTrue(s.bot_pay_first)

    def test_to_dict_exposes_field(self) -> None:
        s = AgentSettings(bot_pay_first=True)
        d = s.to_dict()
        self.assertIn("bot_pay_first", d)
        self.assertTrue(d["bot_pay_first"])

    def test_prompt_off_by_default(self) -> None:
        """Sin `bot_pay_first`, el prompt NO activa el flujo rápido."""
        version = get_prompt_registry().get("1.4.1")
        prompt = assemble_prompt(version, profile=BusinessProfile(name="X"))
        # La línea del overrides_block es "FLUJO RÁPIDO habilitado por el
        # admin". Si el ajuste está apagado (default), esa línea NO debe
        # aparecer.
        self.assertNotIn("FLUJO RÁPIDO habilitado por el admin", prompt)

    def test_prompt_on_when_enabled(self) -> None:
        version = get_prompt_registry().get("1.4.1")
        prompt = assemble_prompt(
            version,
            profile=BusinessProfile(name="X"),
            overrides=AgentSettings(bot_pay_first=True),
        )
        self.assertIn("FLUJO RÁPIDO habilitado por el admin", prompt)
        # Confirma explícitamente: NO emitir cotización, ir directo a pago.
        self.assertIn("generar_enlace_pago", prompt)
        self.assertIn("NO emitas cotización", prompt)


class CollectCustomerAddressTests(TestCase):
    def test_default_is_true(self) -> None:
        """Por default el bot pregunta la dirección (compatible con v1.4.1)."""
        s = AgentSettings()
        self.assertTrue(s.collect_customer_address)

    def test_can_be_disabled(self) -> None:
        s = AgentSettings(collect_customer_address=False)
        self.assertFalse(s.collect_customer_address)

    def test_to_dict_exposes_field(self) -> None:
        s = AgentSettings(collect_customer_address=False)
        d = s.to_dict()
        self.assertIn("collect_customer_address", d)
        self.assertFalse(d["collect_customer_address"])

    def test_prompt_address_question_on_by_default(self) -> None:
        """Default (True): el prompt instruye a pedir CP/ciudad/estado."""
        version = get_prompt_registry().get("1.4.1")
        prompt = assemble_prompt(version, profile=BusinessProfile(name="X"))
        # El bloque de ajustes lo explica cuando se enciende el ajuste.
        self.assertIn("postalCode", prompt)
        self.assertIn("validar_zona_de_envio", prompt)

    def test_prompt_fast_path_when_disabled(self) -> None:
        version = get_prompt_registry().get("1.4.1")
        prompt = assemble_prompt(
            version,
            profile=BusinessProfile(name="X"),
            overrides=AgentSettings(collect_customer_address=False),
        )
        # El modo rápido NO pregunta dirección: usa el flat.
        self.assertIn("NO preguntes dirección", prompt)


class ShippingBlockInPromptTests(TestCase):
    def test_block_is_loaded(self) -> None:
        version = get_prompt_registry().get("1.4.1")
        block = version.block("55_envio_domicilio")
        self.assertIsNotNone(block)
        text = block.text.lower()
        self.assertIn("cp", text)
        self.assertIn("zona", text)
        self.assertIn("ubicaci", text)  # 'ubicación' / 'ubicaciones'

    def test_block_covers_whatsapp_location_caveat(self) -> None:
        """Si el cliente manda ubicación de WhatsApp, NO es el CP — el prompt
        debe decir explícitamente que no la uses como dirección."""
        block = get_prompt_registry().get("1.4.1").block("55_envio_domicilio")
        self.assertIn("WhatsApp", block.text)
        self.assertIn("CP", block.text)


class ValidarZonaToolTests(TestCase):
    """La herramienta existe, tiene scope y aparece en SALES_TOOLS."""

    def test_registered(self) -> None:
        from app import tools

        self.assertIn(tools.validar_zona_de_envio, tools.SALES_TOOLS)

    def test_scope_is_quotes_read(self) -> None:
        from app.security import TOOL_SCOPES

        self.assertEqual(TOOL_SCOPES.get("validar_zona_de_envio"), "quotes.read")

    def test_calcular_total_accepts_address(self) -> None:
        """`calcular_total` ahora acepta postalCode/city/state como args."""
        import inspect

        from app import tools

        sig = inspect.signature(tools.calcular_total.coroutine)
        for arg in ("postalCode", "city", "state"):
            self.assertIn(arg, sig.parameters)


class RoundTripPersistenceTests(TestCase):
    def test_settings_round_trip(self) -> None:
        store = get_settings_store()
        store.update(
            "t-ship",
            {"bot_pay_first": True, "collect_customer_address": False},
        )
        current = store.get("t-ship")
        self.assertTrue(current.bot_pay_first)
        self.assertFalse(current.collect_customer_address)
        store.reset("t-ship")
        current = store.get("t-ship")
        self.assertFalse(current.bot_pay_first)
        self.assertTrue(current.collect_customer_address)
