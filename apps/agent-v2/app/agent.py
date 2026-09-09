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
from typing import Any

from deepagents import create_deep_agent
from langchain.agents.middleware import SummarizationMiddleware, dynamic_prompt
from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from .commerce import CommerceClient, CommerceError, CommerceUnavailable
from .config import Settings, get_settings
from .knowledge import load_knowledge
from .prompts import turn_prompt
from .state import SalesState, TurnContext, working_memory_block
from .tools import SALES_TOOLS


def build_model(settings: Settings, *, model: str | None = None) -> ChatOpenAI:
    """OpenRouter habla el protocolo de OpenAI: mismo cliente, otra base_url."""
    return ChatOpenAI(
        model=model or settings.model,
        api_key=settings.openrouter_key,
        base_url=settings.openrouter_base_url,
        temperature=settings.temperature,
        max_completion_tokens=settings.max_tokens,
        default_headers={
            "HTTP-Referer": settings.public_base_url,
            "X-Title": "NetPay Plane Agent v2",
        },
    )


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
        )
    )


def build_agent(checkpointer: AsyncSqliteSaver, settings: Settings | None = None):
    """Grafo compilado y listo para `ainvoke`."""
    settings = settings or get_settings()
    model = build_model(settings)

    middleware = [
        sales_prompt,
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
