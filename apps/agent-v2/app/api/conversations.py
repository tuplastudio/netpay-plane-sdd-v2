"""Ciclo de vida del hilo: consulta, transcript, compactar, cerrar, liberar.

commerce-api llama `release`/`close` en cada transición del hilo (ver
"Integración" en docs/ARCHITECTURE.md); el panel usa el resto.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from ..guards import redact_pii
from ..memory import SUMMARY_PREFIX, build_llm_summarizer, clear_history, compact_thread
from ..pipeline.post_turn import capture_episode
from ..pipeline.replies import message_text
from ..pipeline.responses import cart_payload
from ..runtime import Runtime
from ..state import CartRecord, cart_summary, open_carts, overall_stage, primary_cart
from .deps import ready_runtime, thread_id_for

router = APIRouter(prefix="/conversations", tags=["conversaciones"])


@router.get("/{conversation_id}")
async def get_conversation(
    conversation_id: str, tenantId: str = Query(...), rt: Runtime = Depends(ready_runtime)
) -> dict[str, Any]:
    """Estado persistido del hilo: lo que el agente recuerda de esa conversación."""
    config = {"configurable": {"thread_id": thread_id_for(tenantId, conversation_id)}}
    snapshot = await rt.agent.aget_state(config)
    values = snapshot.values or {}
    if not values:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")
    carts: dict[str, CartRecord] = values.get("carts") or {}
    _primary_id, primary = primary_cart(values)
    return {
        "conversationId": conversation_id,
        "stage": values.get("stage") or overall_stage(carts),
        "customer": values.get("customer") or {},
        # Compatibilidad: el carrito activo, como antes de soportar varios.
        "cart": primary.get("lines") or [],
        "cartSummary": cart_summary(primary.get("lines")),
        "quoteId": primary.get("quoteId"),
        "orderId": primary.get("orderId"),
        "checkoutLink": primary.get("checkoutLink"),
        "carts": [cart_payload(cart_id, record) for cart_id, record in open_carts(carts).items()],
        "handoff": bool(values.get("handoff")),
        "handoffReason": values.get("handoff_reason") or None,
        "failureStreak": int(values.get("failure_streak") or 0),
        "todos": values.get("todos") or [],
        "messages": len(values.get("messages") or []),
    }


def _transcript_entry(message: Any) -> dict[str, Any] | None:
    if isinstance(message, HumanMessage):
        text = message_text(message)
        role = "summary" if text.startswith(SUMMARY_PREFIX) else "customer"
        return {"role": role, "text": text}
    if isinstance(message, AIMessage):
        entry: dict[str, Any] = {"role": "agent", "text": message_text(message)}
        calls = [c.get("name") for c in (getattr(message, "tool_calls", None) or []) if c.get("name")]
        if calls:
            entry["toolCalls"] = calls
        return entry
    if isinstance(message, ToolMessage):
        return {"role": "tool", "tool": getattr(message, "name", None), "text": message_text(message)}
    return None


@router.get("/{conversation_id}/messages")
async def get_transcript(
    conversation_id: str,
    tenantId: str = Query(...),
    limit: int | None = Query(default=None, ge=1, le=500),
    redact: bool = True,
    rt: Runtime = Depends(ready_runtime),
) -> dict[str, Any]:
    """Los últimos mensajes del hilo tal como los ve el modelo.

    Para depurar "¿por qué contestó eso?" desde el panel sin abrir el
    sqlite. Por defecto redacta teléfonos, correos y tarjetas
    (`redact=false` solo para soporte con acceso al dato).
    """
    config = {"configurable": {"thread_id": thread_id_for(tenantId, conversation_id)}}
    snapshot = await rt.agent.aget_state(config)
    values = snapshot.values or {}
    if not values:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")
    messages = list(values.get("messages") or [])
    total = len(messages)
    window = messages[-(limit or rt.settings.transcript_default_limit) :]
    entries = [e for e in (_transcript_entry(m) for m in window) if e is not None]
    if redact:
        for entry in entries:
            entry["text"] = redact_pii(entry.get("text") or "")
    return {
        "conversationId": conversation_id,
        "total": total,
        "returned": len(entries),
        "redacted": redact,
        "messages": entries,
    }


@router.post("/{conversation_id}/compact")
async def compact_conversation(
    conversation_id: str,
    tenantId: str = Query(...),
    keepTurns: int | None = None,
    rt: Runtime = Depends(ready_runtime),
) -> dict[str, Any]:
    """Compacta el historial: resumen + últimos `keepTurns` turnos del cliente.

    El carrito, el cliente y la cotización no se tocan (viven en el estado).
    """
    thread_id = thread_id_for(tenantId, conversation_id)
    config = {"configurable": {"thread_id": thread_id}}
    async with await rt.thread_locks.acquire(thread_id):
        snapshot = await rt.agent.aget_state(config)
        if not snapshot.values:
            raise HTTPException(status_code=404, detail="Conversación no encontrada")
        result = await compact_thread(
            rt.agent,
            config,
            keep_turns=rt.settings.compact_keep_turns if keepTurns is None else max(0, keepTurns),
            summarizer=build_llm_summarizer(rt.utility_model) if rt.utility_model else None,
            reason="manual",
        )
    return {"conversationId": conversation_id, **result.to_dict()}


@router.delete("/{conversation_id}/messages")
async def clear_conversation_messages(
    conversation_id: str, tenantId: str = Query(...), rt: Runtime = Depends(ready_runtime)
) -> dict[str, Any]:
    """Vacía el historial de mensajes conservando carrito, cliente y cotización."""
    thread_id = thread_id_for(tenantId, conversation_id)
    config = {"configurable": {"thread_id": thread_id}}
    async with await rt.thread_locks.acquire(thread_id):
        snapshot = await rt.agent.aget_state(config)
        if not snapshot.values:
            raise HTTPException(status_code=404, detail="Conversación no encontrada")
        removed = await clear_history(rt.agent, config)
    return {"conversationId": conversation_id, "removedMessages": removed}


@router.post("/{conversation_id}/close")
async def close_conversation(
    conversation_id: str,
    tenantId: str = Query(...),
    channel: str = "whatsapp",
    delete: bool = False,
    rt: Runtime = Depends(ready_runtime),
) -> dict[str, Any]:
    """Cierra la conversación: extrae el episodio y, si `delete`, borra el hilo.

    Lo llama el autocierre por inactividad de commerce-api o el panel.
    """
    if rt.checkpointer is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")
    thread_id = thread_id_for(tenantId, conversation_id)
    config = {"configurable": {"thread_id": thread_id}}
    async with await rt.thread_locks.acquire(thread_id):
        snapshot = await rt.agent.aget_state(config)
        values = dict(snapshot.values or {})
        if not values:
            raise HTTPException(status_code=404, detail="Conversación no encontrada")
        episode = await capture_episode(
            rt, tenantId, conversation_id, channel, list(values.get("messages") or []), values
        )
        if delete:
            await rt.checkpointer.adelete_thread(thread_id)
            await rt.idempotency.delete_thread(thread_id)
    return {
        "conversationId": conversation_id,
        "deleted": delete,
        "episode": episode.to_dict() if episode else None,
    }


@router.delete("/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    tenantId: str = Query(...),
    capture: bool = True,
    rt: Runtime = Depends(ready_runtime),
) -> dict[str, Any]:
    """Borra el hilo completo (checkpoint + cache de idempotencia).

    Antes de borrar captura el episodio (`capture=false` lo evita).
    """
    if rt.checkpointer is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")
    thread_id = thread_id_for(tenantId, conversation_id)
    config = {"configurable": {"thread_id": thread_id}}
    episode = None
    async with await rt.thread_locks.acquire(thread_id):
        if capture:
            snapshot = await rt.agent.aget_state(config)
            values = dict(snapshot.values or {})
            if values.get("messages"):
                episode = await capture_episode(
                    rt, tenantId, conversation_id, "", list(values.get("messages") or []), values
                )
        await rt.checkpointer.adelete_thread(thread_id)
        await rt.idempotency.delete_thread(thread_id)
    return {"status": "deleted", "episodeCaptured": episode is not None}


@router.post("/{conversation_id}/release")
async def release_conversation(
    conversation_id: str, tenantId: str = Query(...), rt: Runtime = Depends(ready_runtime)
) -> dict[str, Any]:
    """Devuelve el control al bot después de un handoff (humano o por error)."""
    thread_id = thread_id_for(tenantId, conversation_id)
    config = {"configurable": {"thread_id": thread_id}}
    snapshot = await rt.agent.aget_state(config)
    if not snapshot.values:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")

    # `handoff_reason` usa el reducer "gana el valor nuevo salvo que sea None"
    # (ver state.py `_last`): se limpia con "" en vez de None. `stage` vuelve
    # a DESCUBRIMIENTO y la racha de fallos técnicos se reinicia: si una
    # persona lo devuelve al bot es porque ya se puede volver a intentar.
    async with await rt.thread_locks.acquire(thread_id):
        await rt.agent.aupdate_state(
            config,
            {"handoff": False, "handoff_reason": "", "stage": "DESCUBRIMIENTO", "failure_streak": 0},
        )
        values = (await rt.agent.aget_state(config)).values or {}
    return {
        "conversationId": conversation_id,
        "handoff": bool(values.get("handoff")),
        "stage": values.get("stage"),
    }
