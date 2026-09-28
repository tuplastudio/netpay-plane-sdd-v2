from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from app import observability


class ReportTurnTests(TestCase):
    """`report_turn` es opt-in (Langfuse) y nunca debe reventar el turno."""

    def setUp(self) -> None:
        self._client = observability._client
        self._broken = observability._broken
        observability._client = None
        observability._broken = False

    def tearDown(self) -> None:
        observability._client = self._client
        observability._broken = self._broken

    def test_disabled_by_default_is_noop(self) -> None:
        with patch.object(observability, "get_settings", return_value=SimpleNamespace(langfuse_enabled=False)):
            observability.report_turn({"turnId": "abc"}, tenant_id="tenant-1")
        self.assertIsNone(observability._client)

    def test_missing_dependency_degrades_silently(self) -> None:
        # El paquete `langfuse` no está instalado en este entorno de pruebas:
        # exactamente el caso que debe degradar sin romper el turno.
        settings = SimpleNamespace(
            langfuse_enabled=True,
            langfuse_public_key="pk",
            langfuse_secret_key="sk",
            langfuse_host="https://cloud.langfuse.com",
        )
        with patch.object(observability, "get_settings", return_value=settings):
            observability.report_turn({"turnId": "abc"}, tenant_id="tenant-1")
        self.assertTrue(observability._broken)

    def test_client_failure_does_not_raise(self) -> None:
        class BoomClient:
            def trace(self, **kwargs):
                raise RuntimeError("boom")

        observability._client = BoomClient()
        observability.report_turn({"turnId": "abc"}, tenant_id="tenant-1")  # no debe lanzar

    def test_reports_payload_and_tenant_when_configured(self) -> None:
        calls = []

        class FakeClient:
            def trace(self, **kwargs):
                calls.append(kwargs)

        observability._client = FakeClient()
        observability.report_turn({"turnId": "abc", "engine": "langgraph"}, tenant_id="tenant-1")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["id"], "abc")
        self.assertEqual(calls[0]["metadata"]["tenantId"], "tenant-1")
        self.assertEqual(calls[0]["metadata"]["engine"], "langgraph")
