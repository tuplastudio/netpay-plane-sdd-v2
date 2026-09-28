"""Traza de turnos hacia Langfuse (observabilidad externa, opcional).

`pipeline/trace.py` ya deja un resumen de cada turno (`turn.done`) en el log
del proceso: duración por etapa, motor, intent, si hubo reintento — nunca el
texto del cliente ni de la respuesta. Este módulo manda ESE MISMO resumen a
Langfuse (`https://langfuse.com`) como una traza, para verlo en un dashboard
en vez de grep sobre logs sueltos: filtrar por tenant, comparar latencia
entre versiones de prompt, ver la proporción de handoffs en el tiempo.

Apagado de fábrica: se activa solo si `LANGFUSE_PUBLIC_KEY` y
`LANGFUSE_SECRET_KEY` están puestas (`Settings.langfuse_enabled`). Si la
librería no está instalada, las llaves son inválidas, o Langfuse está caído,
`report_turn` se traga el error y no hace nada — igual que el resto de las
capas de este agente, una falla de observabilidad nunca debe demorar ni
tumbar la respuesta al cliente.
"""

from __future__ import annotations

import logging
from typing import Any

from .config import get_settings

_logger = logging.getLogger(__name__)

# Cacheado a nivel de proceso, igual que el analizador de Presidio
# (`guards/pii.py`): construir el cliente abre una conexión, no hace falta
# repetirlo en cada turno. `_broken=True` es permanente para el proceso.
_client: Any = None
_broken = False


def _get_client() -> Any:
    global _client, _broken
    if _client is not None or _broken:
        return _client
    settings = get_settings()
    if not settings.langfuse_enabled:
        return None
    try:
        from langfuse import Langfuse

        _client = Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            host=settings.langfuse_host,
        )
    except Exception:  # noqa: BLE001 - SDK ausente o llaves inválidas no debe tumbar el turno
        _logger.warning("Langfuse no disponible; se sigue sin trazas externas", exc_info=True)
        _broken = True
        _client = None
    return _client


def report_turn(trace_payload: dict[str, Any], *, tenant_id: str | None) -> None:
    """Manda el resumen de un turno (`TurnTrace.to_dict()`) a Langfuse.

    `trace_payload` es exactamente lo que ya se logea como `turn.done` —sin
    texto de cliente ni de respuesta—; `tenantId` se agrega aparte porque
    identifica al negocio, no a una persona, y sirve para filtrar en el
    dashboard. Llamar con Langfuse apagado o roto es gratis (retorna de
    inmediato); llamar con Langfuse configurado pero caído se traga la
    excepción y solo deja un warning en el log.
    """
    client = _get_client()
    if client is None:
        return
    turn_id = trace_payload.get("turnId")
    try:
        client.trace(
            id=turn_id,
            name="agent_turn",
            metadata={**trace_payload, "tenantId": tenant_id},
            tags=[tenant_id] if tenant_id else None,
        )
    except Exception:  # noqa: BLE001 - una traza perdida no debe afectar al cliente
        _logger.warning("Langfuse falló registrando el turno %s", turn_id, exc_info=True)
