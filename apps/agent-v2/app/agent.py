"""Construcción del agente v2 (LangGraph + deepagents).

Un solo grafo compilado sirve a todos los tenants: lo que cambia por negocio
(identidad, catálogo, conocimiento, versión de prompt, modelo) se resuelve
por turno en ``tenant_context.py`` y entra por ``sales_prompt`` y por el
middleware de modelo. Ver docs/ARCHITECTURE.md.

Qué resuelve frente al v1:

  * El hilo no se pierde. LangGraph guarda un checkpoint por conversación
    (`thread_id`), así que el estado completo — carrito, cliente, cotización,
    pedido, plan — se recupera tal cual en el siguiente turno, aunque el
    proceso se reinicie.
  * El resumen lo hace un modelo cuando el historial crece, en vez de recortar
    mensajes a ciegas; y los hechos comerciales viven en campos del estado, no
    en el historial, así que sobreviven al resumen.
  * `write_todos` de deepagents da un plan explícito para pedidos de varios
    pasos, que es lo que evitaba que repitiera búsquedas y cálculos.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from deepagents import create_deep_agent
from langchain.agents.middleware import (
    SummarizationMiddleware,
    dynamic_prompt,
    wrap_model_call,
)
from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.errors import GraphBubbleUp

from .agent_settings import get_agent_settings
from .config import Settings, get_settings
from .prompts import assemble_prompt
from .state import SalesState, TurnContext, working_memory_block
from .tenant_context import load_company_context, resolve_tenant_bundle, warm_catalog
from .tools import SALES_TOOLS

__all__ = [
    "PRICE_PER_1K",
    "build_agent",
    "build_model",
    "build_scope_model",
    "load_company_context",
    "sales_prompt",
    "warm_catalog",
]

logger = logging.getLogger(__name__)


def build_model(
    settings: Settings,
    *,
    model: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    api_key: str | None = None,
) -> ChatOpenAI:
    """OpenRouter habla el protocolo de OpenAI: mismo cliente, otra base_url.

    `api_key`: si el tenant configuró su propia key de OpenRouter (panel
    `/agent`, guardada cifrada en `AgentSettings`), se usa esa en vez de la
    global del proceso — así cada tenant paga y factura su propio consumo.
    """
    model_id = model or settings.model
    extra: dict[str, Any] = {}
    # Serializar las tool calls evita que varias lean el mismo snapshot del
    # estado en un turno (el orden importa, p. ej. cotizar después de agregar).
    # La corrección de fondo del carrito vive en el reducer `_merge_carts`,
    # así que esto es defensa en profundidad, no el único arreglo.
    # OpenRouter rechaza el parámetro para la familia Anthropic
    # ("tool_choice.auto.disable_parallel_tool_use: Extra inputs are not
    # permitted"), y mandarlo haría fallar cada turno de un tenant que elija
    # claude, degradando siempre al modelo por defecto.
    if not model_id.startswith("anthropic/"):
        extra["parallel_tool_calls"] = False
    return ChatOpenAI(
        model=model_id,
        api_key=api_key or settings.openrouter_key,
        base_url=settings.openrouter_base_url,
        temperature=settings.temperature if temperature is None else temperature,
        max_completion_tokens=settings.max_tokens if max_tokens is None else max_tokens,
        default_headers={
            "HTTP-Referer": settings.public_base_url,
            "X-Title": "Easy Sell Agent v2 (Tupla)",
        },
        **extra,
    )


def build_scope_model(settings: Settings) -> ChatOpenAI:
    """Modelo del guardarraíl de tema: temperatura 0 y respuesta cortísima.

    Va aparte del modelo conversacional porque solo emite un JSON de una
    clave: pagar el `max_tokens` del agente por eso sería tirar dinero.
    """
    return build_model(
        settings,
        model=settings.scope_guard_model or settings.model,
        temperature=0.0,
        max_tokens=16,
    )


class _TenantModelCache:
    """Un `ChatOpenAI` por combinación (modelo, temperatura, max_tokens).

    El grafo se compila una sola vez y se reutiliza entre tenants (ver
    `build_agent`), así que no podemos guardar "el modelo del tenant" en el
    modelo del grafo. Lo que sí podemos cachear es el cliente HTTP de cada
    combinación de parámetros: dos tenants con el mismo override comparten
    instancia, y un mismo tenant no reconstruye su `ChatOpenAI` en cada turno.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._entries: dict[tuple[str, float, int, str], ChatOpenAI] = {}
        self._lock = asyncio.Lock()

    async def get(
        self, model: str, temperature: float, max_tokens: int, api_key: str = ""
    ) -> ChatOpenAI:
        key = (model, temperature, max_tokens, api_key)
        cached = self._entries.get(key)
        if cached is not None:
            return cached
        async with self._lock:
            cached = self._entries.get(key)
            if cached is not None:
                return cached
            instance = build_model(
                self._settings,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                api_key=api_key or None,
            )
            self._entries[key] = instance
            return instance


# Precio aproximado en USD por 1K tokens (input, output). Referencia pública
# de OpenRouter al momento de escribir esto — no se actualiza solo, así que
# el costo reportado es una ESTIMACIÓN, no una factura real de OpenRouter.
# Fallback conservador para modelos fuera de esta lista.
#
# Capacidades por modelo (referencia rápida para el panel / `GET /tools`):
#   - multimodal: acepta image_url y video (data:video/* o URL) en el turno.
#   - audio: notas de voz se transcriben aparte (Whisper); el modelo no las
#     procesa directamente, pero Gemini 2.0 Flash sí lo hace si se lo mandan
#     como bloque `input_audio`.
PRICE_PER_1K: dict[str, tuple[float, float]] = {
    "openai/gpt-4o-mini": (0.00015, 0.0006),  # image: sí, video: NO
    "openai/gpt-4o": (0.0025, 0.01),  # image: sí, video: NO
    "anthropic/claude-3-5-sonnet": (0.003, 0.015),  # image: sí, video: NO
    "anthropic/claude-3-5-haiku": (0.0008, 0.004),  # image: sí, video: NO
    "google/gemini-2.0-flash-001": (0.0001, 0.0004),  # image+video+audio: sí
    "google/gemini-2.0-flash-thinking-exp": (0.0, 0.0),  # experimental; precio incierto
    "google/gemini-1.5-pro": (0.00125, 0.005),  # image+video+audio: sí
    "google/gemini-2.5-pro": (0.00125, 0.01),  # image+video+audio: sí
}
_DEFAULT_PRICE_PER_1K = (0.001, 0.003)


def model_capabilities(model: str) -> dict[str, bool]:
    """Qué modalidades soporta un modelo OpenRouter.

    Devuelve siempre las cuatro llaves para que el panel / endpoint pueda
    iterar sin chequear KeyError. `multimodal` = True si soporta AL MENOS
    imágenes (que es lo mínimo para `imageBase64`); `video` y `audio`
    granularizan para que el front pueda filtrar.
    """
    mid = (model or "").strip().lower()
    if mid.startswith("google/gemini"):
        return {"text": True, "multimodal": True, "video": True, "audio": True}
    if mid.startswith("openai/") and ("gpt-4o" in mid or "gpt-4.1" in mid or "o1" in mid or "o3" in mid or "o4" in mid):
        return {"text": True, "multimodal": True, "video": False, "audio": False}
    if mid.startswith(("anthropic/claude-3", "anthropic/claude-4")):
        return {"text": True, "multimodal": True, "video": False, "audio": False}
    return {"text": True, "multimodal": False, "video": False, "audio": False}


def _estimate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> str:
    price_in, price_out = PRICE_PER_1K.get(model, _DEFAULT_PRICE_PER_1K)
    cost = (input_tokens / 1000) * price_in + (output_tokens / 1000) * price_out
    return f"{cost:.6f}"


def _extract_usage(response: Any) -> tuple[int, int] | None:
    """Suma usage_metadata de los AIMessage en la respuesta del modelo.

    `handler(request)` (wrap_model_call) devuelve un AIMessage suelto o un
    ModelResponse con `.result: list[BaseMessage]`, según la versión de
    langchain — se cubren ambos casos.
    """
    messages: list[Any]
    if hasattr(response, "result"):
        messages = list(response.result or [])
    else:
        messages = [response]

    input_tokens = 0
    output_tokens = 0
    found = False
    for msg in messages:
        usage = getattr(msg, "usage_metadata", None)
        if not usage:
            continue
        found = True
        input_tokens += usage.get("input_tokens", 0) or 0
        output_tokens += usage.get("output_tokens", 0) or 0
    return (input_tokens, output_tokens) if found else None


def _report_usage(tenant_id: str, model: str, response: Any) -> None:
    """Fire-and-forget: nunca debe retrasar ni tumbar el turno de chat."""
    if not tenant_id:
        return
    usage = _extract_usage(response)
    if not usage:
        return
    input_tokens, output_tokens = usage
    cost_usd = _estimate_cost_usd(model, input_tokens, output_tokens)

    async def _send() -> None:
        try:
            from .commerce import CommerceClient

            await CommerceClient(tenant_id=tenant_id).record_usage(
                model=model, input_tokens=input_tokens, output_tokens=output_tokens, cost_usd=cost_usd
            )
        except Exception:
            logger.warning("tenant %s: no se pudo reportar uso de tokens", tenant_id, exc_info=True)

    from .runtime import runtime as _runtime

    _runtime.background(_send())


def _tenant_model_middleware(settings: Settings, cache: _TenantModelCache):
    """Aplica el override de modelo/temperatura/max_tokens del tenant sin
    recompilar el grafo.

    `ModelRequest.override(model=...)` (langchain.agents.middleware) permite
    sustituir el `ChatOpenAI` para una sola llamada, así que el grafo
    compilado en `build_agent` sigue siendo uno solo, compartido y con el
    mismo `checkpointer` para todos los tenants — cambiar de modelo no
    interfiere con el hilo de la conversación porque el hilo vive en el
    checkpoint, no en el modelo.

    Se descartó cachear "un grafo por configuración de modelo": multiplicaría
    checkpointers/middleware por cada combinación que un tenant pruebe en el
    panel, y el ahorro de recompilar el grafo ya se logra igual con este
    hook, que es la superficie que la librería expone justo para esto.

    Si el modelo del tenant no existe o el proveedor lo rechaza, se reintenta
    con la request original (que ya trae el modelo por defecto del proceso):
    un nombre de modelo mal escrito en el panel no puede dejar mudo al
    agente.
    """

    @wrap_model_call(name="tenant_model_override")
    async def _override(request, handler):  # type: ignore[no-untyped-def]
        context = dict(getattr(request, "runtime", None).context or {})  # type: ignore[union-attr]
        tenant_id = context.get("tenant_id", "")
        overrides = get_agent_settings(tenant_id) if tenant_id else None

        model_name = overrides.effective_model(settings.model) if overrides else settings.model
        temperature = (
            overrides.temperature
            if overrides and overrides.temperature is not None
            else settings.temperature
        )
        max_tokens = (
            overrides.max_tokens if overrides and overrides.max_tokens else settings.max_tokens
        )
        tenant_api_key = overrides.openrouter_api_key() if overrides else ""

        if (model_name, temperature, max_tokens) == (
            settings.model,
            settings.temperature,
            settings.max_tokens,
        ) and not tenant_api_key:
            response = await handler(request)  # sin override real, no toques la request
            _report_usage(tenant_id, model_name, response)
            return response

        tenant_model = await cache.get(model_name, temperature, max_tokens, tenant_api_key)
        try:
            logger.info(
                "tenant %s: usando modelo override %r (temp=%s, max_tokens=%s, key_propia=%s)",
                tenant_id, model_name, temperature, max_tokens, bool(tenant_api_key),
            )
            response = await handler(request.override(model=tenant_model))
            _report_usage(tenant_id, model_name, response)
            return response
        except GraphBubbleUp:
            raise  # interrupts/control flow de LangGraph, no es una falla del modelo
        except Exception:
            logger.warning(
                "tenant %s: modelo %r falló, degradando a %r",
                tenant_id, model_name, settings.model, exc_info=True,
            )
            response = await handler(request)  # request original = modelo por defecto
            _report_usage(tenant_id, settings.model, response)
            return response

    return _override


@dynamic_prompt
async def sales_prompt(request) -> SystemMessage:  # type: ignore[no-untyped-def]
    """Prompt de sistema del turno: versión de prompt del tenant + contexto.

    Se arma en CADA llamada al modelo (no una vez por grafo) porque el grafo
    es único y compartido entre tenants: aquí es donde entra la identidad, el
    catálogo, el conocimiento, las lecciones y el hilo comercial del tenant
    y la conversación concretos (ver ``tenant_context.resolve_tenant_bundle``
    y ``prompts.assemble_prompt``).
    """
    state: dict[str, Any] = request.state
    context: TurnContext = dict(getattr(request, "runtime", None).context or {})  # type: ignore[union-attr]
    tenant_id = context.get("tenant_id", "")
    bundle = await resolve_tenant_bundle(tenant_id)
    assert bundle.prompt is not None
    return SystemMessage(
        assemble_prompt(
            bundle.prompt,
            profile=bundle.profile,
            overrides=bundle.overrides,
            working_memory=working_memory_block(state),
            customer_memory=str(context.get("customer_memory") or ""),
            catalog=bundle.catalog,
            knowledge=bundle.knowledge,
            lessons=bundle.lessons,
        )
    )


def build_agent(checkpointer: AsyncSqliteSaver, settings: Settings | None = None):
    """Grafo compilado y listo para `ainvoke`."""
    settings = settings or get_settings()
    model = build_model(settings)
    tenant_model_cache = _TenantModelCache(settings)

    middleware = [
        sales_prompt,
        # Sustituye el modelo (y temperatura/max_tokens) por el del tenant en
        # cada llamada al modelo principal. No toca SummarizationMiddleware:
        # el resumen es una tarea interna (comprimir historial), no una
        # respuesta que el cliente vea, así que se queda con el modelo fijo
        # del proceso (env) en vez de heredar un override de "voz de venta"
        # que el tenant eligió pensando en el chat, no en resumir.
        _tenant_model_middleware(settings, tenant_model_cache),
        # El resumen lo redacta un modelo cuando el hilo crece; los hechos
        # comerciales no dependen de él porque viven en el estado.
        SummarizationMiddleware(
            model=build_model(settings, model=settings.summary_model or settings.model),
            trigger=("messages", settings.summarize_after_messages),
            keep=("messages", settings.keep_messages),
        ),
        # El tope del turno es `recursion_limit` en la config de la invocación.
        # ModelCallLimitMiddleware/ToolCallLimitMiddleware no se pueden usar
        # aquí: sus contadores de estado hacen que se pierdan las
        # actualizaciones `Command` de las herramientas (el carrito nunca se
        # guardaba y el agente repetía la llamada hasta agotar la recursión).
    ]

    return create_deep_agent(
        model=model,
        tools=SALES_TOOLS,
        system_prompt="",  # lo arma sales_prompt en cada turno
        middleware=middleware,
        state_schema=SalesState,
        context_schema=TurnContext,
        checkpointer=checkpointer,
    )
