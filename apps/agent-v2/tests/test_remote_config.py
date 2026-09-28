from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from app import remote_config


class RemoteConfigTests(TestCase):
    """Apagado sin `FLAGSMITH_ENVIRONMENT_KEY`; siempre falla al default."""

    def setUp(self) -> None:
        self._client = remote_config._client
        self._broken = remote_config._broken
        remote_config._client = None
        remote_config._broken = False

    def tearDown(self) -> None:
        remote_config._client = self._client
        remote_config._broken = self._broken

    def test_disabled_by_default_returns_default(self) -> None:
        with patch.object(
            remote_config, "get_settings", return_value=SimpleNamespace(remote_config_enabled=False)
        ):
            self.assertTrue(remote_config.get_bool("scope_guard_enabled", True))
            self.assertEqual(remote_config.get_float("agent_temperature", 0.4), 0.4)
        self.assertIsNone(remote_config._client)

    def test_missing_dependency_falls_back_to_default(self) -> None:
        # El paquete `flagsmith` no está instalado en este entorno de
        # pruebas: exactamente el caso que debe caer al default.
        settings = SimpleNamespace(
            remote_config_enabled=True,
            flagsmith_environment_key="key",
            flagsmith_api_url="",
            flagsmith_poll_seconds=30,
        )
        with patch.object(remote_config, "get_settings", return_value=settings):
            self.assertFalse(remote_config.get_bool("scope_guard_enabled", False))
        self.assertTrue(remote_config._broken)

    def test_client_failure_falls_back_to_default(self) -> None:
        class BoomClient:
            def get_environment_flags(self):
                raise RuntimeError("boom")

        remote_config._client = BoomClient()
        self.assertEqual(remote_config.get_float("agent_temperature", 0.7), 0.7)

    def test_get_bool_reads_feature_flag(self) -> None:
        class FakeFlags:
            def is_feature_enabled(self, name):
                return name == "scope_guard_enabled"

        class FakeClient:
            def get_environment_flags(self):
                return FakeFlags()

        remote_config._client = FakeClient()
        self.assertTrue(remote_config.get_bool("scope_guard_enabled", False))
        self.assertFalse(remote_config.get_bool("output_guard_enabled", False))

    def test_get_float_requires_enabled_and_value(self) -> None:
        class FakeFlags:
            def is_feature_enabled(self, name):
                return True

            def get_feature_value(self, name):
                return 0.9

        class FakeClient:
            def get_environment_flags(self):
                return FakeFlags()

        remote_config._client = FakeClient()
        self.assertEqual(remote_config.get_float("agent_temperature", 0.4), 0.9)

    def test_get_float_disabled_flag_returns_default(self) -> None:
        class FakeFlags:
            def is_feature_enabled(self, name):
                return False

            def get_feature_value(self, name):
                return 0.9

        class FakeClient:
            def get_environment_flags(self):
                return FakeFlags()

        remote_config._client = FakeClient()
        self.assertEqual(remote_config.get_float("agent_temperature", 0.4), 0.4)
