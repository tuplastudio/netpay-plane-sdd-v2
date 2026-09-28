import json
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.memory.episodic import (
    FRICTION_CODES,
    Episode,
    EpisodeStore,
    conversation_key,
    enrich_with_llm,
    forbidden_terms_from_state,
    heuristic_episode,
    redacted_transcript,
    render_lessons,
    scrub_list,
    scrub_text,
)
from tests.conftest import FakeModel

STATE = {
    "stage": "COTIZACION_EMITIDA",
    "carts": {
        "1": {
            "cartId": "1",
            "quoteId": "q-1",
            "lines": [{"variantId": "v1", "sku": "JAZ-ORIG-500", "title": "Jaztea Original 500ml", "quantity": "12"}],
            "stage": "COTIZACION_EMITIDA",
        }
    },
    "customer": {"name": "Laura Martínez", "phone": "6671234567", "email": "laura@x.mx"},
    "handoff": False,
}
MESSAGES = [
    HumanMessage(content="Hola, quiero jaztea original, soy Laura Martínez, mi cel 6671234567"),
    AIMessage(content="", tool_calls=[{"name": "buscar_productos", "args": {}, "id": "c1"}]),
    ToolMessage(content="Resultados: ...", tool_call_id="c1", name="buscar_productos"),
    AIMessage(content="Va Laura, te salen en $180. ¿Te la cotizo?"),
    HumanMessage(content="sí"),
    AIMessage(content="", tool_calls=[{"name": "emitir_cotizacion", "args": {}, "id": "c2"}]),
    ToolMessage(content="ERROR: la API comercial no está disponible", tool_call_id="c2", name="emitir_cotizacion"),
    AIMessage(content="Se me trabó el sistema, dame un momento " * 20),
]


def test_scrub_text_removes_pii_and_business_terms() -> None:
    terms = forbidden_terms_from_state(STATE, "Jaztea Mayoreo", "Jazbot")
    assert "Laura Martínez" in terms and "JAZ-ORIG-500" in terms and "Jaztea Mayoreo" in terms
    out = scrub_text("El agente saludó a Laura y le ofreció Jaztea Original 500ml al 6671234567", terms)
    assert "Laura" not in out and "Jaztea" not in out and "6671234567" not in out
    assert "[…]" in out and "[teléfono]" in out


def test_scrub_text_drops_field_if_still_risky() -> None:
    assert scrub_text("escribir a laura@@x.mx") == "" or "@" not in scrub_text("escribir a laura@@x.mx")
    assert scrub_text("ver https://sitio.test/x") == ""
    assert scrub_text("folio 123456") == "folio [número]"
    assert scrub_text("   texto   con   espacios  ") == "texto con espacios"


def test_scrub_list_limits_and_dedups() -> None:
    items = ["Preguntó la cantidad antes de cotizar", "preguntó la cantidad antes de cotizar", "Fue directo", "Cerró rápido", "Extra"]
    out = scrub_list(items)
    assert len(out) == 3
    assert out[0] == "Preguntó la cantidad antes de cotizar"
    assert scrub_list("no es lista") == []


def test_conversation_key_hides_phone() -> None:
    key = conversation_key("t1", "t1:+526671234567")
    assert "667" not in key and len(key) == 16
    assert key == conversation_key("t1", "t1:+526671234567")


def test_heuristic_episode_from_state_and_shape() -> None:
    episode = heuristic_episode(MESSAGES, STATE, tenant_id="t1", conversation_id="c1", channel="whatsapp", prompt_version="1.1.0", model="m")
    assert episode.turns == 2
    assert episode.tool_calls == 2 and episode.tool_errors == 1
    assert episode.outcome == "COTIZACION_EMITIDA"
    assert set(episode.friction) == {"error_herramienta", "respuesta_larga"}
    assert episode.source == "heuristic"
    payload = json.dumps(episode.to_dict())
    for leak in ("Laura", "6671234567", "laura@x.mx", "JAZ-ORIG", "Jaztea"):
        assert leak not in payload


def test_heuristic_outcomes() -> None:
    assert heuristic_episode([], {"handoff": True, "handoff_reason": "QUEJA"}, tenant_id="t", conversation_id="c").outcome == "ESCALADO"
    assert heuristic_episode([], {"carts": {"1": {"checkoutLink": "x"}}}, tenant_id="t", conversation_id="c").outcome == "PAGO_ENVIADO"
    assert heuristic_episode([], {"carts": {"1": {"lines": [{}]}}}, tenant_id="t", conversation_id="c").outcome == "CARRITO_SIN_CIERRE"
    assert heuristic_episode([], {}, tenant_id="t", conversation_id="c").outcome == "SIN_RESPUESTA"
    assert heuristic_episode([HumanMessage(content="hola")], {}, tenant_id="t", conversation_id="c").outcome == "SOLO_CONSULTA"
    quiet = heuristic_episode([HumanMessage(content="hola"), AIMessage(content="hola!")], {}, tenant_id="t", conversation_id="c")
    assert quiet.friction == ["sin_friccion"]


def test_heuristic_outcome_is_the_most_advanced_across_concurrent_carts() -> None:
    """Un cliente con dos pedidos a la vez: uno pagado y otro solo en carrito
    cuenta como PAGO_ENVIADO, no como el peor de los dos."""
    state = {
        "carts": {
            "playeras": {"checkoutLink": "https://pay/1", "lines": [{"variantId": "v1", "quantity": "3"}]},
            "regalo": {"lines": [{"variantId": "v2", "quantity": "1"}]},
        }
    }
    episode = heuristic_episode([], state, tenant_id="t", conversation_id="c")
    assert episode.outcome == "PAGO_ENVIADO"


def test_redacted_transcript_has_no_pii_or_business_terms() -> None:
    terms = forbidden_terms_from_state(STATE, "Jaztea")
    transcript = redacted_transcript(MESSAGES, terms)
    assert "cliente:" in transcript and "agente:" in transcript
    assert "herramienta: [error]" in transcript and "herramienta: [ok]" in transcript
    for leak in ("Laura", "6671234567", "Jaztea", "JAZ-ORIG"):
        assert leak not in transcript


@pytest.mark.asyncio
async def test_enrich_with_llm_scrubs_model_output() -> None:
    episode = heuristic_episode(MESSAGES, STATE, tenant_id="t1", conversation_id="c1")
    model = FakeModel(replies=[json.dumps({
        "mood_start": "contento",
        "mood_end": "MOLESTO",
        "friction": ["tardo_en_cerrar", "no_existe"],
        "what_worked": ["Confirmó rápido con Laura Martínez", "Llamó al 6671234567"],
        "improvements": ["Avisar antes de que falle el sistema", "Ofrecer Jaztea Original 500ml"],
        "summary": "Conversación fluida hasta que falló la herramienta; el cliente Laura se molestó.",
    })])
    terms = forbidden_terms_from_state(STATE, "Jaztea")
    enriched = await enrich_with_llm(episode, MESSAGES, model=model, forbidden_terms=terms)
    assert enriched.source == "llm"
    assert enriched.mood_start == "contento" and enriched.mood_end == "molesto"
    assert "tardo_en_cerrar" in enriched.friction and "no_existe" not in enriched.friction
    assert "error_herramienta" in enriched.friction, "la fricción heurística se conserva"
    assert all(code in FRICTION_CODES for code in enriched.friction)
    payload = json.dumps(enriched.to_dict())
    for leak in ("Laura", "6671234567", "Jaztea", "JAZ-ORIG"):
        assert leak not in payload
    assert enriched.improvements[0] == "Avisar antes de que falle el sistema"


@pytest.mark.asyncio
async def test_enrich_with_llm_never_raises() -> None:
    episode = heuristic_episode(MESSAGES, STATE, tenant_id="t1", conversation_id="c1")
    broken = FakeModel(error=RuntimeError("boom"))
    same = await enrich_with_llm(episode, MESSAGES, model=broken, forbidden_terms=())
    assert same.source == "heuristic"
    garbage = FakeModel(replies=["no json"])
    same = await enrich_with_llm(episode, MESSAGES, model=garbage, forbidden_terms=())
    assert same.source == "heuristic"


@pytest.mark.asyncio
async def test_store_roundtrip_stats_and_lessons() -> None:
    with TemporaryDirectory() as directory:
        store = EpisodeStore(Path(directory) / "ep.sqlite", max_rows_per_tenant=3, lessons_ttl_seconds=0)
        for i in range(5):
            ep = heuristic_episode(MESSAGES, STATE, tenant_id="t1", conversation_id=f"c{i}")
            ep.improvements = ["Preguntar la cantidad antes de cotizar"] if i % 2 == 0 else ["Cerrar más rápido"]
            await store.save(ep)
        other = heuristic_episode([], {}, tenant_id="t2", conversation_id="x")
        await store.save(other)

        listed = await store.list("t1")
        assert len(listed) == 3, "tope por tenant"
        assert all(isinstance(e, Episode) for e in listed)
        assert len(await store.list("t2")) == 1

        stats = await store.stats("t1")
        assert stats["episodes"] == 3 and stats["outcomes"] == {"COTIZACION_EMITIDA": 3}
        assert stats["friction"]["error_herramienta"] == 3

        lessons = await store.lessons("t1", limit=5)
        assert "error_herramienta (3)" in lessons
        assert "Preguntar la cantidad antes de cotizar" in lessons
        assert await store.lessons("t2", limit=0) == ""
        assert await store.lessons("t3", limit=5) == ""

        # reemplazo por conversación: guardar de nuevo c4 no duplica
        again = heuristic_episode(MESSAGES, STATE, tenant_id="t1", conversation_id="c4")
        await store.save(again)
        assert len(await store.list("t1")) == 3

        assert await store.delete_tenant("t1") == 3
        assert await store.list("t1") == []
        await store.close()


def test_render_lessons_empty_and_ordering() -> None:
    assert render_lessons([]) == ""
    base = heuristic_episode([], {}, tenant_id="t", conversation_id="c")
    a = Episode(**{**base.__dict__, "id": "a", "friction": ["respuesta_larga"], "improvements": ["x"]})
    b = Episode(**{**base.__dict__, "id": "b", "friction": ["respuesta_larga", "tardo_en_cerrar"], "improvements": ["x", "y"]})
    text = render_lessons([a, b], limit=1)
    assert "respuesta_larga (2)" in text and "tardo_en_cerrar" not in text
    assert text.count("\n- ") == 1 and "- X" in text
