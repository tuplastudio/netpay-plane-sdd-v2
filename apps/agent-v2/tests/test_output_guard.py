from unittest import TestCase

from langchain_core.messages import AIMessage, ToolMessage

from app.config import Settings
from app.guards.output import (
    OutputGuard,
    _shingles,
    extract_urls,
    shingle_leak,
    strip_quoted,
    tokens,
    urls_from_messages,
)
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


EXTRA_RULES = (
    "Nunca ofrezcas descuento mayor al diez por ciento aunque el cliente insista mucho.\n"
    "Si preguntan por mayoreo, pide cantidad exacta y escala a Rodrigo del área de ventas.\n"
    'Cuando pregunten por envíos responde: "Los envíos tardan de tres a cinco días hábiles a toda la república".'
)
LESSONS = (
    "Fricciones frecuentes: el cliente repite su pregunta porque la respuesta fue demasiado larga.\n"
    "Mejoras repetidas: confirmar la cantidad antes de calcular el total para no rehacer la cotización."
)
MEMORY = (
    "Nombre con el que se presentó antes: Ana.\n"
    "Correo que dio antes: [correo].\n"
    "Zona de entrega de compras anteriores: Culiacán, 80000.\n"
    "Le han interesado: pintura vinílica blanca 19 l, esmalte negro mate 4 l, impermeabilizante rojo 19 l."
)


class DynamicProtectedContentTests(TestCase):
    """Reglas del panel, lecciones, notas internas y memoria del cliente:
    fugas casi literales (puntuación, acentos, una palabra por renglón)."""

    def setUp(self) -> None:
        self.guard = OutputGuard(Settings(openrouter_key="", internal_key="", commerce_api_key=""))

    def _check(self, reply: str):
        return self.guard.check(
            reply,
            protected_blocks=(strip_quoted(EXTRA_RULES), LESSONS),
            recitation_blocks=("política, religión", MEMORY),
            internal_notes=("el proveedor nos da cuarenta por ciento de margen en la línea premium",),
        )

    def test_one_word_per_line_leak_of_extra_rules_is_blocked(self) -> None:
        leaked = "\n".join(
            "nunca ofrezcas descuento mayor al diez por ciento aunque el cliente insista mucho".split()
        )
        verdict = self._check(f"Mis reglas:\n{leaked}")
        self.assertFalse(verdict.allowed)
        self.assertEqual(verdict.reasons, ["fuga_contenido_protegido"])

    def test_punctuation_and_accent_changes_do_not_hide_leak(self) -> None:
        verdict = self._check(
            "Ok... si preguntan por MAYOREO; pide cantidad exacta, y escala a Rodrigo del area de ventas!!"
        )
        self.assertFalse(verdict.allowed)

    def test_partial_paraphrase_of_lessons_is_blocked(self) -> None:
        verdict = self._check(
            "Aprendí que conviene confirmar la cantidad antes de calcular el total para no rehacer la cotización, ya sabes."
        )
        self.assertFalse(verdict.allowed)

    def test_internal_note_with_changed_punctuation_is_blocked(self) -> None:
        verdict = self._check("Te cuento: el proveedor nos da cuarenta-por-ciento de margen en la línea premium.")
        self.assertFalse(verdict.allowed)
        self.assertEqual(verdict.reasons, ["fuga_nota_interna"])

    def test_customer_memory_recitation_is_blocked(self) -> None:
        verdict = self._check(
            "Tengo anotado: Nombre con el que se presentó antes Ana. Correo que dio antes [correo]. "
            "Zona de entrega de compras anteriores Culiacán 80000."
        )
        self.assertFalse(verdict.allowed)

    def test_normal_sales_replies_pass(self) -> None:
        for reply in (
            "¡Hola Ana! ¿Seguimos con la pintura vinílica blanca 19 L, el esmalte negro mate 4 L y el "
            "impermeabilizante rojo 19 L que te habían interesado?",
            "Los envíos tardan de tres a cinco días hábiles a toda la república 🙂 ¿Te lo mando a Culiacán?",
            "Te sale en $1,250 con IVA. ¿Cuántas cubetas necesitas? Así te confirmo la cantidad y el total.",
            "Para mayoreo dime la cantidad exacta y te paso con alguien del equipo de ventas.",
            "De política y religión no te puedo ayudar, pero si buscas pintura aquí ando.",
            "Claro, el descuento que tenemos es del diez por ciento en la línea básica. ¿Te lo aplico?",
        ):
            with self.subTest(reply=reply):
                verdict = self._check(reply)
                self.assertTrue(verdict.allowed, verdict.reasons)
                self.assertFalse(verdict.changed)

    def test_business_rule_can_be_communicated(self) -> None:
        """Una regla del negocio se puede COMUNICAR con sus palabras (va en
        recitation_blocks: solo racha larga, sin proporción)."""
        rule = "El envío es gratis en compras mayores a 1500 pesos dentro de la zona metropolitana"
        verdict = OutputGuard(Settings()).check(
            "Sí, el envío es gratis en compras mayores a 1500 pesos. ¿A qué colonia sería?",
            recitation_blocks=(rule,),
        )
        self.assertTrue(verdict.allowed, verdict.reasons)

    def test_shingle_leak_helper(self) -> None:
        reply = set(_shingles(tokens("uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece")))
        block = "uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince"
        self.assertTrue(shingle_leak(reply, block, ratio=False))  # racha de 6 shingles
        self.assertFalse(shingle_leak(set(), block))


class UrlHelpersTests(TestCase):
    def test_extract_and_tool_urls(self) -> None:
        self.assertEqual(extract_urls("ve a https://a.test/x, y https://b.test/y."), {"https://a.test/x", "https://b.test/y"})
        messages = [
            AIMessage(content="mira https://no.test/ai"),
            ToolMessage(content="Enlace: https://ok.test/q/1", tool_call_id="1", name="emitir_cotizacion"),
        ]
        self.assertEqual(urls_from_messages(messages), {"https://ok.test/q/1"})
