import logging
from types import SimpleNamespace
from typing import Any
from unittest import TestCase
from unittest.mock import patch

from app.guards import pii


class DetectRedactTests(TestCase):
    def test_email(self) -> None:
        self.assertEqual(pii.redact("escríbeme a laura.m@example.com por favor"), "escríbeme a [correo] por favor")

    def test_phone_formats(self) -> None:
        for raw in ("6671234567", "667 123 4567", "+52 1 667 123 4567", "(667) 123-4567", "+526671234567"):
            with self.subTest(raw=raw):
                self.assertEqual(pii.redact(f"mi cel es {raw} ok"), "mi cel es [teléfono] ok")

    def test_card_with_luhn(self) -> None:
        self.assertEqual(pii.redact("tarjeta 4111 1111 1111 1111"), "tarjeta [tarjeta]")
        self.assertEqual(pii.redact("4111111111111111"), "[tarjeta]")
        # 16 dígitos sin Luhn válido no es tarjeta (y por longitud tampoco teléfono)
        self.assertEqual(pii.redact("folio 1234567890123456"), "folio 1234567890123456")

    def test_clabe(self) -> None:
        self.assertEqual(pii.redact("CLABE 012345678901234567 banco"), "CLABE [clabe] banco")

    def test_rfc_and_curp(self) -> None:
        self.assertEqual(pii.redact("RFC GAMC900101ABC"), "RFC [rfc]")
        self.assertEqual(pii.redact("CURP GAMC900101HSLRRL09"), "CURP [curp]")

    def test_prices_and_quantities_are_not_pii(self) -> None:
        text = "son $1,500.00 por 12 piezas, total $18,000.00"
        self.assertEqual(pii.redact(text), text)
        self.assertEqual(pii.detect("pedido 12345"), [])

    def test_aggressive_masks_long_numbers(self) -> None:
        self.assertEqual(pii.redact("folio 1234567", aggressive=True), "folio [número]")
        self.assertEqual(pii.redact("folio 12345", aggressive=True), "folio 12345")

    def test_detect_kinds_and_positions(self) -> None:
        matches = pii.detect("a@b.mx y 6671234567")
        self.assertEqual([m.kind for m in matches], ["email", "phone"])
        self.assertTrue(pii.contains_pii("a@b.mx"))
        self.assertFalse(pii.contains_pii("a@b.mx", kinds=("card",)))
        self.assertTrue(pii.contains_pii("4111 1111 1111 1111", kinds=pii.SENSITIVE_KINDS))

    def test_empty(self) -> None:
        self.assertEqual(pii.redact(""), "")
        self.assertEqual(pii.detect(""), [])


class RedactNamesTests(TestCase):
    """`redact_names` (Presidio) es opt-in y nunca debe reventar el turno."""

    def setUp(self) -> None:
        # Aislar el caché de proceso del analizador entre pruebas.
        self._analyzer = pii._presidio_analyzer
        self._broken = pii._presidio_broken
        pii._presidio_analyzer = None
        pii._presidio_broken = False

    def tearDown(self) -> None:
        pii._presidio_analyzer = self._analyzer
        pii._presidio_broken = self._broken

    def test_disabled_by_default_is_noop(self) -> None:
        with patch.object(pii, "get_settings", return_value=SimpleNamespace(presidio_enabled=False)):
            self.assertEqual(pii.redact_names("Juan Pérez vive en Culiacán"), "Juan Pérez vive en Culiacán")

    def test_empty_text_is_noop(self) -> None:
        with patch.object(pii, "get_settings", return_value=SimpleNamespace(presidio_enabled=True)):
            self.assertEqual(pii.redact_names(""), "")

    def test_missing_dependency_degrades_to_original_text(self) -> None:
        # presidio-analyzer/spacy no están instalados en este entorno de
        # pruebas: exactamente el caso que debe degradar sin romper nada.
        with patch.object(pii, "get_settings", return_value=SimpleNamespace(presidio_enabled=True)):
            text = "Juan Pérez vive en Culiacán"
            self.assertEqual(pii.redact_names(text), text)
        self.assertTrue(pii._presidio_broken)

    def test_analyzer_failure_returns_original_text(self) -> None:
        class BoomAnalyzer:
            def analyze(self, **kwargs):
                raise RuntimeError("boom")

        pii._presidio_analyzer = BoomAnalyzer()
        with patch.object(pii, "get_settings", return_value=SimpleNamespace(presidio_enabled=True)):
            text = "Juan Pérez vive en Culiacán"
            self.assertEqual(pii.redact_names(text), text)

    def test_masks_detected_entities(self) -> None:
        class FakeResult:
            def __init__(self, entity_type: str, start: int, end: int) -> None:
                self.entity_type = entity_type
                self.start = start
                self.end = end

        class FakeAnalyzer:
            def analyze(self, *, text: str, language: str, entities: list[str]):
                idx = text.index("Juan Pérez")
                return [FakeResult("PERSON", idx, idx + len("Juan Pérez"))]

        pii._presidio_analyzer = FakeAnalyzer()
        with patch.object(pii, "get_settings", return_value=SimpleNamespace(presidio_enabled=True)):
            self.assertEqual(
                pii.redact_names("Juan Pérez vive en Culiacán"), "[nombre] vive en Culiacán"
            )

    def test_composes_after_regex_redact(self) -> None:
        class FakeResult:
            def __init__(self, entity_type: str, start: int, end: int) -> None:
                self.entity_type = entity_type
                self.start = start
                self.end = end

        class FakeAnalyzer:
            def analyze(self, *, text: str, language: str, entities: list[str]):
                idx = text.index("Juan")
                return [FakeResult("PERSON", idx, idx + len("Juan"))]

        pii._presidio_analyzer = FakeAnalyzer()
        with patch.object(pii, "get_settings", return_value=SimpleNamespace(presidio_enabled=True)):
            combined = pii.redact_names(pii.redact("Juan, escríbeme a juan@example.com"))
            self.assertEqual(combined, "[nombre], escríbeme a [correo]")


class LoggingFilterTests(TestCase):
    def test_filter_masks_formatted_message(self) -> None:
        logger = logging.getLogger("pii-test")
        logger.propagate = False
        records: list[logging.LogRecord] = []

        class Capture(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                records.append(record)

        handler = Capture()
        logger.addHandler(handler)
        pii.install_log_redaction(logger)
        pii.install_log_redaction(logger)  # idempotente
        self.assertEqual(len(handler.filters), 1)
        logger.warning("hilo %s falló", "tenant:+526671234567")
        self.assertEqual(records[-1].getMessage(), "hilo tenant:[teléfono] falló")


class UvicornLogRedactionTests(TestCase):
    """Bajo uvicorn el raíz no tiene handlers y ``uvicorn.access`` tiene el
    suyo con ``propagate=False``: el filtro tiene que llegar a ambos."""

    def setUp(self) -> None:
        self.root = logging.getLogger()
        self.saved_root = list(self.root.handlers)
        self.access = logging.getLogger("uvicorn.access")
        self.saved_access = (list(self.access.handlers), self.access.propagate, self.access.level)

    def tearDown(self) -> None:
        self.root.handlers = self.saved_root
        self.access.handlers, self.access.propagate, level = self.saved_access
        self.access.setLevel(level)

    def _stream_handler(self, formatter: logging.Formatter) -> tuple[logging.Handler, Any]:
        import io

        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        handler.setFormatter(formatter)
        return handler, stream

    def test_access_log_path_is_redacted_and_formatter_still_works(self) -> None:
        from uvicorn.logging import AccessFormatter

        handler, stream = self._stream_handler(AccessFormatter('%(client_addr)s "%(request_line)s" %(status_code)s'))
        self.access.handlers = [handler]
        self.access.propagate = False
        self.access.setLevel(logging.INFO)
        self.root.handlers = []  # como bajo uvicorn
        pii.install_log_redaction()
        self.assertTrue(self.root.handlers, "debe crear un handler en el raíz")
        self.assertTrue(any(isinstance(f, pii.RedactingFilter) for f in self.root.handlers[0].filters))
        self.access.info(
            '%s - "%s %s HTTP/%s" %d',
            "10.0.0.1:5555", "GET",
            "/conversations/t1%3A5215512345678/messages?phone=%2B525512345678&redact=false", "1.1", 200,
        )
        out = stream.getvalue()
        self.assertNotIn("5215512345678", out)
        self.assertNotIn("525512345678", out)
        self.assertIn("[teléfono]", out)
        self.assertIn("200", out)

    def test_exception_text_is_redacted(self) -> None:
        handler, stream = self._stream_handler(logging.Formatter("%(message)s"))
        logger = logging.getLogger("pii-exc-test")
        logger.propagate = False
        logger.handlers = [handler]
        pii.install_log_redaction(logger)
        try:
            raise ValueError("cliente ana@example.com con tel 5215512345678")
        except ValueError:
            logger.exception("falló el turno de %s", "t1:5215512345678")
        out = stream.getvalue()
        self.assertNotIn("5215512345678", out)
        self.assertNotIn("ana@example.com", out)
        self.assertIn("ValueError", out)
