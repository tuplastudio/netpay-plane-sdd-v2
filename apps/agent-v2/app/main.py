"""Easy Sell (Tupla) — agente v2 (FastAPI + LangGraph + deepagents).

Mantiene el mismo contrato HTTP que el agente v1 (`POST /chat`), así que
commerce-api puede apuntarle con solo cambiar `AGENT_URL`, sin tocar el
puente de WhatsApp.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hmac
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import aiosqlite
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.errors import GraphRecursionError
from pydantic import BaseModel, Field, conlist

from dotenv import load_dotenv

# Carga `.env` del monorepo (un nivel arriba de apps/) **antes** de leer
# cualquier setting: `get_settings()` cachea, así que esto tiene que ocurrir
# al importar el módulo, no después. Las vars ya presentes en el entorno
# (p. ej. `OPENROUTER_KEY_REF` inyectadas por el process manager) NO se
# pisan — `override=False` es el default de `load_dotenv`.
_ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
if _ROOT_ENV.exists():
    load_dotenv(_ROOT_ENV, override=False)

from .agent import build_agent, build_scope_model, load_company_context, warm_catalog
from .commerce import CommerceClient
from .config import get_settings
from .learning import (
    SignalNotFoundError,
    SignalTenantMismatchError,
    get_learning_store,
    looks_like_unanswered,
)
from .knowledge import (
    DEFAULT_TENANT_ID,
    KnowledgeUploadError,
    delete_knowledge_doc,
    knowledge_outline,
    knowledge_stats,
    load_knowledge,
    load_profile,
    reload_knowledge,
    save_uploaded_doc,
    search_knowledge,
)
from .agent_settings import DELIVERY_MODES, SALES_STYLES, get_settings_store
from .audio import AudioTooLarge, AudioUnavailable, synthesize, transcribe
from .scope_guard import is_off_topic, redirect_reply
from .security import image_size_error
from .state import TurnContext, cart_summary
from .text import format_for_whatsapp
from .tools import SALES_TOOLS

settings = get_settings()
log = logging.getLogger("agent-v2")

_PUBLIC_PATHS = {"/healthz"}

# Mensaje que sí llega al cliente cuando el grafo falla o se cuelga: del otro
# lado hay una persona esperando por WhatsApp, no un desarrollador viendo
# logs. commerce-api (agent-bridge.service.ts) descarta la respuesta si el
# HTTP status no es 2xx, así que un 502/504 aquí equivale a dejar al cliente
# sin ninguna respuesta.
_FALLBACK_REPLY = (
    "Ahorita no puedo consultar el sistema para seguir ayudándote. "
    "Ya le avisé a una persona de nuestro equipo para que te atienda enseguida."
)


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


class _ThreadLocks:
    """Un lock por `thread_id`, no uno global.

    Dos mensajes casi simultáneos del mismo cliente (doble tap, reintento de
    Evolution API que se cruza con el mensaje real) invocan el grafo sobre el
    mismo hilo: sin serializar por hilo se puede leer el carrito antes de que
    el otro turno lo actualice. Un lock global serializaría a TODOS los
    clientes del servicio, así que se indexa por thread_id.
    """

    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = {}
        self._guard = asyncio.Lock()

    async def acquire(self, thread_id: str) -> asyncio.Lock:
        async with self._guard:
            lock = self._locks.setdefault(thread_id, asyncio.Lock())
            # Purga oportunista: nada obliga a que un thread_id viejo se
            # vuelva a usar, y sin esto el dict crece sin límite en un
            # proceso de larga vida.
            if len(self._locks) > 5000:
                for key, existing in list(self._locks.items()):
                    if not existing.locked():
                        del self._locks[key]
            return lock


class _IdempotencyStore:
    """Persiste `messageId -> respuesta ya calculada` por hilo.

    Evolution API reintenta webhooks de WhatsApp: el mismo mensaje puede
    llegar dos veces con el mismo `messageId`. Sin esto el agente vuelve a
    cotizar o a generar un link de pago nuevo en el reintento. Vive en su
    propio archivo sqlite (no en el de `AsyncSqliteSaver`) para no competir
    por la única conexión que el checkpointer mantiene abierta todo el
    proceso.
    """

    def __init__(self, path: Any) -> None:
        self._path = path
        self._conn: aiosqlite.Connection | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        self._conn = await aiosqlite.connect(str(self._path))
        await self._conn.execute(
            "CREATE TABLE IF NOT EXISTS processed_messages ("
            "thread_id TEXT NOT NULL, message_id TEXT NOT NULL, "
            "response TEXT NOT NULL, created_at REAL NOT NULL, "
            "PRIMARY KEY (thread_id, message_id))"
        )
        await self._conn.commit()

    async def stop(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def get(self, thread_id: str, message_id: str | None) -> dict[str, Any] | None:
        if not message_id or self._conn is None:
            return None
        async with self._lock:
            cursor = await self._conn.execute(
                "SELECT response FROM processed_messages WHERE thread_id = ? AND message_id = ?",
                (thread_id, message_id),
            )
            row = await cursor.fetchone()
        return json.loads(row[0]) if row else None

    async def put(self, thread_id: str, message_id: str | None, response: dict[str, Any]) -> None:
        if not message_id or self._conn is None:
            return
        async with self._lock:
            await self._conn.execute(
                "INSERT OR REPLACE INTO processed_messages "
                "(thread_id, message_id, response, created_at) VALUES (?, ?, ?, ?)",
                (thread_id, message_id, json.dumps(response), time.time()),
            )
            # Límite explícito por hilo: no hace falta recordar más que los
            # últimos reintentos razonables de un mismo mensaje.
            await self._conn.execute(
                "DELETE FROM processed_messages WHERE thread_id = ? AND message_id NOT IN ("
                "SELECT message_id FROM processed_messages WHERE thread_id = ? "
                "ORDER BY created_at DESC LIMIT 50)",
                (thread_id, thread_id),
            )
            await self._conn.commit()

    async def delete_thread(self, thread_id: str) -> None:
        if self._conn is None:
            return
        async with self._lock:
            await self._conn.execute(
                "DELETE FROM processed_messages WHERE thread_id = ?", (thread_id,)
            )
            await self._conn.commit()


class _Runtime:
    """Checkpointer y grafo viven todo el proceso: abrir la BD por turno
    perdería el hilo y costaría una conexión cada mensaje."""

    def __init__(self) -> None:
        self._stack: contextlib.AsyncExitStack | None = None
        self.agent: Any = None
        self.checkpointer: AsyncSqliteSaver | None = None
        self.thread_locks = _ThreadLocks()
        self.scope_model: Any = None
        self.idempotency = _IdempotencyStore(settings.data_dir / "idempotency.sqlite")

    async def start(self) -> None:
        self._stack = contextlib.AsyncExitStack()
        self.checkpointer = await self._stack.enter_async_context(
            AsyncSqliteSaver.from_conn_string(str(settings.checkpoint_path))
        )
        self.agent = build_agent(self.checkpointer, settings)
        self.scope_model = build_scope_model(settings)
        await self.idempotency.start()

    async def stop(self) -> None:
        await self.idempotency.stop()
        if self._stack is not None:
            await self._stack.aclose()
            self._stack = None
        self.agent = None
        self.checkpointer = None


runtime = _Runtime()


@contextlib.asynccontextmanager
async def _lifespan(_: FastAPI):
    # Si `start()` falla (p. ej. no se puede abrir el sqlite del checkpoint),
    # se deja que la excepción suba: uvicorn debe morir en vez de quedar
    # "arriba" con `runtime.agent is None" respondiendo 503 a todo para
    # siempre sin que nadie lo note.
    await runtime.start()
    # El primer turno tras arrancar tardaba ~28s (catálogo sin cachear,
    # conocimiento sin leer, cliente del modelo sin inicializar) y el puente de
    # commerce-api aborta a los 30s: justo después de un despliegue, el primer
    # cliente de WhatsApp se quedaba sin respuesta. Precalentar deja ese turno
    # en el rango normal de 3-5s.
    await _warmup()
    try:
        yield
    finally:
        await runtime.stop()


async def _warmup() -> None:
    """Best-effort: si algo falla aquí el servicio arranca igual, solo pagará
    el costo en el primer turno."""
    try:
        load_knowledge(DEFAULT_TENANT_ID)
        await warm_catalog()
    except Exception:  # noqa: BLE001
        log.warning("no se pudo precalentar el agente", exc_info=True)


app = FastAPI(
    title="Easy Sell Agent v2",
    version="2.0.0",
    description="Agente comercial sobre LangGraph con memoria persistente por conversación.",
    dependencies=[Depends(require_internal_key)],
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.public_base_url, "http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "X-Internal-Key"],
)


# ---------------- modelos de entrada/salida ----------------


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
    attachment: dict[str, Any] | None = None
    """Adjunto de este turno (p. ej. PDF de cotización), si una tool lo dejó
    en `pending_attachment`. El canal (WhatsApp) decide cómo mandarlo."""


# ---------------- salud ----------------


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    # Probe de liveness: si el arranque falló o ya se hizo shutdown, el
    # servicio debe reportarse mal para que el orquestador lo reinicie, no
    # quedarse "ok" respondiendo 503 a todo lo demás indefinidamente.
    if runtime.agent is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")
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
                None
                if settings.commerce_live
                else "AGENT_INTERNAL_KEY_REF o AGENT_API_KEY_REF no configurada",
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
        "knowledgeChars": len(load_knowledge(DEFAULT_TENANT_ID)),
        "budgets": {
            "recursionLimit": settings.recursion_limit,
            "turnTimeoutSeconds": settings.turn_timeout_seconds,
            "summarizeAfterMessages": settings.summarize_after_messages,
            "keepMessages": settings.keep_messages,
        },
    }


@app.post("/knowledge/reload")
async def knowledge_reload(tenantId: str = DEFAULT_TENANT_ID) -> dict[str, Any]:
    return {"chars": len(reload_knowledge(tenantId))}


# ---------------- configuración por tenant ----------------


class AgentSettingsPayload(BaseModel):
    agent_name: str | None = None
    business_name: str | None = None
    tone: str | None = None
    greeting: str | None = None
    language: str | None = None
    currency: str | None = None
    emoji: bool | None = None
    sales_style: str | None = None
    ask_name_before_quote: bool | None = None
    ask_email_before_quote: bool | None = None
    auto_history_lookup: bool | None = None
    max_products_per_message: int | None = None
    default_delivery_mode: str | None = None
    handoff_keywords: list[str] | str | None = None
    forbidden_topics: str | None = None
    extra_rules: str | None = None
    text_model: str | None = None
    classifier_model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    # "" borra la key guardada; None (ausente en el body) la deja intacta.
    # No pasa por el filtro `if v is not None` de abajo con "" porque "" no es
    # None, así que sí llega a sanitize() para poder limpiarla.
    openrouter_api_key: str | None = None
    whatsapp_plain_text: bool | None = None
    auto_reply: bool | None = None


async def _settings_view(tenant_id: str) -> dict[str, Any]:
    profile = load_profile(tenant_id)
    company = await load_company_context(tenant_id)
    business_name = str(company.get("name") or profile.name)
    current = get_settings_store().get(tenant_id)
    return {
        "tenantId": tenant_id,
        "settings": current.to_dict(),
        "defaults": {
            "agent_name": profile.agent_name,
            "business_name": business_name,
            "tone": profile.tone,
            "greeting": profile.greeting,
            "language": profile.language,
            "currency": profile.currency,
            "emoji": profile.emoji,
            "text_model": settings.model,
            "classifier_model": settings.model,
            "temperature": settings.temperature,
            "max_tokens": settings.max_tokens,
        },
        "options": {
            "sales_style": list(SALES_STYLES),
            "default_delivery_mode": list(DELIVERY_MODES),
            "models": [{"id": settings.model, "toolCalling": True, "notes": ""}],
        },
    }


@app.get("/settings")
async def get_settings_endpoint(tenantId: str = Query(...)) -> dict[str, Any]:
    return await _settings_view(tenantId)


@app.put("/settings")
async def put_settings(req: AgentSettingsPayload, tenantId: str = Query(...)) -> dict[str, Any]:
    get_settings_store().update(tenantId, {k: v for k, v in req.model_dump().items() if v is not None})
    return await _settings_view(tenantId)


@app.delete("/settings")
async def reset_settings(tenantId: str = Query(...)) -> dict[str, Any]:
    get_settings_store().reset(tenantId)
    return await _settings_view(tenantId)


# ---------------- aprendizaje ----------------


class ApproveSignalRequest(BaseModel):
    answer: str


@app.get("/learning/signals")
async def learning_signals(
    tenantId: str | None = None, status: str | None = "pending"
) -> dict[str, Any]:
    signals = await get_learning_store().list_signals(tenant_id=tenantId, status=status)
    return {"signals": [s.to_dict() for s in signals]}


@app.post("/learning/signals/{signal_id}/approve")
async def approve_signal(
    signal_id: str, req: ApproveSignalRequest, tenantId: str | None = None
) -> dict[str, Any]:
    try:
        signal = await get_learning_store().approve(
            signal_id, answer=req.answer, tenant_id=tenantId
        )
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


@app.post("/learning/signals/{signal_id}/dismiss")
async def dismiss_signal(signal_id: str, tenantId: str | None = None) -> dict[str, Any]:
    try:
        signal = await get_learning_store().dismiss(signal_id, tenant_id=tenantId)
    except SignalNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Señal no encontrada") from exc
    except SignalTenantMismatchError as exc:
        raise HTTPException(status_code=403, detail="Señal de otro negocio") from exc
    return signal.to_dict()


# ---------------- conocimiento del negocio ----------------


@app.get("/knowledge")
async def knowledge_index(tenantId: str = DEFAULT_TENANT_ID) -> dict[str, Any]:
    result = {**knowledge_stats(tenantId), "outline": knowledge_outline(tenantId)}
    company = await load_company_context(tenantId)
    if company.get("name"):
        result["profile"] = {**result["profile"], "name": str(company["name"])}
    return result


@app.get("/knowledge/search")
async def knowledge_search(
    q: str = Query(..., min_length=2), tenantId: str = DEFAULT_TENANT_ID
) -> dict[str, Any]:
    return {"hits": search_knowledge(tenantId, q)}


@app.post("/knowledge/upload")
async def knowledge_upload(
    file: UploadFile = File(...), tenantId: str = DEFAULT_TENANT_ID
) -> dict[str, Any]:
    content = await file.read()
    try:
        doc_id = save_uploaded_doc(tenantId, file.filename or "", content)
    except KnowledgeUploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"docId": doc_id, "chars": len(reload_knowledge(tenantId))}


@app.delete("/knowledge/{doc_id:path}")
async def knowledge_delete(doc_id: str, tenantId: str = DEFAULT_TENANT_ID) -> dict[str, Any]:
    try:
        removed = delete_knowledge_doc(tenantId, doc_id)
    except KnowledgeUploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    return {"deleted": doc_id, "chars": len(reload_knowledge(tenantId))}


# ---------------- audio ----------------


class SttRequest(BaseModel):
    audioBase64: str
    filename: str = "nota.ogg"


class TtsRequest(BaseModel):
    text: str
    voice: str | None = None


@app.post("/audio/stt")
async def audio_stt(req: SttRequest) -> dict[str, Any]:
    """Nota de voz -> texto. Lo llama commerce-api con el binario que baja de
    Evolution (ver whatsapp.controller.ts) y el micrófono del chat web."""
    try:
        audio = base64.b64decode(req.audioBase64)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="audioBase64 inválido") from exc
    try:
        return await transcribe(audio, filename=req.filename)
    except AudioTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except AudioUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/audio/tts")
async def audio_tts(req: TtsRequest) -> dict[str, Any]:
    try:
        return await synthesize(req.text, voice=req.voice)
    except AudioUnavailable as exc:
        # Degradación explícita: el canal manda el texto y ya.
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/evals")
async def evals(
    judge: bool = False,
    category: list[str] | None = Query(default=None),
    limit: int | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Suite de evaluación del agente.

    `dry_run` viene en True a propósito: cada caso real gasta llamadas al
    modelo (dinero), y un GET casual desde el panel no debe cobrarlas. Para
    la corrida de verdad hay que pedirla explícitamente con dry_run=false.
    """
    from .evals.runner import run_suite

    return await run_suite(categories=category, judge=judge, limit=limit, dry_run=dry_run)


@app.get("/tools")
async def list_tools() -> dict[str, Any]:
    """El panel lista qué puede ejecutar el agente y con qué permiso."""
    from .security import TOOL_SCOPES

    return {
        "tools": [
            {
                "name": t.name,
                "description": (t.description or "").strip().split("\n")[0],
                "scope": TOOL_SCOPES.get(t.name, ""),
                "mutating": TOOL_SCOPES.get(t.name) in {"quotes.write", "orders.write", "chat.write"},
            }
            for t in SALES_TOOLS
        ]
    }


# ---------------- conversación ----------------


def _response_from_values(
    conversation_id: str,
    values: dict[str, Any],
    *,
    reply: str,
    handoff: bool,
    intent: str | None,
    engine: str,
    latency_ms: int,
    tool_calls: list[dict[str, Any]] | None = None,
) -> ChatResponse:
    """Arma el `ChatResponse` a partir del estado persistido del hilo.

    Se comparte entre el turno normal, la rama de handoff activo y la
    degradación por error: las tres devuelven la misma forma de contrato.
    """
    return ChatResponse(
        conversationId=conversation_id,
        reply=reply,
        handoff=handoff,
        intent=intent,
        stage=values.get("stage"),
        cart=list(values.get("cart") or []),
        totals=values.get("last_totals"),
        quote={"quoteId": values["quote_id"], "linkRef": values.get("quote_link")}
        if values.get("quote_id")
        else None,
        checkout={"linkRef": values["checkout_link"]} if values.get("checkout_link") else None,
        customer=dict(values.get("customer") or {}),
        todos=list(values.get("todos") or []),
        toolCalls=tool_calls or [],
        suggestions=_suggestions(values) if not handoff else [],
        engine=engine,
        latencyMs=latency_ms,
        attachment=values.get("pending_attachment"),
    )


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    text = (req.text or "").strip()[: settings.max_input_chars]
    if not text and req.imageBase64:
        text = "[el cliente envió una imagen]"
    if not text:
        raise HTTPException(status_code=400, detail="Se requiere text")
    if image_error := image_size_error(req.imageBase64):
        raise HTTPException(status_code=413, detail=image_error)
    if runtime.agent is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")

    conversation_id = req.conversationId or f"{req.tenantId}:{req.customerPhone or 'anon'}"
    # thread_id = conversación: aquí es donde LangGraph recupera el hilo previo.
    thread_id = f"{req.tenantId}:{conversation_id}"
    config = {
        "configurable": {"thread_id": thread_id},
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

    # Todo lo que sigue toca el mismo hilo: se serializa por conversación
    # (no globalmente) para que dos mensajes casi simultáneos del mismo
    # cliente no lean/escriban el carrito en desorden.
    lock = await runtime.thread_locks.acquire(thread_id)
    async with lock:
        cached = await runtime.idempotency.get(thread_id, req.messageId)
        if cached is not None:
            log.info("messageId repetido, devolviendo respuesta previa: %s", req.messageId)
            return ChatResponse(**cached)

        snapshot = await runtime.agent.aget_state(config)
        state_values: dict[str, Any] = dict(snapshot.values or {})

        if state_values.get("handoff"):
            # Una persona ya tomó la conversación (T-AIA-06 en v1): el bot no
            # vuelve a publicar. Se registra el mensaje del cliente para que
            # quien la atienda vea el hilo completo, pero no se invoca al modelo.
            with contextlib.suppress(Exception):
                await runtime.agent.aupdate_state(config, {"messages": [HumanMessage(content=content)]})
            response = _response_from_values(
                conversation_id,
                state_values,
                reply="",
                handoff=True,
                intent="HUMAN_ACTIVE",
                engine="handoff",
                latency_ms=0,
            )
            await runtime.idempotency.put(thread_id, req.messageId, response.model_dump())
            return response

        started = asyncio.get_running_loop().time()

        # Guardarraíl de tema antes del grafo: un mensaje ajeno al negocio no
        # debe pagar el bucle de herramientas ni quedar en el hilo como si
        # fuera parte de la venta. Solo aplica a texto: una imagen o una nota
        # de voz ya transcrita se dejan pasar al agente.
        if not req.imageBase64 and await is_off_topic(
            text,
            model=runtime.scope_model,
            settings=settings,
            business=_business_name(req.tenantId),
            forbidden_topics=get_settings_store().get(req.tenantId).forbidden_topics,
            last_reply=_last_assistant_reply(state_values),
        ):
            log.info("mensaje fuera de tema en %s, no se invoca al agente", conversation_id)
            reply = redirect_reply(_business_name(req.tenantId), text)
            response = _response_from_values(
                conversation_id,
                state_values,
                reply=format_for_whatsapp(reply) if req.channel == "whatsapp" else reply,
                handoff=False,
                intent="FUERA_DE_TEMA",
                engine="scope-guard",
                latency_ms=int((asyncio.get_running_loop().time() - started) * 1000),
            )
            await runtime.idempotency.put(thread_id, req.messageId, response.model_dump())
            return response

        try:
            result = await asyncio.wait_for(
                runtime.agent.ainvoke(
                    {"messages": [HumanMessage(content=content)]},
                    config=config,
                    context=context,
                ),
                timeout=settings.turn_timeout_seconds,
            )
        except Exception as exc:  # noqa: BLE001 - el canal necesita una respuesta, no un stacktrace
            if isinstance(exc, asyncio.TimeoutError):
                reason = "TIMEOUT"
            elif isinstance(exc, GraphRecursionError):
                reason = "RECURSION_LIMIT"
            else:
                reason = "ERROR_TECNICO"
            log.exception("fallo del turno (%s), degradando a handoff", reason)

            # Se marca handoff en el hilo para que los próximos mensajes de
            # este cliente (aunque no repitan el messageId) tampoco vuelvan a
            # pegarle a un grafo que ya se demostró que falla, hasta que una
            # persona lo libere con POST /conversations/{id}/release.
            with contextlib.suppress(Exception):
                await runtime.agent.aupdate_state(
                    config,
                    {"handoff": True, "handoff_reason": reason, "stage": "HUMANO"},
                )
                # Se relee para que la respuesta refleje el handoff recién
                # persistido (p. ej. `stage`) en vez del snapshot de antes
                # del fallo, que en un hilo nuevo puede venir vacío.
                state_values = dict((await runtime.agent.aget_state(config)).values or state_values)
            latency_ms = int((asyncio.get_running_loop().time() - started) * 1000)
            response = _response_from_values(
                conversation_id,
                state_values,
                reply=format_for_whatsapp(_FALLBACK_REPLY) if req.channel == "whatsapp" else _FALLBACK_REPLY,
                handoff=True,
                intent=reason,
                engine="error-fallback",
                latency_ms=latency_ms,
            )
            await runtime.idempotency.put(thread_id, req.messageId, response.model_dump())
            return response

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

        handoff = bool(result.get("handoff"))
        await _record_learning(
            tenant_id=req.tenantId,
            conversation_id=conversation_id,
            question=text,
            reply=reply,
            handoff=handoff,
            messages=messages,
            handoff_reason=result.get("handoff_reason"),
        )

        response = _response_from_values(
            conversation_id,
            result,
            reply=reply,
            handoff=handoff,
            intent=result.get("stage"),
            engine="langgraph",
            latency_ms=latency_ms,
            tool_calls=tool_calls,
        )
        if result.get("pending_attachment"):
            # El adjunto es de este turno; si se queda en el checkpoint,
            # `_response_from_values` lo reenviaría también en el próximo
            # turno aunque nadie haya emitido una cotización nueva.
            with contextlib.suppress(Exception):
                await runtime.agent.aupdate_state(config, {"pending_attachment": None})

        await runtime.idempotency.put(thread_id, req.messageId, response.model_dump())
        return response


def _business_name(tenant_id: str) -> str:
    overrides = get_settings_store().get(tenant_id)
    return overrides.business_name or load_profile(tenant_id).name


def _last_assistant_reply(state_values: dict[str, Any]) -> str:
    """El último mensaje del agente es lo que hace interpretable un "sí" o un
    "la segunda" sueltos para el guardarraíl."""
    for message in reversed(state_values.get("messages") or []):
        if isinstance(message, AIMessage) and isinstance(message.content, str) and message.content.strip():
            return message.content.strip()
    return ""


async def _record_learning(
    *,
    tenant_id: str,
    conversation_id: str,
    question: str,
    reply: str,
    handoff: bool,
    messages: list[Any],
    handoff_reason: Any,
) -> None:
    """Deja la señal para que el dueño del negocio la revise en el panel.

    Es best-effort: si el almacén falla, el cliente ya tiene su respuesta y no
    se le va a romper la conversación por no poder registrar una señal.
    """
    store = get_learning_store()
    try:
        if handoff:
            # El resumen real lo escribió el modelo al llamar la herramienta;
            # en el estado solo sobrevive el motivo, así que se rescata del
            # tool_call antes de que el Command lo colapse.
            summary = ""
            reason = str(handoff_reason or "") or None
            for message in reversed(messages):
                for call in getattr(message, "tool_calls", None) or []:
                    if call.get("name") == "escalar_a_humano":
                        args = call.get("args") or {}
                        summary = str(args.get("resumen") or "")
                        reason = str(args.get("motivo") or "") or reason
                        break
                if summary:
                    break
            await store.record_handoff(
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                summary=summary or question,
                reason=reason,
            )
        elif reply and looks_like_unanswered(reply):
            await store.record_unanswered_question(
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                question=question,
            )
    except Exception:  # noqa: BLE001 - registrar la señal nunca puede tumbar el turno
        log.warning("no se pudo registrar la señal de aprendizaje", exc_info=True)


@app.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, tenantId: str = Query(...)) -> dict[str, Any]:
    """Estado persistido del hilo: lo que el agente recuerda de esa conversación."""
    if runtime.agent is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")
    config = {"configurable": {"thread_id": f"{tenantId}:{conversation_id}"}}
    snapshot = await runtime.agent.aget_state(config)
    values = snapshot.values or {}
    if not values:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")
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


@app.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, tenantId: str = Query(...)) -> dict[str, str]:
    """Borra el hilo completo (checkpoint + cache de idempotencia)."""
    if runtime.agent is None or runtime.checkpointer is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")
    thread_id = f"{tenantId}:{conversation_id}"
    await runtime.checkpointer.adelete_thread(thread_id)
    await runtime.idempotency.delete_thread(thread_id)
    return {"status": "deleted"}


@app.post("/conversations/{conversation_id}/release")
async def release_conversation(conversation_id: str, tenantId: str = Query(...)) -> dict[str, Any]:
    """Devuelve el control al bot después de un handoff (humano o por error)."""
    if runtime.agent is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")
    thread_id = f"{tenantId}:{conversation_id}"
    config = {"configurable": {"thread_id": thread_id}}
    snapshot = await runtime.agent.aget_state(config)
    if not snapshot.values:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")

    # `handoff_reason` usa el reducer "gana el valor nuevo salvo que sea None"
    # (ver state.py `_last`): mandar None lo dejaría intacto, así que se limpia
    # con "" en vez de None. `stage` vuelve a DESCUBRIMIENTO en vez de dejarlo
    # en HUMANO, que es el valor con el que se marcó el handoff.
    async with (await runtime.thread_locks.acquire(thread_id)):
        await runtime.agent.aupdate_state(
            config,
            {"handoff": False, "handoff_reason": "", "stage": "DESCUBRIMIENTO"},
        )
        values = (await runtime.agent.aget_state(config)).values or {}
    return {
        "conversationId": conversation_id,
        "handoff": bool(values.get("handoff")),
        "stage": values.get("stage"),
    }


def _suggestions(state: dict[str, Any]) -> list[str]:
    if state.get("checkout_link"):
        return ["Ya pagué", "¿Cuándo llega mi pedido?"]
    if state.get("quote_id"):
        return ["Sí, quiero pagar", "Tengo una duda"]
    if state.get("cart"):
        return ["Emitir cotización", "Cambiar cantidad"]
    return ["¿Qué venden?", "Quiero cotizar", "¿Hacen envíos?"]
