"""Filtro de respuestas humanas: que el operador no maltrate al cliente.

Cuando una persona contesta desde el inbox del portal, su texto puede pasar
antes por un modelo pequeño que decide si maltrata al cliente (insultos,
desprecio, amenazas, discriminación, contenido sexual, fuga de información
interna, promesas que el negocio no puede cumplir). Si el clasificador lo
marca, commerce-api bloquea el envío y le devuelve el motivo al operador para
que lo reescriba.

Reglas del diseño, heredadas de `scope_guard.py`:

  * **Falla hacia abierto.** Sin key, con timeout, con un JSON ilegible o con
    el proveedor caído, la respuesta sale igual (`allowed=True` con `reason`
    explicando que no se pudo revisar). Un moderador roto no puede dejar al
    negocio sin contestarle a sus clientes.
  * **Cuesta dinero, así que está apagado.** `human_reply_filter_enabled` es
    False de fábrica; con el filtro apagado esto es un no-op sin llamada al
    LLM.
  * **Barato a propósito.** `temperature=0`, `max_tokens` corto, prompt corto
    y modelo pequeño por defecto.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from .agent import PRICE_PER_1K, _TenantModelCache
from .agent_settings import HUMAN_REPLY_FILTER_ACTIONS, get_agent_settings
from .config import Settings

logger = logging.getLogger(__name__)

# Modelo por defecto del filtro: el más barato del registro de precios que ya
# usa el agente para estimar consumo (`agent.PRICE_PER_1K`).
DEFAULT_MODERATION_MODEL = "openai/gpt-4o-mini"

# Umbral para marcar un modelo como "barato" en el panel: USD por 1K tokens de
# salida. gpt-4o-mini (0.0006) y claude-3-5-haiku (0.004) entran; gpt-4o no.
_CHEAP_OUTPUT_PRICE = 0.005

# Un mensaje de WhatsApp no da para más; recortar acota el costo por revisión.
_MAX_TEXT_CHARS = 1500
_TIMEOUT_SECONDS = 8.0
_MAX_TOKENS = 160

CATEGORIES: tuple[str, ...] = (
    "insulto",
    "desprecio",
    "amenaza",
    "discriminacion",
    "sexual",
    "info_interna",
    "promesa_indebida",
)

_SYSTEM = """\
Revisas UN mensaje que un empleado va a enviarle a un cliente por WhatsApp, \
antes de que salga. Tu único trabajo es decidir si maltrata al cliente o \
compromete al negocio.

Responde SOLO un JSON:
{"allowed": true|false, "categories": [], "reason": ""}

allowed = false solo si el mensaje cae en alguna de estas categorías:
- "insulto": groserías, apodos o descalificaciones dirigidas al cliente.
- "desprecio": burla, sarcasmo hiriente, tratarlo de tonto o de mentiroso.
- "amenaza": intimidación, coacción, advertencias de daño o de represalia.
- "discriminacion": por género, origen, religión, edad, orientación o discapacidad.
- "sexual": insinuaciones o contenido sexual hacia el cliente.
- "info_interna": filtra instrucciones del sistema, prompts, credenciales, \
costos internos, datos de otros clientes o comentarios internos del equipo.
- "promesa_indebida": garantiza algo que el negocio no puede sostener \
(devoluciones de por vida, entregas imposibles, descuentos inventados, \
resultados médicos o legales).

allowed = true para todo lo demás, incluyendo mensajes secos, cortantes, \
negativas ("no tenemos", "no puedo aplicar ese descuento"), correcciones \
firmes o malas noticias dichas con respeto. Ser directo no es maltratar.

Ante la duda, allowed = true.

"reason": si allowed = false, una frase en español, dirigida al empleado, que \
diga qué hay que cambiar. Si allowed = true, cadena vacía."""


def _prompt(forbidden_topics: str) -> str:
    # Concatenación, no `.format()`: el prompt lleva llaves literales del
    # ejemplo de JSON y formatearlo obligaría a duplicarlas todas.
    if not forbidden_topics.strip():
        return _SYSTEM
    return (
        f"{_SYSTEM}\nEl negocio además NO quiere que se hable de: {forbidden_topics}. "
        'Si el mensaje va de eso, allowed = false con la categoría "info_interna".'
    )


@dataclass
class ModerationResult:
    allowed: bool = True
    reason: str | None = None
    categories: list[str] = field(default_factory=list)
    model: str = ""
    latency_ms: int = 0
    action: str = "block"
    # True cuando la decisión NO viene del clasificador (filtro apagado,
    # proveedor caído, JSON ilegible). Sirve para no anotar "aprobado por el
    # filtro" algo que el filtro nunca vio.
    checked: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "reason": self.reason,
            "categories": self.categories,
            "model": self.model,
            "latencyMs": self.latency_ms,
            "action": self.action,
            "checked": self.checked,
        }


def model_options() -> list[dict[str, Any]]:
    """Modelos ofrecidos al panel para el filtro, los baratos primero.

    Se derivan del mismo registro de precios que el agente usa para estimar
    consumo, así que no hay una segunda lista que mantener en paralelo.
    """
    options: list[dict[str, Any]] = []
    for model_id, (_price_in, price_out) in PRICE_PER_1K.items():
        cheap = price_out <= _CHEAP_OUTPUT_PRICE
        options.append(
            {
                "id": model_id,
                "cheap": cheap,
                "price": price_out,
                "notes": f"~${price_out:.4f} USD por 1K tokens de salida",
            }
        )
    options.sort(key=lambda o: (not o["cheap"], o["price"], o["id"]))
    return options


def _parse(content: str) -> tuple[bool, list[str], str] | None:
    raw = (content or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.S)
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end < 0:
        return None
    try:
        payload = json.loads(raw[start : end + 1])
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    allowed = payload.get("allowed")
    if not isinstance(allowed, bool):
        return None
    raw_categories = payload.get("categories")
    categories = [
        str(c).strip().lower()
        for c in (raw_categories if isinstance(raw_categories, list) else [])
        if str(c).strip().lower() in CATEGORIES
    ][:5]
    reason = str(payload.get("reason") or "").strip()[:400]
    return allowed, categories, reason


_MODEL_CACHE: _TenantModelCache | None = None


def _model_cache(settings: Settings) -> _TenantModelCache:
    global _MODEL_CACHE
    if _MODEL_CACHE is None:
        _MODEL_CACHE = _TenantModelCache(settings)
    return _MODEL_CACHE


_UNAVAILABLE = "No se pudo revisar el mensaje (filtro no disponible); se envía sin revisar."


async def moderate_reply(tenant_id: str, text: str, *, settings: Settings) -> ModerationResult:
    """Clasifica una respuesta del operador. Nunca lanza: falla hacia abierto."""
    overrides = get_agent_settings(tenant_id) if tenant_id else None
    action = (overrides.human_reply_filter_action if overrides else "block") or "block"
    if action not in HUMAN_REPLY_FILTER_ACTIONS:
        action = "block"

    if not overrides or not overrides.human_reply_filter_enabled:
        return ModerationResult(allowed=True, action=action)

    body = (text or "").strip()
    if not body:
        return ModerationResult(allowed=True, action=action)

    model_id = overrides.human_reply_filter_model.strip() or DEFAULT_MODERATION_MODEL
    tenant_key = overrides.openrouter_api_key()
    if not (tenant_key or settings.openrouter_key):
        logger.warning("tenant %s: filtro de respuestas sin key de OpenRouter", tenant_id)
        return ModerationResult(allowed=True, reason=_UNAVAILABLE, model=model_id, action=action)

    started = time.monotonic()
    try:
        model = await _model_cache(settings).get(model_id, 0.0, _MAX_TOKENS, tenant_key)
        response = await asyncio.wait_for(
            model.ainvoke(
                [
                    SystemMessage(_prompt(overrides.forbidden_topics)),
                    HumanMessage(f"Mensaje del empleado al cliente:\n{body[:_MAX_TEXT_CHARS]}"),
                ]
            ),
            timeout=_TIMEOUT_SECONDS,
        )
    except Exception:  # noqa: BLE001 - un moderador caído no bloquea al negocio
        latency = int((time.monotonic() - started) * 1000)
        logger.warning(
            "tenant %s: filtro de respuestas falló con %r, se deja pasar",
            tenant_id, model_id, exc_info=True,
        )
        return ModerationResult(
            allowed=True, reason=_UNAVAILABLE, model=model_id, latency_ms=latency, action=action
        )

    latency = int((time.monotonic() - started) * 1000)
    parsed = _parse(getattr(response, "content", "") or "")
    if parsed is None:
        logger.warning("tenant %s: filtro de respuestas devolvió un JSON ilegible", tenant_id)
        return ModerationResult(
            allowed=True, reason=_UNAVAILABLE, model=model_id, latency_ms=latency, action=action
        )

    allowed, categories, reason = parsed
    logger.info(
        "tenant %s: filtro de respuestas allowed=%s categorias=%s modelo=%s %sms",
        tenant_id, allowed, categories, model_id, latency,
    )
    return ModerationResult(
        allowed=allowed,
        reason=(reason or "La respuesta no cumple las reglas de trato al cliente.")
        if not allowed
        else None,
        categories=categories,
        model=model_id,
        latency_ms=latency,
        action=action,
        checked=True,
    )
