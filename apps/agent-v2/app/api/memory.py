"""Memoria episódica (comportamiento conversacional, sin datos de personas)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from ..memory import get_episode_store
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
