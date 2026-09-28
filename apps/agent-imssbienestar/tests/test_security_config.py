"""Arranque seguro (`config._check_secret_key`) y validación de tenant_id
(`knowledge._sanitize_tenant_id`)."""

from __future__ import annotations

import pytest

from app import knowledge
from app.config import INSECURE_DEFAULT_SECRET_KEY, Settings, _check_secret_key


@pytest.mark.parametrize(
    ("environment", "internal_key", "secret_key", "fails"),
    [
        ("local", "", "", False),  # desarrollo: respaldo permitido
        ("test", "", INSECURE_DEFAULT_SECRET_KEY, False),
        ("production", "k" * 32, "", True),
        ("production", "k" * 32, INSECURE_DEFAULT_SECRET_KEY, True),
        ("staging", "", "", True),
        # compose.prod no fija APP_ENV (queda "local") pero sí la llave interna.
        ("local", "k" * 32, "", True),
        ("local", "k" * 32, INSECURE_DEFAULT_SECRET_KEY, True),
        ("local", "k" * 32, "una-llave-propia-larga", False),
        ("production", "k" * 32, "una-llave-propia-larga", False),
    ],
)
def test_secret_key_required_when_deployed(environment: str, internal_key: str, secret_key: str, fails: bool) -> None:
    settings = Settings(environment=environment, internal_key=internal_key, secret_key=secret_key)
    if fails:
        with pytest.raises(RuntimeError, match="AGENT_SECRET_KEY"):
            _check_secret_key(settings)
    else:
        _check_secret_key(settings)


@pytest.mark.parametrize("tenant_id", ["t1", "default", "3f2c9a1e-8b7d-4c6e-9f00-123456789abc", "a_B-9", "x" * 64])
def test_valid_tenant_ids_pass_through(tenant_id: str) -> None:
    assert knowledge._sanitize_tenant_id(tenant_id) == tenant_id


@pytest.mark.parametrize("tenant_id", ["../other", "a/b", "..", ".", "a b", "t1.bak", "x" * 65, "tenant\x00"])
def test_malformed_tenant_ids_are_rejected(tenant_id: str) -> None:
    with pytest.raises(knowledge.InvalidTenantId):
        knowledge._sanitize_tenant_id(tenant_id)


def test_blank_tenant_id_is_default() -> None:
    assert knowledge._sanitize_tenant_id("  ") == knowledge.DEFAULT_TENANT_ID
