"""Contrato HTTP de `POST /chat`: lo que consumen commerce-api (puente de
WhatsApp) y el chat web de `apps/web`.

Vive aparte de la API y del pipeline porque los dos lo necesitan y ninguno
debe depender del otro: `api/chat.py` lo valida, `pipeline/turn.py` lo
produce. Es el MISMO contrato que el agente v1, así que commerce-api puede
apuntar a cualquiera de los dos con solo cambiar `AGENT_URL`.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, conlist


class ChatRequest(BaseModel):
    tenantId: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
    conversationId: str | None = None
    messageId: str | None = None
    text: str | None = None
    imageBase64: str | None = None
    channel: str = "web"
    customerName: str | None = None
    customerPhone: str | None = None
    customerEmail: str | None = None
    principalScopes: conlist(str, max_length=20) = Field(default_factory=list)
    # Aceptado por compatibilidad con el contrato del v1; v2 lee el catálogo
    # del backend con su propia API key.
    catalog: list[dict[str, Any]] = Field(default_factory=list)


class ChatResponse(BaseModel):
    conversationId: str
    reply: str
    handoff: bool = False
    intent: str | None = None
    stage: str | None = None
    # Compatibilidad con v1 / paneles que aún no leen `carts`: reflejan el
    # carrito ACTIVO (ver `state.primary_cart`). Con un solo pedido en curso
    # —el caso normal— son exactamente lo que eran antes.
    cart: list[dict[str, Any]] = Field(default_factory=list)
    totals: dict[str, Any] | None = None
    quote: dict[str, Any] | None = None
    checkout: dict[str, Any] | None = None
    # Todos los carritos abiertos de la conversación, cada uno con su propio
    # carrito/total/cotización/pedido/pago — así un panel o un canal que sí
    # sepa de esto puede mostrar varios pedidos a la vez sin adivinar.
    carts: list[dict[str, Any]] = Field(default_factory=list)
    customer: dict[str, Any] = Field(default_factory=dict)
    todos: list[dict[str, Any]] = Field(default_factory=list)
    toolCalls: list[dict[str, Any]] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    engine: str = "langgraph"
    latencyMs: int = 0
    attachment: dict[str, Any] | None = None
    """Adjunto de este turno (p. ej. PDF de cotización), si una tool lo dejó
    en `pending_attachment`. El canal (WhatsApp) decide cómo mandarlo."""
    # Identificador del turno para correlacionar logs (`turn.done`) con lo
    # que vio el canal. Vacío en respuestas cacheadas por idempotencia.
    turnId: str = ""
