import pytest
from unittest import TestCase

from app.agent_settings import AgentSettings, sanitize
from app.config import Settings
from app.guards.scope import _parse, is_off_topic, redirect_reply
from tests.conftest import FakeModel


class PromptVersionSettingTests(TestCase):
    def test_sanitize_prompt_version(self) -> None:
        self.assertEqual(sanitize({"prompt_version": "v1.0.0"}).prompt_version, "1.0.0")
        self.assertEqual(sanitize({"prompt_version": "LATEST"}).prompt_version, "latest")
        self.assertEqual(sanitize({"prompt_version": "1.2"}).prompt_version, "")
        self.assertEqual(sanitize({"prompt_version": "../etc"}).prompt_version, "")
        self.assertEqual(sanitize({}).prompt_version, "")
        base = AgentSettings(prompt_version="1.0.0")
        self.assertEqual(sanitize({"tone": "x"}, base=base).prompt_version, "1.0.0")

    def test_to_dict_exposes_prompt_version(self) -> None:
        self.assertIn("prompt_version", AgentSettings().to_dict())


class ScopeGuardTests(TestCase):
    def test_parse(self) -> None:
        self.assertTrue(_parse('{"on_topic": true}'))
        self.assertFalse(_parse('```json\n{"on_topic": false}\n```'))
        self.assertIsNone(_parse("nada"))
        self.assertIsNone(_parse('{"on_topic": "sí"}'))

    def test_redirect_is_stable(self) -> None:
        self.assertEqual(redirect_reply("Aglos", "x"), redirect_reply("Aglos", "x"))
        self.assertIn("Aglos", redirect_reply("Aglos", "x"))


@pytest.mark.asyncio
async def test_scope_guard_fail_open_and_closed() -> None:
    settings_open = Settings(scope_guard_enabled=True, scope_guard_fail_closed=False)
    settings_closed = Settings(scope_guard_enabled=True, scope_guard_fail_closed=True)
    broken = FakeModel(error=RuntimeError("down"))
    assert await is_off_topic("hola", model=broken, settings=settings_open) is False
    assert await is_off_topic("hola", model=broken, settings=settings_closed) is True
    assert await is_off_topic("hola", model=broken, settings=settings_open, fail_closed=True) is True
    garbage = FakeModel(replies=["???"])
    assert await is_off_topic("hola", model=garbage, settings=settings_closed) is True
    clear = FakeModel(replies=['{"on_topic": false}'])
    assert await is_off_topic("clima?", model=clear, settings=settings_open) is True
    disabled = Settings(scope_guard_enabled=False)
    assert await is_off_topic("x", model=broken, settings=disabled) is False


class SettingsValidationTests(TestCase):
    """`Settings.__post_init__` rechaza valores fuera de rango."""

    def test_temperature_out_of_range(self) -> None:
        with pytest.raises(Exception) as info:
            Settings(temperature=3.0)
        assert "AGENT_TEMPERATURE" in str(info.value)

    def test_negative_timeout_rejected(self) -> None:
        with pytest.raises(Exception) as info:
            Settings(turn_timeout_seconds=-1.0)
        assert "TIMEOUT" in str(info.value).upper()

    def test_image_timeout_must_exceed_text(self) -> None:
        with pytest.raises(Exception) as info:
            Settings(turn_timeout_seconds=42.0, turn_timeout_image_seconds=42.0)
        assert "IMAGE" in str(info.value).upper()

    def test_zero_recursion_limit_rejected(self) -> None:
        with pytest.raises(Exception):
            Settings(recursion_limit=0)

    def test_zero_hand_off_rejected(self) -> None:
        with pytest.raises(Exception) as info:
            Settings(handoff_after_failures=0)
        assert "HANDOFF" in str(info.value).upper()

    def test_zero_input_chars_rejected(self) -> None:
        with pytest.raises(Exception):
            Settings(max_input_chars=0)

    def test_default_settings_are_valid(self) -> None:
        # Defaults por env = OK
        Settings(turn_timeout_seconds=10.0, turn_timeout_image_seconds=20.0)
