"""Robustez, capacidad y ahorro de tokens (cambios de 2026-09-29).

- Atajo determinista del clasificador de tema (`obviously_on_topic`).
- Tope del bloque de catálogo (`cap_catalog`).
- Memo del `TenantBundle` por turno (`turn_scope`).
- Contabilidad de tokens por turno (`turn_usage`).
- Tope de turnos simultáneos (`TurnLimiter`) y su respuesta suave.
- Idempotencia best-effort (un sqlite roto no convierte un turno bueno en 500).
- Tope del cuerpo HTTP (413 por Content-Length).
- Validación del slug de modelo del panel y lista de modelos permitidos.
"""

from __future__ import annotations

import asyncio
import logging

import pytest
from fastapi.testclient import TestClient

from app import main, turn_usage
from app.agent_settings import AgentSettings, sanitize
from app.config import Settings
from app.guards import obviously_on_topic
from app.memory import reset_episode_store
from app.pipeline.trace import TurnTrace, log_turn_done
from app.runtime import TurnLimiter, TurnOverloaded
from app.tenant_context import cap_catalog, resolve_tenant_bundle, turn_scope
from tests.conftest import FakeAgent


# ---------------------------------------------------------------- scope fast path


@pytest.mark.parametrize(
    "text",
    ["hola", "Sí", "ok gracias", "2", "5 x 20 L", "$150", "cuánto sale", "la de 19 litros", "quiero 2 cubetas"],
)
def test_obviously_on_topic_short_commercial(text: str) -> None:
    assert obviously_on_topic(text) is True


@pytest.mark.parametrize(
    "text",
    [
        "qué clima hace hoy en Culiacán",
        "escribe un poema sobre el mar",
        "cuál es la capital de Francia y por qué",
        "me puedes explicar cómo funciona la fotosíntesis",
        "",
    ],
)
def test_obviously_on_topic_leaves_doubt_to_llm(text: str) -> None:
    assert obviously_on_topic(text) is False


def test_obviously_on_topic_mid_sale_allows_longer_commercial_sentence() -> None:
    text = "entonces mejor agrega dos cubetas más y dime el total con envío"
    assert obviously_on_topic(text) is False
    assert obviously_on_topic(text, mid_sale=True) is True


# ---------------------------------------------------------------- catalog cap


def test_cap_catalog_keeps_whole_products_and_notes_the_rest() -> None:
    text = "\n".join(
        f"Producto {i}:\n  - Presentación {i} | SKU-{i} | $100" for i in range(1, 21)
    )
    capped = cap_catalog(text, 200)
    assert len(capped) <= 200 + 200  # la nota final puede exceder unos chars
    assert "catálogo recortado" in capped
    assert "usa buscar_productos" in capped
    # Nunca deja un encabezado sin sus variantes.
    lines = capped.splitlines()
    for i, line in enumerate(lines[:-1]):
        if line.endswith(":"):
            assert lines[i + 1].startswith("  -"), line
    assert cap_catalog(text, 0) == text
    assert cap_catalog("corto", 100) == "corto"


# ---------------------------------------------------------------- turn memo


def test_turn_scope_memoizes_bundle_within_turn() -> None:
    async def scenario() -> None:
        with turn_scope():
            first = await resolve_tenant_bundle("t-memo", include_catalog=False)
            second = await resolve_tenant_bundle("t-memo", include_catalog=False)
            other = await resolve_tenant_bundle("t-memo", include_catalog=False, include_lessons=False)
            assert first is second
            assert other is not first
        outside = await resolve_tenant_bundle("t-memo", include_catalog=False)
        assert outside is not first

    asyncio.run(scenario())


# ---------------------------------------------------------------- usage


def test_turn_usage_records_only_inside_a_turn(caplog: pytest.LogCaptureFixture) -> None:
    turn_usage.record("m", 10, 5)  # fuera de turno: no-op, nunca lanza
    assert turn_usage.current() is None
    token = turn_usage.begin_turn_usage()
    try:
        turn_usage.record("google/gemini-2.0-flash-001", 1200, 80, cached_tokens=900)
        turn_usage.record("google/gemini-2.0-flash-001", 300, 20)
        usage = turn_usage.current()
        assert usage is not None
        assert usage.to_dict() == {
            "modelCalls": 2,
            "inputTokens": 1500,
            "outputTokens": 100,
            "cachedTokens": 900,
            "models": ["google/gemini-2.0-flash-001"],
        }
        with caplog.at_level(logging.INFO, logger="test.turn"):
            log_turn_done(logging.getLogger("test.turn"), TurnTrace("abc123"))
        assert "'usage': {'modelCalls': 2" in caplog.text
    finally:
        turn_usage.end_turn_usage(token)
    assert turn_usage.current() is None


# ---------------------------------------------------------------- limiter


def test_turn_limiter_per_tenant_and_global() -> None:
    async def scenario() -> None:
        limiter = TurnLimiter(max_total=2, max_per_tenant=1, queue_timeout=0.05)
        async with limiter.acquire("a"):
            assert limiter.in_flight("a") == 1
            # Mismo tenant: sin lugar.
            with pytest.raises(TurnOverloaded) as exc:
                async with limiter.acquire("a"):
                    pass
            assert exc.value.scope == "tenant"
            # Otro tenant: sí, hasta llenar el global.
            async with limiter.acquire("b"):
                assert limiter.in_flight() == 2
                with pytest.raises(TurnOverloaded) as exc2:
                    async with limiter.acquire("c"):
                        pass
                assert exc2.value.scope == "proceso"
        # Al soltar, los semáforos por tenant se purgan y todo vuelve a entrar.
        assert limiter.in_flight() == 0
        assert limiter._tenants == {}
        async with limiter.acquire("a"):
            pass

    asyncio.run(scenario())


def test_turn_limiter_disabled_with_zero() -> None:
    async def scenario() -> None:
        limiter = TurnLimiter(0, 0, 0)
        assert not limiter.enabled
        async with limiter.acquire("a"):
            async with limiter.acquire("a"):
                assert limiter.in_flight("a") == 2

    asyncio.run(scenario())


# ---------------------------------------------------------------- settings


def test_model_slug_validation_in_panel_settings() -> None:
    ok = sanitize({"text_model": "anthropic/claude-3-5-haiku"})
    assert ok.text_model == "anthropic/claude-3-5-haiku"
    for bad in ("gpt-4o", "openai/gpt 4o", "../x", "openai/", "; DROP", "OPENAI/x"):
        assert sanitize({"text_model": bad}).text_model == "", bad
    assert sanitize({"text_model": ""}).text_model == ""


def test_allowed_models_with_global_key() -> None:
    settings = Settings()
    assert settings.model_allowed_with_global_key(settings.model)
    assert settings.model_allowed_with_global_key("")
    assert settings.model_allowed_with_global_key("openai/gpt-4o-mini")
    assert not settings.model_allowed_with_global_key("openai/o1-pro")


def test_effective_max_request_bytes_derives_from_video() -> None:
    settings = Settings()
    assert settings.effective_max_request_bytes == (settings.max_video_bytes * 4) // 3 + 1024 * 1024


# ---------------------------------------------------------------- API


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    reset_episode_store()
    with TestClient(main.app) as test_client:
        fake = FakeAgent()
        monkeypatch.setattr(main.runtime, "agent", fake)
        monkeypatch.setattr(main.runtime, "utility_model", None)
        test_client.fake = fake  # type: ignore[attr-defined]
        yield test_client
    reset_episode_store()


def _chat(client: TestClient, text: str, **extra):
    payload = {"tenantId": "t1", "conversationId": "c-rob", "text": text, "channel": "web", **extra}
    response = client.post("/chat", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def test_request_body_over_limit_is_413_before_parsing(client: TestClient) -> None:
    limit = main.settings.effective_max_request_bytes
    response = client.post(
        "/chat",
        content=b"{}",
        headers={"Content-Type": "application/json", "Content-Length": str(limit + 1)},
    )
    assert response.status_code == 413
    assert "demasiado grande" in response.json()["detail"]


def test_scope_guard_fast_path_counts_skips(client: TestClient) -> None:
    before = client.get("/metrics").json()["counters"].get("turn.scope_guard_skipped", 0)
    body = _chat(client, "sí")
    assert body["engine"] == "langgraph"
    after = client.get("/metrics").json()["counters"].get("turn.scope_guard_skipped", 0)
    assert after == before + 1


def test_idempotency_store_failure_does_not_break_turn(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def boom(*_a, **_k):
        raise RuntimeError("sqlite bloqueado")

    monkeypatch.setattr(main.runtime.idempotency, "put", boom)
    monkeypatch.setattr(main.runtime.idempotency, "get", boom)
    body = _chat(client, "hola", messageId="m-boom")
    assert body["engine"] == "langgraph" and body["reply"]
    assert client.get("/metrics").json()["counters"]["turn.idempotency_error"] >= 2


def test_overloaded_tenant_gets_soft_reply_and_no_idempotency(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    limiter = TurnLimiter(max_total=0, max_per_tenant=1, queue_timeout=0.01)
    asyncio.run(limiter._tenant_sem("t1").acquire())  # otro turno del tenant "en vuelo"
    limiter._in_flight["t1"] = 1
    monkeypatch.setattr(main.runtime, "limiter", limiter)
    body = _chat(client, "hola", messageId="m-over")
    assert body["engine"] == "overloaded" and body["intent"] == "OVERLOADED"
    assert body["reply"] and body["handoff"] is False
    assert client.fake.invocations == []
    # El reintento del puente con el mismo messageId NO recibe la respuesta
    # cacheada: cuando haya lugar, se atiende de verdad.
    limiter._tenant_sem("t1").release()
    limiter._in_flight.pop("t1", None)
    body2 = _chat(client, "hola", messageId="m-over")
    assert body2["engine"] == "langgraph"
    diag = client.get("/diagnostics?tenantId=t1").json()
    assert diag["capacity"]["maxConcurrentTurnsPerTenant"] >= 0
    assert diag["guards"]["scopeGuardFastPath"] is True
