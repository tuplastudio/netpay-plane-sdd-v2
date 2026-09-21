"""Salud, diagnóstico, métricas y catálogo de herramientas."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..commerce import CommerceClient
from ..knowledge import DEFAULT_TENANT_ID, load_knowledge
from ..prompts import get_prompt_registry
from ..runtime import runtime
from ..security import TOOL_SCOPES
from ..tools import SALES_TOOLS

router = APIRouter(tags=["salud"])

VERSION = "2.2.0"


@router.get("/healthz")
async def healthz() -> dict[str, Any]:
    # Probe de liveness: si el arranque falló o ya se hizo shutdown, el
    # servicio debe reportarse mal para que el orquestador lo reinicie.
    if runtime.agent is None:
        raise HTTPException(status_code=503, detail="El agente todavía no está listo")
    return {"status": "ok", "version": VERSION}


@router.get("/readyz")
async def readyz() -> dict[str, Any]:
    settings = runtime.settings
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
                None if settings.commerce_live else "AGENT_INTERNAL_KEY_REF o AGENT_API_KEY_REF no configurada",
                None if settings.internal_key else "AGENT_INTERNAL_KEY_REF no configurada",
            )
            if w
        ],
    }


@router.get("/diagnostics")
async def diagnostics() -> dict[str, Any]:
    settings = runtime.settings
    return {
        "engine": "langgraph+deepagents",
        "version": VERSION,
        "model": settings.model,
        "tools": [t.name for t in SALES_TOOLS],
        "knowledgeChars": len(load_knowledge(DEFAULT_TENANT_ID)),
        "budgets": {
            "recursionLimit": settings.recursion_limit,
            "turnTimeoutSeconds": settings.turn_timeout_seconds,
            "turnTimeoutImageSeconds": settings.turn_timeout_image_seconds,
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
