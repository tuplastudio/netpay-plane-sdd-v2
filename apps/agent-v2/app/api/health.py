"""Salud, diagnóstico, métricas y catálogo de herramientas."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..agent import model_capabilities
from ..agent_settings import get_agent_settings
from ..commerce import CommerceClient
from ..knowledge import DEFAULT_TENANT_ID, load_knowledge
from ..prompts import get_prompt_registry
from ..runtime import runtime
from ..security import TOOL_SCOPES
from ..tools import SALES_TOOLS

router = APIRouter(tags=["salud"])

VERSION = "2.3.0"


@router.get("/healthz")
async def healthz() -> dict[str, Any]:
    # Probe de liveness: si el arranque falló o ya se hizo shutdown, el
    # servicio debe reportarse mal para que el orquestador lo reinicie.
    if runtime.agent is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")
    return {"status": "ok", "version": VERSION}


def _resolve_tenant(tenantId: str | None) -> str | None:
    """Si llega `?tenantId=` lo usa; si no, devuelve None para que la
    respuesta represente estado GLOBAL (útil para super-admin sin tenant
    resuelto). El panel siempre manda su tenantId."""
    if not tenantId:
        return None
    return tenantId.strip() or None


@router.get("/readyz")
async def readyz(tenantId: str | None = Query(default=None)) -> dict[str, Any]:
    settings = runtime.settings
    commerce = await CommerceClient().health()
    # El LLM está "live" si HAY alguna key usable: la global del proceso,
    # o la del tenant que llamó. Sin tenantId y sin global: nada arranca.
    tenant_key = ""
    if tenantId:
        tenant_key = get_agent_settings(tenantId).openrouter_api_key()
    effective_llm_live = bool(settings.openrouter_key or tenant_key)
    return {
        "ready": bool(effective_llm_live and commerce.get("ok")),
        "llm": {
            "live": effective_llm_live,
            "model": settings.model,
            "source": "global" if settings.openrouter_key and not tenant_key
                      else "tenant" if tenant_key
                      else "none",
        },
        "commerce": commerce,
        "checkpointer": str(settings.checkpoint_path),
        "warnings": [
            w
            for w in (
                None if effective_llm_live else (
                    "OPENROUTER_KEY_REF no configurada y este tenant no tiene "
                    "OpenRouter API key propia (configúrala en /agent → General → Modelo)"
                ),
                None if settings.commerce_live else "AGENT_INTERNAL_KEY_REF o AGENT_API_KEY_REF no configurada",
                None if settings.internal_key else "AGENT_INTERNAL_KEY_REF no configurada",
            )
            if w
        ],
    }


@router.get("/diagnostics")
async def diagnostics(tenantId: str | None = Query(default=None)) -> dict[str, Any]:
    """Estado del agente.

    Tenant-aware: con `?tenantId=X` reporta el estado EFECTIVO para ese
    tenant (modelo + key override si lo configuró en el panel). Sin
    `tenantId`, devuelve el estado global del proceso (útil para super-admin).

    Sin key global y sin key de tenant, `llm.live` es false aunque el
    contenedor esté vivo: la API de OpenRouter rechazaría las llamadas.
    El panel usa esto para mostrar "Motor determinista (sin LLM)" en la
    franja superior — antes siempre decía eso incluso para tenants que ya
    habían configurado su key, porque `settings.llm_live` solo veía el
    proceso. Por tenant, ya no es engañoso.
    """
    settings = runtime.settings
    tenant_id = _resolve_tenant(tenantId)

    effective_model = settings.model
    tenant_key = ""
    if tenant_id:
        overrides = get_agent_settings(tenant_id)
        effective_model = overrides.effective_model(settings.model)
        tenant_key = overrides.openrouter_api_key()
    effective_llm_live = bool(settings.openrouter_key or tenant_key)
    key_source = (
        "tenant" if tenant_key
        else "global" if settings.openrouter_key
        else "none"
    )

    return {
        "engine": "langgraph+deepagents",
        "version": VERSION,
        "model": effective_model,
        "modelCapabilities": model_capabilities(effective_model),
        "tools": [t.name for t in SALES_TOOLS],
        "knowledgeChars": len(load_knowledge(tenant_id or DEFAULT_TENANT_ID)),
        "llm": {
            "live": effective_llm_live,
            "keySource": key_source,
            "tenantKeySet": bool(tenant_key),
            "globalKeySet": bool(settings.openrouter_key),
        },
        "budgets": {
            "recursionLimit": settings.recursion_limit,
            "turnTimeoutSeconds": settings.turn_timeout_seconds,
            "turnTimeoutImageSeconds": settings.turn_timeout_image_seconds,
            "turnTimeoutVideoSeconds": settings.turn_timeout_video_seconds,
            "maxImageBytes": settings.max_image_bytes,
            "maxVideoBytes": settings.max_video_bytes,
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
        "coalesce": {
            "windowMs": settings.coalesce_window_ms,
            "channels": list(settings.coalesce_channels),
        },
        "failurePolicy": {
            "retryTransient": settings.retry_transient_failures,
            "handoffAfterFailures": settings.handoff_after_failures,
        },
        "episodicMemory": {
            "enabled": settings.episodic_memory_enabled,
            "lessonsInPrompt": settings.episodic_lessons_in_prompt,
        },
    }


@router.get("/metrics")
async def metrics() -> dict[str, Any]:
    """Contadores y latencias del proceso (ver `pipeline/trace.py`)."""
    return {"version": VERSION, **runtime.metrics.snapshot()}


@router.get("/tools")
async def list_tools() -> dict[str, Any]:
    """El panel lista qué puede ejecutar el agente y con qué permiso."""
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


@router.get("/evals")
async def evals(
    judge: bool = False,
    category: list[str] | None = Query(default=None),
    limit: int | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Suite de evaluación del agente.

    `dry_run` viene en True a propósito: cada caso real gasta llamadas al
    modelo (dinero), y un GET casual desde el panel no debe cobrarlas.
    """
    from ..evals.runner import run_suite

    return await run_suite(categories=category, judge=judge, limit=limit, dry_run=dry_run)
