"""Memoria del agente: episódica (cómo conversar) y perfil del cliente (a quién).

Son dos almacenes con contratos distintos a propósito; ver
``memory/episodic.py`` y ``memory/profile.py``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from ..memory import get_episode_store
from ..memory.profile import get_profile_store
from ..runtime import runtime

router = APIRouter(tags=["memoria"])


@router.get("/memory/episodes")
async def list_episodes(tenantId: str = Query(...), limit: int = 50) -> dict[str, Any]:
    episodes = await get_episode_store().list(tenantId, limit=limit)
    return {"tenantId": tenantId, "episodes": [e.to_dict() for e in episodes]}


@router.get("/memory/episodes/stats")
async def episode_stats(tenantId: str = Query(...)) -> dict[str, Any]:
    return await get_episode_store().stats(tenantId)


@router.get("/memory/lessons")
async def episode_lessons(tenantId: str = Query(...)) -> dict[str, Any]:
    """El bloque `<lecciones>` tal como entra al prompt del tenant."""
    lessons = await get_episode_store().lessons(tenantId, limit=runtime.settings.episodic_lessons_in_prompt)
    return {"tenantId": tenantId, "lessons": lessons}


@router.delete("/memory/episodes")
async def delete_episodes(tenantId: str = Query(...)) -> dict[str, Any]:
    return {"deleted": await get_episode_store().delete_tenant(tenantId)}


# ------------------------------------------------- perfil por teléfono


@router.get("/memory/customers")
async def list_customer_profiles(tenantId: str = Query(...), limit: int = 50) -> dict[str, Any]:
    """Perfiles del tenant, del más reciente al más viejo.

    El teléfono nunca sale: la fila se identifica por su `phoneKey` (HMAC con
    el tenant como sal). Para mirar UNO se consulta por número en
    `/memory/customers/lookup`, que vuelve a calcular la llave.
    """
    profiles = await get_profile_store().list(tenantId, limit=limit)
    return {"tenantId": tenantId, "profiles": [p.to_dict() for p in profiles]}


@router.get("/memory/customers/stats")
async def customer_profile_stats(tenantId: str = Query(...)) -> dict[str, Any]:
    return await get_profile_store().stats(tenantId)


@router.get("/memory/customers/lookup")
async def lookup_customer_profile(
    tenantId: str = Query(...), phone: str = Query(...)
) -> dict[str, Any]:
    """Perfil de un número concreto, con el bloque tal como entra al prompt."""
    store = get_profile_store()
    profile = await store.get(tenantId, phone)
    return {
        "tenantId": tenantId,
        "found": profile is not None,
        "fresh": bool(profile and store.is_fresh(profile)),
        "profile": profile.to_dict() if profile else None,
        "block": await store.block_for(tenantId, phone),
    }


@router.delete("/memory/customers")
async def delete_customer_profile(
    tenantId: str = Query(...), phone: str | None = Query(default=None)
) -> dict[str, Any]:
    """Derecho al olvido: con `phone`, borra ese cliente; sin él, todo el tenant."""
    store = get_profile_store()
    deleted = (
        await store.delete(tenantId, phone) if phone else await store.delete_tenant(tenantId)
    )
    return {"deleted": deleted, "scope": "customer" if phone else "tenant"}
