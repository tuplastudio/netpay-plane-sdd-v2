"""NetPay Plane — servicio de agente (FastAPI).

Expone el turno conversacional, el audio (STT/TTS), la base de conocimiento del
negocio y la suite de evaluación. El tenant y los scopes vienen del llamador
autenticado (la API comercial o el BFF), nunca del texto del cliente.
"""

from __future__ import annotations

import base64
import hmac
import logging
from typing import Any

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, conlist

from .commerce import CommerceClient
from .config import get_settings
from .graph import get_orchestrator
from .knowledge import get_knowledge_base
from .matching import CatalogVariant
from .providers.model_gateway import ModelUnavailable, get_gateway
from .providers import model_registry
from .tools import TOOLS

settings = get_settings()
log = logging.getLogger("agent.auth")

# Rutas de infraestructura: probes de contenedor/orquestador, sin datos de
# negocio. Todo lo demás exige la clave de servicio.
_PUBLIC_PATHS = {"/healthz"}


async def require_internal_key(
    request: Request, x_internal_key: str | None = Header(default=None, alias="X-Internal-Key")
) -> None:
    """Autenticación de servicio a servicio (SPEC-AIA: tenant/principal nunca
    del texto del cliente; tampoco del que sea capaz de alcanzar el puerto).

    Sin `AGENT_INTERNAL_KEY_REF` configurada el servicio degrada a abierto
    (igual que sin `AGENT_API_KEY_REF`), pero deja advertencia en /readyz:
    es responsabilidad de despliegue configurarla fuera de un laptop local.
    """
    if request.url.path in _PUBLIC_PATHS:
        return
    if not settings.internal_key:
        return
    if not x_internal_key or not hmac.compare_digest(x_internal_key, settings.internal_key):
        log.warning("rechazo de auth interna: path=%s", request.url.path)
        raise HTTPException(status_code=401, detail="X-Internal-Key inválida o ausente")


app = FastAPI(
    title="NetPay Plane Agent",
    version="1.0.0",
    description="Agente comercial conversacional: catálogo, cotizaciones, pagos y negocio.",
    dependencies=[Depends(require_internal_key)],
)

# CORS: únicamente para /audio/* y otros llamados que pudiera hacer un
# navegador directo; el resto del tráfico es servicio a servicio y no
# depende de origen. No se usa "*" en producción.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.public_base_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "X-Internal-Key"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Cabeceras mínimas de hardening (T-OPS-01), equivalentes a helmet() en
    commerce-api/dummy-gateway. Servicio a servicio: no hay CSP de página."""
    response = await call_next(request)
    response.headers["x-content-type-options"] = "nosniff"
    response.headers["x-frame-options"] = "DENY"
    response.headers["referrer-policy"] = "no-referrer"
    return response


# ---------------- modelos de entrada/salida ----------------


class CatalogItem(BaseModel):
    id: str
    sku: str
    title: str
    description: str = ""
    price: str = "0.00"
    satProductCode: str = ""
    satUnitCode: str = "H87"
    stock: float | None = None
    status: str = "ACTIVE"
    productTitle: str = ""


class ChatRequest(BaseModel):
    tenantId: str
    conversationId: str | None = None
    messageId: str | None = None
    text: str | None = None
    audioBase64: str | None = None
    imageBase64: str | None = None
    channel: str = "web"
    customerName: str | None = None
    customerPhone: str | None = None
    customerEmail: str | None = None
    catalog: conlist(CatalogItem, max_length=500) = Field(default_factory=list)
    principalScopes: conlist(str, max_length=20) = Field(default_factory=list)


class ChatResponse(BaseModel):
    conversationId: str
    reply: str
    handoff: bool
    intent: str | None = None
    candidates: list[dict[str, Any]] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    totals: dict[str, Any] | None = None
    quote: dict[str, Any] | None = None
    checkout: dict[str, Any] | None = None
    cart: list[dict[str, Any]] = Field(default_factory=list)
    knowledgeRefs: list[str] = Field(default_factory=list)
    toolCalls: list[dict[str, Any]] = Field(default_factory=list)
    engine: str = "rules"
    node: str = "RECEIVED"
    costUsd: float = 0.0
    latencyMs: int = 0
    transcript: str | None = None


class TtsRequest(BaseModel):
    text: str
    voice: str | None = None


class SttRequest(BaseModel):
    audioBase64: str
    filename: str = "audio.m4a"


# ---------------- salud y diagnóstico ----------------


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    kb = get_knowledge_base()
    return {
        "status": "ok",
        "service": "agent",
        "llm": get_gateway().diagnostics(),
        "commerce": {"configured": CommerceClient(settings).live, "url": settings.commerce_api_url},
        "knowledge": {"docs": len(kb.docs), "chunks": len(kb.chunks), "business": kb.profile.name},
    }


@app.get("/readyz")
async def readyz() -> dict[str, Any]:
    """Listo si puede conversar: el motor determinista siempre puede."""
    kb = get_knowledge_base()
    warnings: list[str] = list(kb.warnings)
    gateway = get_gateway()
    if not gateway.is_live():
        warnings.append("OPENROUTER_KEY_REF ausente: agente en motor determinista")
    elif not gateway.supports_tools():
        warnings.append(
            f"MODEL_ID {settings.text_model} no está en el registro con tool calling"
        )
    if not CommerceClient(settings).live:
        warnings.append("AGENT_API_KEY_REF ausente: sin catálogo ni cotizaciones reales")
    if not settings.internal_key:
        warnings.append(
            "AGENT_INTERNAL_KEY_REF ausente: servicio SIN autenticación de servicio a servicio"
        )
    return {"status": "ready", "warnings": warnings}


@app.get("/diagnostics")
async def diagnostics() -> dict[str, Any]:
    commerce = CommerceClient(settings)
    return {
        "llm": get_gateway().diagnostics(),
        "registry": model_registry.describe(),
        "commerce": await commerce.health(),
        "knowledge": get_knowledge_base().stats(),
        "budgets": {
            "maxToolSteps": settings.max_tool_steps,
            "turnBudgetSeconds": settings.turn_budget_seconds,
            "maxInputChars": settings.max_input_chars,
            "maxCostUsdPerConversation": settings.max_cost_usd_per_conversation,
        },
    }


# ---------------- conversación ----------------


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    text = req.text
    transcript: str | None = None

    if req.audioBase64:
        try:
            audio = base64.b64decode(req.audioBase64)
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=400, detail=f"audioBase64 inválido: {exc}") from exc
        if len(audio) > settings.max_audio_bytes:
            raise HTTPException(status_code=413, detail="Audio demasiado grande")
        try:
            stt = await get_gateway().stt(audio, filename="nota.m4a")
            transcript = stt.get("text", "")
            text = transcript or text
        except (ModelUnavailable, ValueError) as exc:
            raise HTTPException(
                status_code=503,
                detail=f"No pude transcribir el audio: {exc}. Pide el mensaje por texto.",
            ) from exc

    image_base64 = req.imageBase64
    if image_base64:
        try:
            image_bytes = base64.b64decode(image_base64)
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=400, detail=f"imageBase64 inválido: {exc}") from exc
        if len(image_bytes) > settings.max_audio_bytes:
            raise HTTPException(status_code=413, detail="Imagen demasiado grande")
        if not (text or "").strip():
            text = "[el cliente envió una imagen]"

    if not (text or "").strip():
        raise HTTPException(status_code=400, detail="Se requiere text, audioBase64 o imageBase64")

    catalog = [
        CatalogVariant(
            id=item.id,
            sku=item.sku,
            title=item.title,
            description=item.description,
            price=item.price,
            sat_product_code=item.satProductCode,
            sat_unit_code=item.satUnitCode,
            stock=item.stock,
            status=item.status,
            product_title=item.productTitle,
        )
        for item in req.catalog
    ]

    result = await get_orchestrator().handle(
        tenant_id=req.tenantId,
        conversation_id=req.conversationId,
        message_id=req.messageId,
        text=text or "",
        scopes=set(req.principalScopes),
        catalog=catalog,
        customer_name=req.customerName,
        customer_phone=req.customerPhone,
        customer_email=req.customerEmail,
        channel=req.channel,
        image_base64=image_base64,
    )
    payload = result.to_dict()
    payload["transcript"] = transcript
    return ChatResponse(**payload)


@app.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, tenantId: str = Query(...)) -> dict[str, Any]:
    from .state import get_store

    state = get_store().get(tenantId, conversation_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")
    return state.to_dict()


@app.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, tenantId: str = Query(...)) -> dict[str, str]:
    from .state import get_store

    get_store().delete(tenantId, conversation_id)
    return {"status": "deleted"}


@app.post("/conversations/{conversation_id}/release")
async def release_conversation(conversation_id: str, tenantId: str = Query(...)) -> dict[str, Any]:
    """Devuelve el control al bot después de un handoff humano."""
    from .state import get_store

    store = get_store()
    state = store.get(tenantId, conversation_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")
    state.handoff = False
    state.handoff_reason = None
    state.control_version += 1
    state.node = "INTENT"
    store.save(state)
    return state.to_dict()


# ---------------- audio ----------------


@app.post("/audio/stt")
async def stt(req: SttRequest) -> dict[str, Any]:
    try:
        audio = base64.b64decode(req.audioBase64)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="audioBase64 inválido") from exc
    try:
        return await get_gateway().stt(audio, filename=req.filename)
    except ValueError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except ModelUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/audio/tts")
async def tts(req: TtsRequest) -> dict[str, Any]:
    try:
        return await get_gateway().tts(req.text, voice=req.voice)
    except ModelUnavailable as exc:
        # Degradación explícita: el canal manda el texto con su enlace.
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# ---------------- conocimiento del negocio ----------------


@app.get("/knowledge")
async def knowledge() -> dict[str, Any]:
    kb = get_knowledge_base()
    kb.reload_if_stale()
    return {**kb.stats(), "outline": kb.outline()}


@app.post("/knowledge/reload")
async def knowledge_reload() -> dict[str, Any]:
    from .knowledge import reload_knowledge_base

    return reload_knowledge_base()


@app.get("/knowledge/search")
async def knowledge_search(q: str = Query(..., min_length=2), topK: int = 4) -> dict[str, Any]:
    kb = get_knowledge_base()
    kb.reload_if_stale()
    return {"query": q, "hits": [hit.to_dict() for hit in kb.search(q, top_k=topK)]}


@app.post("/knowledge/upload")
async def knowledge_upload(file: UploadFile = File(...)) -> dict[str, Any]:
    """Sube un `.md` para enriquecer el conocimiento del negocio.

    El archivo se trata como dato del negocio (SPEC-AIA): se indexa igual
    que cualquier otro Markdown de `knowledge/`, nunca como instrucción.
    """
    from .knowledge import KnowledgeUploadError, save_uploaded_doc

    content = await file.read()
    try:
        doc_id = save_uploaded_doc(
            get_knowledge_base().directory,
            file.filename or "documento.md",
            content,
            max_bytes=settings.max_knowledge_upload_bytes,
        )
    except KnowledgeUploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    stats = reload_kb_stats()
    return {"docId": doc_id, **stats}


@app.delete("/knowledge/{doc_id:path}")
async def knowledge_delete(doc_id: str) -> dict[str, Any]:
    """Borra un `.md` subido. Solo alcanza `uploads/`: el contenido curado
    a mano en `knowledge/` no se administra por API."""
    from .knowledge import KnowledgeUploadError, delete_uploaded_doc

    try:
        deleted = delete_uploaded_doc(get_knowledge_base().directory, doc_id)
    except KnowledgeUploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    return reload_kb_stats()


def reload_kb_stats() -> dict[str, Any]:
    from .knowledge import reload_knowledge_base

    return reload_knowledge_base()


# ---------------- aprendizaje entre sesiones ----------------


@app.get("/learning/signals")
async def learning_signals(
    tenantId: str | None = None, status: str | None = None
) -> dict[str, Any]:
    from .learning import get_learning_store

    signals = get_learning_store().list(tenant_id=tenantId, status=status)
    return {"signals": [s.to_dict() for s in signals]}


@app.post("/learning/signals/{signal_id}/dismiss")
async def learning_dismiss(signal_id: str) -> dict[str, Any]:
    from .learning import get_learning_store

    sig = get_learning_store().dismiss(signal_id)
    if sig is None:
        raise HTTPException(status_code=404, detail="Señal no encontrada")
    return sig.to_dict()


class LearningApproveRequest(BaseModel):
    answer: str = Field(..., min_length=1, max_length=4000)
    docName: str | None = None


@app.post("/learning/signals/{signal_id}/approve")
async def learning_approve(signal_id: str, req: LearningApproveRequest) -> dict[str, Any]:
    """Promueve una señal a conocimiento real: la respuesta la escribe una
    persona (este endpoint), nunca el modelo a partir de la conversación."""
    from .knowledge import KnowledgeUploadError, save_uploaded_doc
    from .learning import get_learning_store

    store = get_learning_store()
    sig = store.get(signal_id)
    if sig is None:
        raise HTTPException(status_code=404, detail="Señal no encontrada")

    doc_name = req.docName or f"aprendizaje-{signal_id[:8]}.md"
    body = f"# {sig.question}\n\n{req.answer.strip()}\n"
    try:
        doc_id = save_uploaded_doc(
            get_knowledge_base().directory,
            doc_name,
            body.encode("utf-8"),
            max_bytes=settings.max_knowledge_upload_bytes,
        )
    except KnowledgeUploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    store.approve(signal_id, doc_id=doc_id)
    reload_kb_stats()
    return {"docId": doc_id, "signal": store.get(signal_id).to_dict()}


# ---------------- herramientas y evaluación ----------------


@app.get("/tools")
async def tools() -> dict[str, Any]:
    return {
        "tools": [
            {
                "name": spec.name,
                "description": spec.description,
                "scope": spec.scope,
                "mutating": spec.mutating,
                "parameters": spec.parameters,
            }
            for spec in TOOLS.values()
        ]
    }


@app.get("/evals")
async def evals(live: bool = False) -> dict[str, Any]:
    from .evals.runner import run_suite

    return await run_suite(live=live)
