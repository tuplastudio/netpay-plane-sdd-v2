"""Dependencias compartidas de los routers."""

from __future__ import annotations

import hmac
import logging

from fastapi import Header, HTTPException, Request

from ..runtime import Runtime, runtime

log = logging.getLogger("agent-v2.api")

# Rutas que no exigen `X-Internal-Key` (probe de liveness del orquestador).
PUBLIC_PATHS = {"/healthz"}


async def require_internal_key(
    request: Request, x_internal_key: str | None = Header(default=None, alias="X-Internal-Key")
) -> None:
    if request.url.path in PUBLIC_PATHS:
        return
    internal_key = runtime.settings.internal_key
    if not internal_key:
        return
    if not x_internal_key or not hmac.compare_digest(x_internal_key, internal_key):
        log.warning("rechazo de auth interna: path=%s", request.url.path)
        raise HTTPException(status_code=401, detail="X-Internal-Key inválida o ausente")


def ready_runtime() -> Runtime:
    """El runtime con el grafo arriba, o 503 si el arranque no terminó."""
    if runtime.agent is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")
    return runtime


def thread_id_for(tenant_id: str, conversation_id: str) -> str:
    return f"{tenant_id}:{conversation_id}"
