"""Configuración por tenant desde el panel y filtro de respuestas humanas."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from ..agent_settings import DELIVERY_MODES, HUMAN_REPLY_FILTER_ACTIONS, SALES_STYLES, get_settings_store
from ..knowledge import load_profile
from ..moderation import DEFAULT_MODERATION_MODEL, model_options as moderation_model_options, moderate_reply
from ..prompts import get_prompt_registry
from ..runtime import runtime
from ..tenant_context import load_company_context

router = APIRouter(tags=["ajustes"])


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
    openrouter_api_key: str | None = None
    prompt_version: str | None = None
    whatsapp_plain_text: bool | None = None
    auto_reply: bool | None = None
    human_reply_filter_enabled: bool | None = None
    human_reply_filter_model: str | None = None
    human_reply_filter_action: str | None = None
    auto_close_enabled: bool | None = None
    # "" es un valor con significado (quitar el plazo), igual que la key.
    auto_close_after: str | None = None


async def settings_view(tenant_id: str) -> dict[str, Any]:
    settings = runtime.settings
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
            "human_reply_filter_model": moderation_model_options(),
            "human_reply_filter_action": list(HUMAN_REPLY_FILTER_ACTIONS),
        },
    }


@router.get("/settings")
async def get_settings_endpoint(tenantId: str = Query(...)) -> dict[str, Any]:
    return await settings_view(tenantId)


@router.put("/settings")
async def put_settings(req: AgentSettingsPayload, tenantId: str = Query(...)) -> dict[str, Any]:
    get_settings_store().update(tenantId, {k: v for k, v in req.model_dump().items() if v is not None})
    return await settings_view(tenantId)


@router.delete("/settings")
async def reset_settings(tenantId: str = Query(...)) -> dict[str, Any]:
    get_settings_store().reset(tenantId)
    return await settings_view(tenantId)


class ModerationRequest(BaseModel):
    tenantId: str
    text: str = ""


@router.post("/moderation/reply")
async def moderate_human_reply(req: ModerationRequest) -> dict[str, Any]:
    """Revisa una respuesta que un operador va a mandarle al cliente.

    No-op (`allowed: true`) si el tenant tiene el filtro apagado, y siempre
    hacia abierto ante cualquier falla. Ver `moderation.py`.
    """
    result = await moderate_reply(req.tenantId, req.text, settings=runtime.settings)
    return result.to_dict()
