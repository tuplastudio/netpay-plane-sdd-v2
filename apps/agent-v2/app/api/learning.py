"""Señales de aprendizaje que revisa el dueño del negocio (ver learning.py)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..knowledge import reload_knowledge
from ..learning import SignalNotFoundError, SignalTenantMismatchError, get_learning_store

router = APIRouter(tags=["aprendizaje"])


class ApproveSignalRequest(BaseModel):
    answer: str


@router.get("/learning/signals")
async def learning_signals(tenantId: str | None = None, status: str | None = "pending") -> dict[str, Any]:
    signals = await get_learning_store().list_signals(tenant_id=tenantId, status=status)
    return {"signals": [s.to_dict() for s in signals]}


@router.post("/learning/signals/{signal_id}/approve")
async def approve_signal(signal_id: str, req: ApproveSignalRequest, tenantId: str | None = None) -> dict[str, Any]:
    try:
        signal = await get_learning_store().approve(signal_id, answer=req.answer, tenant_id=tenantId)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SignalNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Señal no encontrada") from exc
    except SignalTenantMismatchError as exc:
        raise HTTPException(status_code=403, detail="Señal de otro negocio") from exc
    # La respuesta aprobada se escribió al conocimiento del tenant dueño de la
    # señal: recargarlo para que entre al prompt del siguiente turno.
    reload_knowledge(signal.tenant_id)
    return signal.to_dict()


@router.post("/learning/signals/{signal_id}/dismiss")
async def dismiss_signal(signal_id: str, tenantId: str | None = None) -> dict[str, Any]:
    try:
        signal = await get_learning_store().dismiss(signal_id, tenant_id=tenantId)
    except SignalNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Señal no encontrada") from exc
    except SignalTenantMismatchError as exc:
        raise HTTPException(status_code=403, detail="Señal de otro negocio") from exc
    return signal.to_dict()
