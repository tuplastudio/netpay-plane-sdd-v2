"""Prompts versionados (ver app/prompts/registry.py y prompts/README.md)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from ..prompts import PromptVersionNotFound, get_prompt_registry
from ..runtime import runtime

router = APIRouter(tags=["prompts"])


@router.get("/prompts")
async def prompts_index() -> dict[str, Any]:
    """Versiones de prompt disponibles y cuál resuelve `latest`."""
    return {**get_prompt_registry().to_dict(), "processDefault": runtime.settings.prompt_version}


@router.get("/prompts/{version}")
async def prompt_detail(version: str, text: bool = False) -> dict[str, Any]:
    """Manifest y bloques de una versión (`?text=true` incluye el contenido).

    Solo detrás de `X-Internal-Key`, como el resto: el prompt es
    configuración interna, nunca se expone al canal.
    """
    try:
        loaded = get_prompt_registry().get(version)
    except PromptVersionNotFound as exc:
        raise HTTPException(status_code=404, detail="Versión de prompt no encontrada") from exc
    return loaded.to_dict(include_text=text)


@router.post("/prompts/reload")
async def prompts_reload() -> dict[str, Any]:
    """Relee `prompts/` de disco (nueva versión desplegada sin reiniciar)."""
    registry = get_prompt_registry()
    registry.reload()
    return {"latest": registry.latest(), "versions": registry.versions()}
