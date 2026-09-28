"""Del estado persistido del hilo al `ChatResponse` de la API.

Se comparte entre el turno normal, la rama de handoff activo, la ráfaga
cedida y la degradación por error: las cuatro devuelven la misma forma de
contrato, y `GET /conversations/{id}` reutiliza `cart_payload`.
"""

from __future__ import annotations

from typing import Any

from ..contracts import ChatResponse
from ..state import CartRecord, open_carts, overall_stage, primary_cart
from .replies import suggestions


def quote_payload(record: CartRecord) -> dict[str, Any] | None:
    """`{quoteId, linkRef, total}`: el chat web pinta `total` si viene."""
    if not record.get("quoteId"):
        return None
    totals = record.get("lastTotals") or {}
    body = totals.get("totals", totals) if isinstance(totals, dict) else {}
    return {
        "quoteId": record["quoteId"],
        "linkRef": record.get("quoteLink"),
        "total": body.get("total") if isinstance(body, dict) else None,
    }


def checkout_payload(record: CartRecord) -> dict[str, Any] | None:
    if not record.get("checkoutLink"):
        return None
    return {"linkRef": record["checkoutLink"], "orderId": record.get("orderId")}


def cart_payload(cart_id: str, record: CartRecord) -> dict[str, Any]:
    """Un carrito, en la forma que expone la API (`carts[]` de `ChatResponse`)."""
    return {
        "cartId": cart_id,
        "lines": list(record.get("lines") or []),
        "totals": record.get("lastTotals"),
        "quote": quote_payload(record),
        "checkout": checkout_payload(record),
        "stage": record.get("stage"),
    }


def response_from_values(
    conversation_id: str,
    values: dict[str, Any],
    *,
    reply: str,
    handoff: bool,
    intent: str | None,
    engine: str,
    latency_ms: int,
    tool_calls: list[dict[str, Any]] | None = None,
    turn_id: str = "",
) -> ChatResponse:
    carts: dict[str, CartRecord] = values.get("carts") or {}
    _primary_id, primary = primary_cart(values)
    return ChatResponse(
        conversationId=conversation_id,
        reply=reply,
        handoff=handoff,
        intent=intent,
        stage=values.get("stage") or overall_stage(carts),
        cart=list(primary.get("lines") or []),
        totals=primary.get("lastTotals"),
        quote=quote_payload(primary),
        checkout=checkout_payload(primary),
        carts=[cart_payload(cart_id, record) for cart_id, record in open_carts(carts).items()],
        customer=dict(values.get("customer") or {}),
        todos=list(values.get("todos") or []),
        toolCalls=tool_calls or [],
        suggestions=suggestions(values) if not handoff else [],
        engine=engine,
        latencyMs=latency_ms,
        attachment=values.get("pending_attachment"),
        turnId=turn_id,
    )
