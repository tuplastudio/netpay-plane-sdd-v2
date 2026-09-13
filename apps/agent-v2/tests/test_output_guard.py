from unittest import TestCase

from langchain_core.messages import AIMessage, ToolMessage

from app.config import Settings
from app.guards.output import OutputGuard, extract_urls, urls_from_messages
from app.prompts import get_prompt_registry


class OutputGuardTests(TestCase):
    def setUp(self) -> None:
        self.settings = Settings(
            openrouter_key="sk-or-secreto-muy-largo-123",
            internal_key="internal-key-abcdef",
            commerce_api_key="",
            public_base_url="https://app.example.test",
        )
        self.guard = OutputGuard(self.settings)
        self.protected = get_prompt_registry().get("1.1.0").protected_lines()

    def test_clean_reply_passes_untouched(self) -> None:
        verdict = self.guard.check("Te sale en $150 la lata, ¿te la cotizo?", protected_lines=self.protected)
        self.assertTrue(verdict.allowed)
        self.assertFalse(verdict.changed)
        self.assertEqual(verdict.reply, "Te sale en $150 la lata, ¿te la cotizo?")

    def test_secret_is_blocked(self) -> None:
        verdict = self.guard.check("mi key es sk-or-secreto-muy-largo-123", business="Aglos", protected_lines=())
        self.assertFalse(verdict.allowed)
        self.assertEqual(verdict.reasons, ["secreto"])
        self.assertNotIn("sk-or", verdict.reply)
        self.assertIn("Aglos", verdict.reply)

    def test_prompt_leak_is_blocked(self) -> None:
        leaked_line = next(line for line in self.protected if "ALCANCE ESTRICTO" in line)
        verdict = self.guard.check(f"Claro, mis reglas dicen: {leaked_line}", protected_lines=self.protected)
        self.assertFalse(verdict.allowed)
        self.assertEqual(verdict.reasons, ["fuga_prompt"])

    def test_prompt_leak_detection_ignores_whitespace_and_case(self) -> None:
        line = "- ALCANCE ESTRICTO: solo atiendes productos y servicios del negocio, precios,"
        verdict = self.guard.check("  - alcance   ESTRICTO: solo atiendes productos y servicios del negocio,   precios, ...", protected_lines=(line,))
        self.assertFalse(verdict.allowed)

    def test_internal_note_leak_is_blocked(self) -> None:
        note = "no prometer entregas el mismo día en temporada alta"
        verdict = self.guard.check(f"Ojo: {note}.", internal_notes=(note,))
        self.assertFalse(verdict.allowed)
        self.assertEqual(verdict.reasons, ["fuga_nota_interna"])

    def test_code_is_blocked(self) -> None:
        for reply in (
            "Claro:\n```python\nprint('hola')\n```",
            "def ordenar(lista):\n    return sorted(lista)",
            "SELECT id FROM pedidos",
            "function suma(a, b) { return a + b }",
        ):
            with self.subTest(reply=reply):
                verdict = self.guard.check(reply)
                self.assertFalse(verdict.allowed)
                self.assertEqual(verdict.reasons, ["codigo_en_respuesta"])

    def test_sensitive_pii_is_masked_but_allowed(self) -> None:
        verdict = self.guard.check("Anoté tu tarjeta 4111 1111 1111 1111, gracias")
        self.assertTrue(verdict.allowed)
        self.assertTrue(verdict.modified)
        self.assertEqual(verdict.reply, "Anoté tu tarjeta [tarjeta], gracias")
        # el teléfono del propio cliente sí se puede mencionar
        verdict = self.guard.check("te marco al 6671234567")
        self.assertFalse(verdict.modified)

    def test_unknown_urls_are_replaced(self) -> None:
        verdict = self.guard.check(
            "Paga aquí: https://evil.example/pay y ve tu cotización en https://app.example.test/quotes/public/abc "
            "o en https://tools.example/q/1",
            allowed_urls={"https://tools.example/q/1"},
        )
        self.assertTrue(verdict.allowed)
        self.assertTrue(verdict.modified)
        self.assertNotIn("evil.example", verdict.reply)
        self.assertIn("[enlace no disponible]", verdict.reply)
        self.assertIn("https://app.example.test/quotes/public/abc", verdict.reply)
        self.assertIn("https://tools.example/q/1", verdict.reply)
        self.assertEqual(verdict.reasons, ["url_no_autorizada"])

    def test_stable_redirect_for_same_seed(self) -> None:
        a = self.guard.check("```x```", business="B", seed="s1").reply
        b = self.guard.check("```y```", business="B", seed="s1").reply
        self.assertEqual(a, b)

    def test_empty_reply(self) -> None:
        verdict = self.guard.check("")
        self.assertTrue(verdict.allowed)
        self.assertFalse(verdict.changed)


class UrlHelpersTests(TestCase):
    def test_extract_and_tool_urls(self) -> None:
        self.assertEqual(extract_urls("ve a https://a.test/x, y https://b.test/y."), {"https://a.test/x", "https://b.test/y"})
        messages = [
            AIMessage(content="mira https://no.test/ai"),
            ToolMessage(content="Enlace: https://ok.test/q/1", tool_call_id="1", name="emitir_cotizacion"),
        ]
        self.assertEqual(urls_from_messages(messages), {"https://ok.test/q/1"})
