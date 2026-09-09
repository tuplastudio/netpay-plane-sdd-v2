"""NetPay Plane — agente v2 (FastAPI + LangGraph + deepagents).

Mantiene el mismo contrato HTTP que el agente v1 (`POST /chat`), así que
commerce-api puede apuntarle con solo cambiar `AGENT_URL`, sin tocar el
puente de WhatsApp.
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import logging
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from pydantic import BaseModel, Field, conlist

from .agent import build_agent
from .commerce import CommerceClient
from .config import get_settings
from .knowledge import load_knowledge, reload_knowledge
from .state import TurnContext, cart_summary
from .text import format_for_whatsapp
from .tools import SALES_TOOLS

settings = get_settings()
log = logging.getLogger("agent-v2")

_PUBLIC_PATHS = {"/healthz"}


async def require_internal_key(
    request: Request, x_internal_key: str | None = Header(default=None, alias="X-Internal-Key")
) -> None:
    if request.url.path in _PUBLIC_PATHS:
        return
    if not settings.internal_key:
        return
    if not x_internal_key or not hmac.compare_digest(x_internal_key, settings.internal_key):
        log.warning("rechazo de auth interna: path=%s", request.url.path)
        raise HTTPException(status_code=401, detail="X-Internal-Key inválida o ausente")


app = FastAPI(
    title="NetPay Plane Agent v2",
    version="2.0.0",
    description="Agente comercial sobre LangGraph con memoria persistente por conversación.",
    dependencies=[Depends(require_internal_key)],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.public_base_url, "http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "X-Internal-Key"],
)


class _Runtime:
    """Checkpointer y grafo viven todo el proceso: abrir la BD por turno
    perdería el hilo y costaría una conexión cada mensaje."""

    def __init__(self) -> None:
        self._stack: contextlib.AsyncExitStack | None = None
        self.agent: Any = None
        self.lock = asyncio.Lock()

    async def start(self) -> None:
        self._stack = contextlib.AsyncExitStack()
        checkpointer = await self._stack.enter_async_context(
            AsyncSqliteSaver.from_conn_string(str(settings.checkpoint_path))
        )
        self.agent = build_agent(checkpointer, settings)

    async def stop(self) -> None:
        if self._stack is not None:
            await self._stack.aclose()
            self._stack = None


runtime = _Runtime()


@app.on_event("startup")
async def _startup() -> None:
    await runtime.start()


@app.on_event("shutdown")
async def _shutdown() -> None:
    await runtime.stop()


# ---------------- modelos de entrada/salida ----------------


class ChatRequest(BaseModel):
    tenantId: str
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
    cart: list[dict[str, Any]] = Field(default_factory=list)
    totals: dict[str, Any] | None = None
    quote: dict[str, Any] | None = None
    checkout: dict[str, Any] | None = None
    customer: dict[str, Any] = Field(default_factory=dict)
    todos: list[dict[str, Any]] = Field(default_factory=list)
    toolCalls: list[dict[str, Any]] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    engine: str = "langgraph"
    latencyMs: int = 0


# ---------------- salud ----------------


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {"status": "ok", "version": "2.0.0"}


@app.get("/readyz")
async def readyz() -> dict[str, Any]:
    commerce = await CommerceClient().health()
    return {
        "ready": bool(settings.llm_live and commerce.get("ok")),
        "llm": {"live": settings.llm_live, "model": settings.model},
        "commerce": commerce,
        "checkpointer": str(settings.checkpoint_path),
        "warnings": [
            w
            for w in (
                None if settings.llm_live else "OPENROUTER_KEY_REF no configurada",
                None if settings.commerce_live else "AGENT_API_KEY_REF no configurada",
                None if settings.internal_key else "AGENT_INTERNAL_KEY_REF no configurada",
            )
            if w
        ],
    }


@app.get("/diagnostics")
async def diagnostics() -> dict[str, Any]:
    return {
        "engine": "langgraph+deepagents",
        "model": settings.model,
        "tools": [t.name for t in SALES_TOOLS],
        "knowledgeChars": len(load_knowledge()),
        "budgets": {
            "recursionLimit": settings.recursion_limit,
            "turnTimeoutSeconds": settings.turn_timeout_seconds,
            "summarizeAfterMessages": settings.summarize_after_messages,
            "keepMessages": settings.keep_messages,
        },
    }


@app.post("/knowledge/reload")
async def knowledge_reload() -> dict[str, Any]:
    return {"chars": len(reload_knowledge())}


# ---------------- conversación ----------------


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    text = (req.text or "").strip()[: settings.max_input_chars]
    if not text and req.imageBase64:
        text = "[el cliente envió una imagen]"
    if not text:
        raise HTTPException(status_code=400, detail="Se requiere text")
    if runtime.agent is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")

    conversation_id = req.conversationId or f"{req.tenantId}:{req.customerPhone or 'anon'}"
    # thread_id = conversación: aquí es donde LangGraph recupera el hilo previo.
    config = {
        "configurable": {"thread_id": f"{req.tenantId}:{conversation_id}"},
        "recursion_limit": settings.recursion_limit,
    }
    context: TurnContext = {
        "tenant_id": req.tenantId,
        "conversation_id": conversation_id,
        "channel": req.channel,
        "scopes": list(req.principalScopes),
        "customer_phone": req.customerPhone,
        "customer_name": req.customerName,
        "customer_email": req.customerEmail,
    }

    content: Any = text
    if req.imageBase64:
        content = [
            {"type": "text", "text": text},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{req.imageBase64}"}},
        ]

    started = asyncio.get_running_loop().time()
    try:
        result = await asyncio.wait_for(
            runtime.agent.ainvoke(
                {"messages": [HumanMessage(content=content)]},
                config=config,
                context=context,
            ),
            timeout=settings.turn_timeout_seconds,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="El agente tardó demasiado en responder")
    except Exception as exc:  # noqa: BLE001 - el canal necesita una respuesta, no un stacktrace
        log.exception("fallo del turno")
        raise HTTPException(status_code=502, detail=f"El agente falló: {exc}") from exc

    latency_ms = int((asyncio.get_running_loop().time() - started) * 1000)
    messages = result.get("messages", [])
    reply = ""
    for message in reversed(messages):
        if isinstance(message, AIMessage) and isinstance(message.content, str) and message.content.strip():
            reply = message.content.strip()
            break

    if reply and req.channel == "whatsapp":
        reply = format_for_whatsapp(reply)

    tool_calls = [
        {"tool": m.name, "result": (m.content or "")[:400]}
        for m in messages
        if m.__class__.__name__ == "ToolMessage"
    ][-20:]

    return ChatResponse(
        conversationId=conversation_id,
        reply=reply,
        handoff=bool(result.get("handoff")),
        intent=result.get("stage"),
        stage=result.get("stage"),
        cart=list(result.get("cart") or []),
        totals=result.get("last_totals"),
        quote={"quoteId": result["quote_id"], "linkRef": result.get("quote_link")}
        if result.get("quote_id")
        else None,
        checkout={"linkRef": result["checkout_link"]} if result.get("checkout_link") else None,
        customer=dict(result.get("customer") or {}),
        todos=list(result.get("todos") or []),
        toolCalls=tool_calls,
        suggestions=_suggestions(result),
        latencyMs=latency_ms,
    )


@app.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, tenantId: str = Query(...)) -> dict[str, Any]:
    """Estado persistido del hilo: lo que el agente recuerda de esa conversación."""
    if runtime.agent is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")
    config = {"configurable": {"thread_id": f"{tenantId}:{conversation_id}"}}
    snapshot = await runtime.agent.aget_state(config)
    values = snapshot.values or {}
    return {
        "conversationId": conversation_id,
        "stage": values.get("stage"),
        "customer": values.get("customer") or {},
        "cart": values.get("cart") or [],
        "cartSummary": cart_summary(values.get("cart")),
        "quoteId": values.get("quote_id"),
        "orderId": values.get("order_id"),
        "checkoutLink": values.get("checkout_link"),
        "handoff": bool(values.get("handoff")),
        "todos": values.get("todos") or [],
        "messages": len(values.get("messages") or []),
    }


def _suggestions(state: dict[str, Any]) -> list[str]:
    if state.get("checkout_link"):
        return ["Ya pagué", "¿Cuándo llega mi pedido?"]
    if state.get("quote_id"):
        return ["Sí, quiero pagar", "Tengo una duda"]
    if state.get("cart"):
        return ["Emitir cotización", "Cambiar cantidad"]
    return ["¿Qué venden?", "Quiero cotizar", "¿Hacen envíos?"]
