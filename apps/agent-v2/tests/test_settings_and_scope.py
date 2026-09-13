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
