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
import re
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
_ROOT_ENV = Path(__file__).resolve().parents[1] / ".env"
if _ROOT_ENV.exists():
    load_dotenv(_ROOT_ENV, override=False)

from .agent import build_agent, build_model, build_scope_model
from .commerce import CommerceClient
from .config import get_settings
from .guards import (
    OutputGuard,
    detect_injection,
    install_log_redaction,
    is_off_topic,
    neutralize,
    off_scope_category,
    redact_pii,
    redirect_reply,
    urls_from_messages,
)
from .memory import (
    Episode,
    build_llm_summarizer,
    clear_history,
    compact_thread,
    enrich_with_llm,
    forbidden_terms_from_state,
    get_episode_store,
    heuristic_episode,
    history_chars,
)
from .prompts import PromptVersionNotFound, get_prompt_registry
from .tenant_context import (
    invalidate_tenant_caches,
    load_company_context,
    resolve_tenant_bundle,
    warm_catalog,
)
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
from .agent_settings import (
    DELIVERY_MODES,
    HUMAN_REPLY_FILTER_ACTIONS,
    SALES_STYLES,
    get_settings_store,
)
from .moderation import (
    DEFAULT_MODERATION_MODEL,
    model_options as moderation_model_options,
    moderate_reply,
)
from .audio import AudioTooLarge, AudioUnavailable, synthesize, transcribe
from .security import image_size_error
from .state import CartRecord, TurnContext, cart_summary, open_carts, overall_stage
from .text import format_for_whatsapp
from .tools import SALES_TOOLS
from .web_reader import WebReadError, crawl_url, save_web_page

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
        self.output_guard = OutputGuard(settings)
        # Modelo para resúmenes de compactación y extracción episódica: tareas
        # internas, así que usan el modelo fijo del proceso, no el del tenant.
        self.utility_model: Any = None

    async def start(self) -> None:
        self._stack = contextlib.AsyncExitStack()
        self.checkpointer = await self._stack.enter_async_context(
            AsyncSqliteSaver.from_conn_string(str(settings.checkpoint_path))
        )
        self.agent = build_agent(self.checkpointer, settings)
        self.scope_model = build_scope_model(settings)
        self.utility_model = (
            build_model(settings, model=settings.episodic_model or settings.summary_model or settings.model, temperature=0.2, max_tokens=600)
            if settings.llm_live
            else None
        )
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
    # Los ids de conversación llevan el teléfono del cliente y los mensajes
    # pueden traer correos: ningún log del proceso debe escribirlos en claro.
    install_log_redaction()
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
    # Compatibilidad con v1 / paneles que aún no leen `carts`: reflejan el
    # carrito ACTIVO (ver `_primary_cart`). Con un solo pedido en curso —el
    # caso normal— son exactamente lo que eran antes.
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
            "compactAfterChars": settings.compact_after_chars,
            "compactKeepTurns": settings.compact_keep_turns,
        },
        "prompts": {
            "default": settings.prompt_version,
            "latest": get_prompt_registry().latest(),
            "versions": get_prompt_registry().versions(),
        },
        "guards": {
            "inputHeuristics": settings.input_heuristics_enabled,
            "scopeGuard": settings.scope_guard_enabled,
            "scopeGuardFailClosed": settings.scope_guard_fail_closed,
            "outputGuard": settings.output_guard_enabled,
        },
        "episodicMemory": {
            "enabled": settings.episodic_memory_enabled,
            "lessonsInPrompt": settings.episodic_lessons_in_prompt,
        },
    }


# ---------------- prompts versionados ----------------


@app.get("/prompts")
async def prompts_index() -> dict[str, Any]:
    """Versiones de prompt disponibles y cuál resuelve `latest`."""
    return {**get_prompt_registry().to_dict(), "processDefault": settings.prompt_version}


@app.get("/prompts/{version}")
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


@app.post("/prompts/reload")
async def prompts_reload() -> dict[str, Any]:
    """Relee `prompts/` de disco (nueva versión desplegada sin reiniciar)."""
    registry = get_prompt_registry()
    registry.reload()
    return {"latest": registry.latest(), "versions": registry.versions()}


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
    prompt_version: str | None = None
    whatsapp_plain_text: bool | None = None
    auto_reply: bool | None = None
    human_reply_filter_enabled: bool | None = None
    human_reply_filter_model: str | None = None
    human_reply_filter_action: str | None = None
    auto_close_enabled: bool | None = None
    # "" es un valor con significado (quitar el plazo), igual que la key de
    # OpenRouter: pasa el filtro `if v is not None` de `put_settings`.
    auto_close_after: str | None = None


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
            "human_reply_filter_model": DEFAULT_MODERATION_MODEL,
            "prompt_version": settings.prompt_version,
        },
        "options": {
            "prompt_version": ["latest", *get_prompt_registry().versions()],
            "sales_style": list(SALES_STYLES),
            "default_delivery_mode": list(DELIVERY_MODES),
            "models": [{"id": settings.model, "toolCalling": True, "notes": ""}],
            # Modelos chicos para el filtro de respuestas humanas, los más
            # baratos primero (`cheap` los marca para el panel).
            "human_reply_filter_model": moderation_model_options(),
            "human_reply_filter_action": list(HUMAN_REPLY_FILTER_ACTIONS),
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


# ---------------- filtro de respuestas humanas ----------------


class ModerationRequest(BaseModel):
    tenantId: str
    text: str = ""


@app.post("/moderation/reply")
async def moderate_human_reply(req: ModerationRequest) -> dict[str, Any]:
    """Revisa una respuesta que un operador va a mandarle al cliente.

    No-op (`allowed: true`) si el tenant tiene el filtro apagado, y siempre
    hacia abierto ante cualquier falla: commerce-api usa esto para decidir si
    bloquea el envío, así que un moderador caído no puede dejar al negocio sin
    contestar. Ver `moderation.py`.
    """
    result = await moderate_reply(req.tenantId, req.text, settings=settings)
    return result.to_dict()


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


# ---------------- conocimiento: leer una página web (crawl4ai) ----------------
# El contenido bajado de la web se trata igual que un .md subido a mano: dato
# del negocio, nunca instrucción para el modelo (ver docstring de
# web_reader.py). tenantId llega igual que en el resto de /knowledge/*: query
# param con default, que el proxy de apps/web siempre sobrescribe con el
# tenant autenticado antes de reenviar la request.


class WebPreviewRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)


class WebSaveRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    title: str = Field(min_length=1, max_length=200)
    # None = guardar todas las secciones detectadas en el preview.
    sections: list[str] | None = None
    filename: str | None = None


@app.post("/knowledge/web/preview")
async def knowledge_web_preview(
    req: WebPreviewRequest, tenantId: str = DEFAULT_TENANT_ID  # noqa: ARG001 — solo lectura, no toca disco; se acepta por paridad con el resto de /knowledge/*
) -> dict[str, Any]:
    result = await crawl_url(req.url)
    if result.error:
        raise HTTPException(status_code=400, detail=result.error)
    return {
        "url": result.url,
        "title": result.title,
        "sections": [{"heading": s.heading, "body": s.body} for s in result.sections],
    }


@app.post("/knowledge/web/save")
async def knowledge_web_save(req: WebSaveRequest, tenantId: str = DEFAULT_TENANT_ID) -> dict[str, Any]:
    try:
        doc_id, _ = await save_web_page(
            tenantId,
            url=req.url,
            title=req.title,
            selected_sections=req.sections,
            filename=req.filename,
        )
    except (WebReadError, KnowledgeUploadError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"docId": doc_id, "chars": len(reload_knowledge(tenantId))}


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


def _quote_payload(record: CartRecord) -> dict[str, Any] | None:
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


def _checkout_payload(record: CartRecord) -> dict[str, Any] | None:
    if not record.get("checkoutLink"):
        return None
    return {"linkRef": record["checkoutLink"], "orderId": record.get("orderId")}


def _cart_payload(cart_id: str, record: CartRecord) -> dict[str, Any]:
    """Un carrito, en la forma que expone la API (`carts[]` de `ChatResponse`)."""
    return {
        "cartId": cart_id,
        "lines": list(record.get("lines") or []),
        "totals": record.get("lastTotals"),
        "quote": _quote_payload(record),
        "checkout": _checkout_payload(record),
        "stage": record.get("stage"),
    }


def _primary_cart(values: dict[str, Any]) -> tuple[str, CartRecord]:
    """El carrito que llenan los campos singulares de compatibilidad: el
    activo si tiene algo que mostrar, si no el más avanzado, si no vacío."""
    carts: dict[str, CartRecord] = values.get("carts") or {}
    active = values.get("active_cart_id")
    visible = open_carts(carts)
    if active and active in visible:
        return active, visible[active]
    if visible:
        cart_id = max(visible, key=lambda cid: len((visible[cid].get("lines") or [])) + bool(visible[cid].get("quoteId")))
        return cart_id, visible[cart_id]
    return "", {}


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
    carts: dict[str, CartRecord] = values.get("carts") or {}
    _primary_id, primary = _primary_cart(values)
    return ChatResponse(
        conversationId=conversation_id,
        reply=reply,
        handoff=handoff,
        intent=intent,
        stage=values.get("stage") or overall_stage(carts),
        cart=list(primary.get("lines") or []),
        totals=primary.get("lastTotals"),
        quote=_quote_payload(primary),
        checkout=_checkout_payload(primary),
        carts=[_cart_payload(cart_id, record) for cart_id, record in open_carts(carts).items()],
        customer=dict(values.get("customer") or {}),
        todos=list(values.get("todos") or []),
        toolCalls=tool_calls or [],
        suggestions=_suggestions(values) if not handoff else [],
        engine=engine,
        latencyMs=latency_ms,
        attachment=values.get("pending_attachment"),
    )


def _channel_text(reply: str, channel: str) -> str:
    return format_for_whatsapp(reply) if channel == "whatsapp" else reply


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    """Un turno de conversación. Orden de las capas (ver docs/ARCHITECTURE.md):

    idempotencia → handoff activo → heurísticas de inyección/fuera de tema →
    clasificador LLM de tema → compactación por presupuesto → grafo →
    guard de salida → señal de aprendizaje → respuesta.
    """
    # `neutralize` quita Unicode invisible y tokens de control de otros
    # formatos de chat antes de que el texto toque cualquier otra capa.
    text = neutralize((req.text or "").strip()[: settings.max_input_chars])
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
        business = _business_name(req.tenantId)

        def _redirect(intent: str, engine: str, reply: str) -> ChatResponse:
            return _response_from_values(
                conversation_id,
                state_values,
                reply=_channel_text(reply, req.channel),
                handoff=False,
                intent=intent,
                engine=engine,
                latency_ms=int((asyncio.get_running_loop().time() - started) * 1000),
            )

        # Capa 1 (determinista, sin tokens): inyección y fuera de tema obvio.
        # Un mensaje así no debe pagar el clasificador ni el grafo, ni quedar
        # en el hilo como si fuera parte de la venta.
        if settings.input_heuristics_enabled:
            verdict = detect_injection(text)
            if verdict.is_injection:
                log.info("intento de inyección (%s) en tenant %s", verdict.label, req.tenantId)
                response = _redirect("INYECCION", "injection-guard", redirect_reply(business, text))
                await runtime.idempotency.put(thread_id, req.messageId, response.model_dump())
                return response
            category = off_scope_category(text) if not req.imageBase64 else None
            if category:
                log.info("fuera de tema (%s) por heurística en tenant %s", category, req.tenantId)
                response = _redirect("FUERA_DE_TEMA", f"scope-heuristic:{category}", redirect_reply(business, text))
                await runtime.idempotency.put(thread_id, req.messageId, response.model_dump())
                return response

        # Capa 2 (LLM barato): clasificador de tema. Solo texto: una imagen o
        # una nota de voz ya transcrita se dejan pasar al agente.
        if not req.imageBase64 and await is_off_topic(
            text,
            model=runtime.scope_model,
            settings=settings,
            business=business,
            forbidden_topics=get_settings_store().get(req.tenantId).forbidden_topics,
            last_reply=_last_assistant_reply(state_values),
        ):
            log.info("mensaje fuera de tema por clasificador en tenant %s", req.tenantId)
            response = _redirect("FUERA_DE_TEMA", "scope-guard", redirect_reply(business, text))
            await runtime.idempotency.put(thread_id, req.messageId, response.model_dump())
            return response

        # Higiene de contexto: si el historial ya pesa más que el presupuesto,
        # se compacta ANTES de invocar (resumen + últimos turnos). Los hechos
        # comerciales viven en el estado y no dependen de esto.
        if settings.compact_after_chars > 0 and history_chars(state_values.get("messages")) > settings.compact_after_chars:
            with contextlib.suppress(Exception):
                await compact_thread(
                    runtime.agent,
                    config,
                    keep_turns=settings.compact_keep_turns,
                    summarizer=build_llm_summarizer(runtime.utility_model) if runtime.utility_model else None,
                    reason="presupuesto",
                )

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
                reply=_channel_text(_FALLBACK_REPLY, req.channel),
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
        reply_message: AIMessage | None = None
        for message in reversed(messages):
            if isinstance(message, AIMessage) and isinstance(message.content, str) and message.content.strip():
                reply = message.content.strip()
                reply_message = message
                break

        # Capa 3: guard de salida. Si el modelo filtró el prompt, notas
        # internas, código o un enlace inventado, la respuesta se sustituye y
        # el AIMessage del hilo también (para que el siguiente turno no lo
        # vea como "algo que ya dije").
        engine = "langgraph"
        if reply and settings.output_guard_enabled:
            bundle = await resolve_tenant_bundle(req.tenantId, include_catalog=False, include_lessons=False)
            verdict = runtime.output_guard.check(
                reply,
                business=business,
                protected_lines=bundle.prompt.protected_lines() if bundle.prompt else (),
                internal_notes=bundle.internal_notes,
                allowed_urls=urls_from_messages(messages) | _urls_in(bundle.knowledge),
                seed=f"{thread_id}:{req.messageId or text}",
            )
            if verdict.changed:
                log.warning("guard de salida (%s) en tenant %s", ",".join(verdict.reasons), req.tenantId)
                reply = verdict.reply
                engine = "output-guard" if not verdict.allowed else "langgraph"
                if reply_message is not None and getattr(reply_message, "id", None):
                    with contextlib.suppress(Exception):
                        await runtime.agent.aupdate_state(
                            config,
                            {"messages": [AIMessage(content=reply, id=reply_message.id)]},
                        )

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
        if handoff:
            # La conversación pasa a una persona: para el agente terminó. Se
            # captura el episodio (comportamiento, sin datos) en segundo plano.
            _schedule_episode(req.tenantId, conversation_id, req.channel, messages, result)

        response = _response_from_values(
            conversation_id,
            result,
            reply=reply,
            handoff=handoff,
            intent=result.get("stage"),
            engine=engine,
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


_URL_IN_TEXT = re.compile(r"https?://[^\s<>()\"']+", re.IGNORECASE)


def _urls_in(text: str) -> set[str]:
    return {m.group(0).rstrip(".,;:") for m in _URL_IN_TEXT.finditer(text or "")}


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
            # La señal la lee el dueño del negocio en el panel: va sin
            # teléfonos, correos ni tarjetas del cliente.
            await store.record_handoff(
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                summary=redact_pii(summary or question),
                reason=reason,
            )
        elif reply and looks_like_unanswered(reply):
            await store.record_unanswered_question(
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                question=redact_pii(question),
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
    carts: dict[str, CartRecord] = values.get("carts") or {}
    _primary_id, primary = _primary_cart(values)
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
        # Todos los pedidos abiertos de esta conversación, cada uno completo.
        "carts": [_cart_payload(cart_id, record) for cart_id, record in open_carts(carts).items()],
        "handoff": bool(values.get("handoff")),
        "todos": values.get("todos") or [],
        "messages": len(values.get("messages") or []),
    }


# ---------------- memoria episódica ----------------


async def _capture_episode(
    tenant_id: str,
    conversation_id: str,
    channel: str,
    messages: list[Any],
    values: dict[str, Any],
    *,
    extra_friction: tuple[str, ...] = (),
) -> Episode | None:
    """Extrae y guarda el episodio de una conversación terminada. Nunca lanza."""
    if not settings.episodic_memory_enabled or not tenant_id:
        return None
    try:
        bundle = await resolve_tenant_bundle(tenant_id, include_catalog=False, include_lessons=False)
        overrides = bundle.overrides
        episode = heuristic_episode(
            messages,
            values,
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            channel=channel,
            prompt_version=bundle.prompt_version,
            model=overrides.effective_model(settings.model),
            extra_friction=extra_friction,
        )
        if runtime.utility_model is not None and messages:
            terms = forbidden_terms_from_state(
                values,
                bundle.business_name,
                bundle.profile.agent_name,
                overrides.agent_name,
                str(bundle.company.get("name") or ""),
            )
            episode = await enrich_with_llm(
                episode, messages, model=runtime.utility_model, forbidden_terms=terms
            )
        await get_episode_store().save(episode)
        return episode
    except Exception:  # noqa: BLE001 - la memoria episódica nunca afecta al cliente
        log.warning("no se pudo guardar el episodio de la conversación", exc_info=True)
        return None


def _schedule_episode(
    tenant_id: str, conversation_id: str, channel: str, messages: list[Any], values: dict[str, Any]
) -> None:
    """Fire-and-forget: el turno no espera a la extracción."""
    if not settings.episodic_memory_enabled:
        return
    asyncio.ensure_future(
        _capture_episode(tenant_id, conversation_id, channel, list(messages), dict(values))
    )


@app.get("/memory/episodes")
async def list_episodes(tenantId: str = Query(...), limit: int = 50) -> dict[str, Any]:
    """Episodios (comportamiento conversacional, sin datos) del tenant."""
    episodes = await get_episode_store().list(tenantId, limit=limit)
    return {"tenantId": tenantId, "episodes": [e.to_dict() for e in episodes]}


@app.get("/memory/episodes/stats")
async def episode_stats(tenantId: str = Query(...)) -> dict[str, Any]:
    return await get_episode_store().stats(tenantId)


@app.get("/memory/lessons")
async def episode_lessons(tenantId: str = Query(...)) -> dict[str, Any]:
    """El bloque `<lecciones>` tal como entra al prompt del tenant."""
    lessons = await get_episode_store().lessons(tenantId, limit=settings.episodic_lessons_in_prompt)
    return {"tenantId": tenantId, "lessons": lessons}


@app.delete("/memory/episodes")
async def delete_episodes(tenantId: str = Query(...)) -> dict[str, Any]:
    return {"deleted": await get_episode_store().delete_tenant(tenantId)}


# ---------------- ciclo de vida del hilo ----------------


@app.post("/conversations/{conversation_id}/compact")
async def compact_conversation(
    conversation_id: str, tenantId: str = Query(...), keepTurns: int | None = None
) -> dict[str, Any]:
    """Compacta el historial: resumen + últimos `keepTurns` turnos del cliente.

    El carrito, el cliente y la cotización no se tocan (viven en el estado).
    """
    if runtime.agent is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")
    thread_id = f"{tenantId}:{conversation_id}"
    config = {"configurable": {"thread_id": thread_id}}
    async with (await runtime.thread_locks.acquire(thread_id)):
        snapshot = await runtime.agent.aget_state(config)
        if not snapshot.values:
            raise HTTPException(status_code=404, detail="Conversación no encontrada")
        result = await compact_thread(
            runtime.agent,
            config,
            keep_turns=settings.compact_keep_turns if keepTurns is None else max(0, keepTurns),
            summarizer=build_llm_summarizer(runtime.utility_model) if runtime.utility_model else None,
            reason="manual",
        )
    return {"conversationId": conversation_id, **result.to_dict()}


@app.delete("/conversations/{conversation_id}/messages")
async def clear_conversation_messages(conversation_id: str, tenantId: str = Query(...)) -> dict[str, Any]:
    """Vacía el historial de mensajes conservando carrito, cliente y cotización."""
    if runtime.agent is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")
    thread_id = f"{tenantId}:{conversation_id}"
    config = {"configurable": {"thread_id": thread_id}}
    async with (await runtime.thread_locks.acquire(thread_id)):
        snapshot = await runtime.agent.aget_state(config)
        if not snapshot.values:
            raise HTTPException(status_code=404, detail="Conversación no encontrada")
        removed = await clear_history(runtime.agent, config)
    return {"conversationId": conversation_id, "removedMessages": removed}


@app.post("/conversations/{conversation_id}/close")
async def close_conversation(
    conversation_id: str,
    tenantId: str = Query(...),
    channel: str = "whatsapp",
    delete: bool = False,
) -> dict[str, Any]:
    """Cierra la conversación: extrae el episodio y, si `delete`, borra el hilo.

    Lo llama el autocierre por inactividad de commerce-api o el panel.
    """
    if runtime.agent is None or runtime.checkpointer is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")
    thread_id = f"{tenantId}:{conversation_id}"
    config = {"configurable": {"thread_id": thread_id}}
    async with (await runtime.thread_locks.acquire(thread_id)):
        snapshot = await runtime.agent.aget_state(config)
        values = dict(snapshot.values or {})
        if not values:
            raise HTTPException(status_code=404, detail="Conversación no encontrada")
        episode = await _capture_episode(
            tenantId, conversation_id, channel, list(values.get("messages") or []), values
        )
        if delete:
            await runtime.checkpointer.adelete_thread(thread_id)
            await runtime.idempotency.delete_thread(thread_id)
    return {
        "conversationId": conversation_id,
        "deleted": delete,
        "episode": episode.to_dict() if episode else None,
    }


@app.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str, tenantId: str = Query(...), capture: bool = True
) -> dict[str, Any]:
    """Borra el hilo completo (checkpoint + cache de idempotencia).

    Antes de borrar captura el episodio (`capture=false` lo evita).
    """
    if runtime.agent is None or runtime.checkpointer is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")
    thread_id = f"{tenantId}:{conversation_id}"
    config = {"configurable": {"thread_id": thread_id}}
    episode = None
    async with (await runtime.thread_locks.acquire(thread_id)):
        if capture:
            snapshot = await runtime.agent.aget_state(config)
            values = dict(snapshot.values or {})
            if values.get("messages"):
                episode = await _capture_episode(
                    tenantId, conversation_id, "", list(values.get("messages") or []), values
                )
        await runtime.checkpointer.adelete_thread(thread_id)
        await runtime.idempotency.delete_thread(thread_id)
    return {"status": "deleted", "episodeCaptured": episode is not None}


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
    carts: dict[str, CartRecord] = state.get("carts") or {}
    visible = list(open_carts(carts).values())
    if any(c.get("checkoutLink") for c in visible):
        return ["Ya pagué", "¿Cuándo llega mi pedido?"]
    if any(c.get("quoteId") for c in visible):
        return ["Sí, quiero pagar", "Tengo una duda"]
    if visible:
        return ["Emitir cotización", "Cambiar cantidad"]
    return ["¿Qué venden?", "Quiero cotizar", "¿Hacen envíos?"]
