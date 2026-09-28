"""`POST /chat`: un turno de conversación. La lógica vive en `pipeline/turn.py`."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..contracts import ChatRequest, ChatResponse
from ..pipeline.turn import TurnRejected
from ..runtime import runtime

router = APIRouter(tags=["conversación"])


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    if runtime.pipeline is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")
    try:
        return await runtime.pipeline.run(req)
    except TurnRejected as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc
