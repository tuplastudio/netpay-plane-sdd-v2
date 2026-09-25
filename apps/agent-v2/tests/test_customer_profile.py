"""Memoria del cliente por teléfono (``app/memory/profile.py``).

Lo que se prueba aquí es el contrato que hace segura y útil esta memoria:
la llave no revela el número, no cruza tenants, lo aprendido se acumula sin
borrar lo anterior, y el bloque que entra al prompt es corto y honesto.
"""

import json
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.memory.profile import (
    CustomerProfile,
    CustomerProfileStore,
    extract_facts_with_llm,
    facts_from_state,
    merge_profile,
    normalize_phone,
    profile_key,
    render_profile,
)
from tests.conftest import FakeModel

STATE = {
    "stage": "COTIZACION_EMITIDA",
    "carts": {
        "1": {
            "cartId": "1",
            "quoteId": "q-1",
            "deliveryMode": "LOCAL_DELIVERY",
            "lines": [{"variantId": "v1", "sku": "PIN-BLA-19", "title": "Pintura blanca 19L", "quantity": "2"}],
        }
    },
    "customer": {"name": "Laura Martínez", "phone": "526671234567", "email": "laura@ejemplo.mx"},
    "delivery_address": {"city": "Culiacán", "postalCode": "80000", "state": "Sinaloa"},
    "handoff": False,
}


# ------------------------------------------------------------- llave


@pytest.mark.parametrize(
    "raw",
    ["+52 667 123 4567", "526671234567", "52 1 667 123 4567", "5216671234567"],
)
def test_same_number_in_any_format_is_one_profile(raw: str) -> None:
    """El `1` de los móviles mexicanos y el formato no pueden partir el perfil."""
    assert profile_key("t1", raw) == profile_key("t1", "526671234567")


def test_key_hides_the_number_and_does_not_cross_tenants() -> None:
    key = profile_key("t1", "526671234567")
    assert "6671234567" not in key
    assert normalize_phone("526671234567") not in key
    # El mismo número en otro negocio es otra llave: el archivo de un tenant
    # no sirve para correlacionar clientes del otro.
    assert key != profile_key("t2", "526671234567")


def test_key_is_empty_without_a_usable_number() -> None:
    assert profile_key("t1", None) == ""
    assert profile_key("t1", "") == ""
    assert profile_key("t1", "1234") == ""


# ------------------------------------------------------------- hechos


def test_facts_from_state_reads_customer_cart_and_address() -> None:
    facts = facts_from_state(STATE)
    assert facts["name"] == "Laura Martínez"
    assert facts["email"] == "laura@ejemplo.mx"
    assert facts["city"] == "Culiacán"
    assert facts["postal_code"] == "80000"
    assert facts["delivery_mode"] == "LOCAL_DELIVERY"
    assert "Pintura blanca 19L" in facts["interests"]
    assert facts["last_outcome"] == "COTIZACION_EMITIDA"
    assert facts["source"] == "heuristic"


def test_handoff_wins_as_outcome() -> None:
    assert facts_from_state({**STATE, "handoff": True})["last_outcome"] == "ESCALADO"


def test_merge_keeps_what_the_customer_said_before() -> None:
    """Que no repita su nombre hoy no significa que lo hayamos olvidado."""
    first = merge_profile(
        None, tenant_id="t1", phone_key="k", facts=facts_from_state(STATE), now=1_000.0
    )
    second = merge_profile(
        first,
        tenant_id="t1",
        phone_key="k",
        facts={"interests": ["Rodillo 9"], "last_outcome": "PAGO_ENVIADO"},
        now=2_000.0,
    )
    assert second.name == "Laura Martínez"
    assert second.email == "laura@ejemplo.mx"
    assert second.conversations == 2
    assert second.last_outcome == "PAGO_ENVIADO"
    # Lo nuevo va primero, lo viejo sigue ahí.
    assert second.interests[0] == "Rodillo 9"
    assert "Pintura blanca 19L" in second.interests


def test_merge_ignores_a_malformed_email() -> None:
    profile = merge_profile(
        None, tenant_id="t1", phone_key="k", facts={"email": "no-es-un-correo"}
    )
    assert profile.email == ""


def test_free_text_is_redacted_but_the_identity_fields_are_not() -> None:
    """Las notas son texto libre (ahí la PII entra por accidente); el correo
    del cliente es justo lo que queremos recordar."""
    profile = merge_profile(
        None,
        tenant_id="t1",
        phone_key="k",
        facts={
            "email": "laura@ejemplo.mx",
            "name": "Laura Martínez",
            "notes": ["escribir a laura@ejemplo.mx antes de las 6"],
        },
    )
    assert profile.email == "laura@ejemplo.mx"
    assert profile.name == "Laura Martínez"
    assert "laura@ejemplo.mx" not in profile.notes[0]


# ------------------------------------------------------------- bloque


def test_block_is_empty_when_there_is_nothing_worth_injecting() -> None:
    empty = CustomerProfile(tenant_id="t1", phone_key="k", created_at=0.0, updated_at=0.0)
    assert render_profile(empty) == ""
    assert render_profile(None) == ""


def test_block_names_what_we_know() -> None:
    profile = merge_profile(
        None, tenant_id="t1", phone_key="k", facts=facts_from_state(STATE)
    )
    block = render_profile(profile)
    assert "Laura Martínez" in block
    assert "Culiacán" in block
    assert "Pintura blanca 19L" in block


# -------------------------------------------------------------- store


@pytest.mark.asyncio
async def test_remember_and_read_back_by_phone() -> None:
    with TemporaryDirectory() as tmp:
        store = CustomerProfileStore(Path(tmp) / "p.sqlite")
        await store.remember("t1", "+52 667 123 4567", facts_from_state(STATE))
        profile = await store.get("t1", "5216671234567")
        assert profile is not None and profile.name == "Laura Martínez"
        assert "Laura Martínez" in await store.block_for("t1", "526671234567")
        await store.close()


@pytest.mark.asyncio
async def test_a_tenant_never_sees_another_tenants_customer() -> None:
    with TemporaryDirectory() as tmp:
        store = CustomerProfileStore(Path(tmp) / "p.sqlite")
        await store.remember("t1", "526671234567", facts_from_state(STATE))
        assert await store.get("t2", "526671234567") is None
        assert await store.block_for("t2", "526671234567") == ""
        await store.close()


@pytest.mark.asyncio
async def test_without_a_phone_nothing_is_written() -> None:
    with TemporaryDirectory() as tmp:
        store = CustomerProfileStore(Path(tmp) / "p.sqlite")
        assert await store.remember("t1", None, facts_from_state(STATE)) is None
        assert await store.list("t1") == []
        await store.close()


@pytest.mark.asyncio
async def test_a_stale_profile_stops_being_injected() -> None:
    with TemporaryDirectory() as tmp:
        store = CustomerProfileStore(Path(tmp) / "p.sqlite", ttl_days=30)
        await store.remember(
            "t1", "526671234567", facts_from_state(STATE), now=0.0
        )
        assert await store.block_for("t1", "526671234567") == ""
        # En disco sigue: caducar no es borrar.
        assert await store.get("t1", "526671234567") is not None
        await store.close()


@pytest.mark.asyncio
async def test_delete_one_customer_and_the_whole_tenant() -> None:
    with TemporaryDirectory() as tmp:
        store = CustomerProfileStore(Path(tmp) / "p.sqlite")
        await store.remember("t1", "526671234567", facts_from_state(STATE))
        await store.remember("t1", "526679999999", {"name": "Otro"})
        assert await store.delete("t1", "526671234567") == 1
        assert await store.get("t1", "526671234567") is None
        assert await store.delete_tenant("t1") == 1
        assert await store.list("t1") == []
        await store.close()


@pytest.mark.asyncio
async def test_stats_counts_returning_customers() -> None:
    with TemporaryDirectory() as tmp:
        store = CustomerProfileStore(Path(tmp) / "p.sqlite")
        await store.remember("t1", "526671234567", facts_from_state(STATE))
        await store.remember("t1", "526671234567", facts_from_state(STATE))
        await store.remember("t1", "526679999999", {"name": "Otro"})
        stats = await store.stats("t1")
        assert stats["profiles"] == 2
        assert stats["returning"] == 1
        await store.close()


# ---------------------------------------------------------------- LLM


@pytest.mark.asyncio
async def test_llm_facts_are_merged_over_the_deterministic_ones() -> None:
    model = FakeModel(
        replies=[json.dumps({"notes": ["prefiere que le hablen de usted"], "summary": "Quedó de confirmar mañana."})]
    )
    facts = await extract_facts_with_llm(
        model, [HumanMessage(content="hola"), AIMessage(content="qué tal")], STATE
    )
    assert facts["notes"] == ["prefiere que le hablen de usted"]
    assert facts["summary"] == "Quedó de confirmar mañana."
    # Lo determinista sigue ahí.
    assert facts["name"] == "Laura Martínez"
    assert facts["source"] == "llm"


@pytest.mark.asyncio
async def test_a_broken_model_falls_back_to_the_deterministic_facts() -> None:
    model = FakeModel(error=RuntimeError("proveedor caído"))
    facts = await extract_facts_with_llm(model, [HumanMessage(content="hola")], STATE)
    assert facts == facts_from_state(STATE)


@pytest.mark.asyncio
async def test_a_model_that_answers_garbage_does_not_break_the_profile() -> None:
    model = FakeModel(replies=["no soy JSON"])
    facts = await extract_facts_with_llm(model, [HumanMessage(content="hola")], STATE)
    assert facts == facts_from_state(STATE)
