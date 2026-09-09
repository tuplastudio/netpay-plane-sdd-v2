"""Construcción del agente v2 (LangGraph + deepagents).

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
from langchain.agents.middleware import SummarizationMiddleware, dynamic_prompt, wrap_model_call
from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.errors import GraphBubbleUp

from .commerce import CommerceClient, CommerceError, CommerceUnavailable
from .config import Settings, get_settings
from .agent_settings import get_agent_settings
from .knowledge import load_knowledge, load_profile
from .prompts import turn_prompt
from .state import SalesState, TurnContext, working_memory_block
from .tools import SALES_TOOLS

logger = logging.getLogger(__name__)


def build_model(
    settings: Settings,
    *,
    model: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> ChatOpenAI:
    """OpenRouter habla el protocolo de OpenAI: mismo cliente, otra base_url."""
    model_id = model or settings.model
    extra: dict[str, Any] = {}
    # Serializar las tool calls evita que varias lean el mismo snapshot del
    # estado en un turno (el orden importa, p. ej. cotizar después de agregar).
    # La corrección de fondo del carrito vive en el reducer `_merge_cart`, así
    # que esto es defensa en profundidad, no el único arreglo.
    # OpenRouter rechaza el parámetro para la familia Anthropic
    # ("tool_choice.auto.disable_parallel_tool_use: Extra inputs are not
    # permitted"), y mandarlo haría fallar cada turno de un tenant que elija
    # claude, degradando siempre al modelo por defecto.
    if not model_id.startswith("anthropic/"):
        extra["parallel_tool_calls"] = False
    return ChatOpenAI(
        model=model_id,
        api_key=settings.openrouter_key,
        base_url=settings.openrouter_base_url,
        temperature=settings.temperature if temperature is None else temperature,
        max_completion_tokens=settings.max_tokens if max_tokens is None else max_tokens,
        default_headers={
            "HTTP-Referer": settings.public_base_url,
            "X-Title": "NetPay Plane Agent v2",
        },
        **extra,
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
        self._entries: dict[tuple[str, float, int], ChatOpenAI] = {}
        self._lock = asyncio.Lock()

    async def get(self, model: str, temperature: float, max_tokens: int) -> ChatOpenAI:
        key = (model, temperature, max_tokens)
        cached = self._entries.get(key)
        if cached is not None:
            return cached
        async with self._lock:
            cached = self._entries.get(key)
            if cached is not None:
                return cached
            instance = build_model(
                self._settings, model=model, temperature=temperature, max_tokens=max_tokens
            )
            self._entries[key] = instance
            return instance


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

        if (model_name, temperature, max_tokens) == (
            settings.model,
            settings.temperature,
            settings.max_tokens,
        ):
            return await handler(request)  # sin override real, no toques la request

        tenant_model = await cache.get(model_name, temperature, max_tokens)
        try:
            logger.info(
                "tenant %s: usando modelo override %r (temp=%s, max_tokens=%s)",
                tenant_id, model_name, temperature, max_tokens,
            )
            return await handler(request.override(model=tenant_model))
        except GraphBubbleUp:
            raise  # interrupts/control flow de LangGraph, no es una falla del modelo
        except Exception:
            logger.warning(
                "tenant %s: modelo %r falló, degradando a %r",
                tenant_id, model_name, settings.model, exc_info=True,
            )
            return await handler(request)  # request original = modelo por defecto

    return _override


class CatalogCache:
    """El catálogo entra completo al prompt, así que se cachea por tenant.

    Sin esto cada turno pagaría una llamada al backend solo para armar el
    bloque de catálogo.
    """

    def __init__(self, ttl_seconds: float = 120.0) -> None:
        self.ttl = ttl_seconds
        self._entries: dict[str, tuple[float, str]] = {}
        self._lock = asyncio.Lock()

    async def get(self, tenant_id: str) -> str:
        now = asyncio.get_running_loop().time()
        cached = self._entries.get(tenant_id)
        if cached and now - cached[0] < self.ttl:
            return cached[1]
        async with self._lock:
            cached = self._entries.get(tenant_id)
            if cached and now - cached[0] < self.ttl:
                return cached[1]
            block = await self._render()
            self._entries[tenant_id] = (now, block)
            return block

    @staticmethod
    async def _render() -> str:
        client = CommerceClient()
        if not client.live:
            return ""
        try:
            variants = await client.search_products(None, limit=100)
        except (CommerceError, CommerceUnavailable):
            return ""
        grouped: dict[str, list[dict[str, Any]]] = {}
        for variant in variants:
            if variant.get("status") != "ACTIVE":
                continue
            grouped.setdefault(variant["productTitle"] or variant["title"], []).append(variant)
        lines: list[str] = []
        for product, items in grouped.items():
            lines.append(f"{product}:")
            for v in items:
                stock = v.get("stock")
                warn = " SIN EXISTENCIA" if stock is not None and stock <= 0 else ""
                lines.append(f"  - {v['title']} | {v['sku']} | ${v['price']}{warn}")
        return "\n".join(lines)


_CATALOG = CatalogCache()


@dynamic_prompt
async def sales_prompt(request) -> SystemMessage:  # type: ignore[no-untyped-def]
    """Reinyecta el hilo comercial y el catálogo en cada llamada al modelo."""
    state: dict[str, Any] = request.state
    context: TurnContext = dict(getattr(request, "runtime", None).context or {})  # type: ignore[union-attr]
    tenant_id = context.get("tenant_id", "")

    catalog = await _CATALOG.get(tenant_id) if tenant_id else ""
    return SystemMessage(
        turn_prompt(
            working_memory=working_memory_block(state),
            catalog=catalog,
            knowledge=load_knowledge(),
            profile=load_profile(),
            overrides=get_agent_settings(tenant_id) if tenant_id else None,
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
