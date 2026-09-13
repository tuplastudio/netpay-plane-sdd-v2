"""Higiene de contexto: compactar o vaciar el historial de un hilo.

Problema: el historial de mensajes de una conversación larga crece sin
límite, encarece cada turno y degrada al modelo (alucina más con contexto
ruidoso). ``SummarizationMiddleware`` (en ``agent.py``) ya resume por número
de mensajes dentro del grafo; esto es el complemento explícito y controlable:

- ``history_chars``: tamaño del historial, para decidir compactar por
  presupuesto de caracteres (``settings.compact_after_chars``) ANTES de
  invocar al modelo (``main.py``).
- ``compact_thread``: sustituye los mensajes viejos por un único mensaje de
  resumen y conserva los últimos ``keep_turns`` turnos del cliente intactos.
  El resumen lo redacta un modelo si se pasa ``summarizer``; si no (o si
  falla), se usa ``deterministic_summary`` a partir del estado comercial,
  que es la fuente de verdad de los hechos (carrito, cliente, cotización) y
  no depende del historial.
- ``clear_history``: borra TODOS los mensajes y conserva el resto del estado
  (carrito, cliente, cotización): "empezar limpio" sin perder la venta.

Detalles de LangGraph que explican la implementación:

- ``messages`` usa el reducer ``add_messages``: un ``RemoveMessage(id)``
  elimina; un mensaje con id nuevo se agrega AL FINAL. Para que el resumen
  quede ANTES de la cola conservada se eliminan todos los mensajes y se
  vuelven a agregar (resumen + cola) con ids nuevos, en un único
  ``aupdate_state``.
- El corte siempre cae en un ``HumanMessage`` para no dejar un
  ``AIMessage`` con ``tool_calls`` sin sus ``ToolMessage`` (el proveedor
  rechaza ese historial).
- El resumen se inyecta como ``HumanMessage`` con un prefijo explícito, el
  mismo patrón que usa ``SummarizationMiddleware`` de langchain.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Sequence

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    RemoveMessage,
    ToolMessage,
)
from langgraph.graph.message import REMOVE_ALL_MESSAGES

from ..state import cart_summary, open_carts, overall_stage

logger = logging.getLogger(__name__)

SUMMARY_PREFIX = "[RESUMEN DE LA CONVERSACIÓN PREVIA — generado por el sistema, no es un mensaje del cliente]"
MAX_SUMMARY_CHARS = 2_000

Summarizer = Callable[[Sequence[BaseMessage], dict[str, Any]], Awaitable[str]]


@dataclass(frozen=True)
class CompactionResult:
    """Qué pasó al compactar."""

    compacted: bool
    removed: int = 0
    kept: int = 0
    summary_chars: int = 0
    source: str = "none"  # "llm" | "heuristic" | "none"
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "compacted": self.compacted,
            "removed": self.removed,
            "kept": self.kept,
            "summaryChars": self.summary_chars,
            "source": self.source,
            "reason": self.reason,
        }


def _text_of(message: BaseMessage) -> str:
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            str(p.get("text", "")) if isinstance(p, dict) else str(p) for p in content
        ]
        return " ".join(p for p in parts if p)
    return str(content or "")


def history_chars(messages: Sequence[BaseMessage] | None) -> int:
    """Tamaño aproximado del historial (texto de todos los mensajes)."""
    return sum(len(_text_of(m)) for m in (messages or []))


def is_summary_message(message: BaseMessage) -> bool:
    return isinstance(message, HumanMessage) and _text_of(message).startswith(SUMMARY_PREFIX)


def cut_index(messages: Sequence[BaseMessage], keep_turns: int) -> int:
    """Índice desde el que se conserva el historial (cae en un HumanMessage).

    Devuelve 0 si no hay nada que compactar (menos turnos que ``keep_turns``
    o nada antes del corte).
    """
    if keep_turns < 0:
        keep_turns = 0
    human_positions = [
        i for i, m in enumerate(messages) if isinstance(m, HumanMessage) and not is_summary_message(m)
    ]
    if len(human_positions) <= keep_turns:
        return 0
    if keep_turns == 0:
        # Sin cola: se compacta todo, el corte va después del último mensaje.
        return len(messages)
    return human_positions[-keep_turns]


def deterministic_summary(messages: Sequence[BaseMessage], state: dict[str, Any]) -> str:
    """Resumen sin LLM: hechos del estado + huella de lo que pasó en el historial.

    No copia texto del cliente (evita arrastrar datos personales al resumen);
    lo que el modelo necesita para seguir la venta ya está en el estado y se
    reinyecta en cada turno como ``<memoria_conversacion>``.
    """
    turns = sum(1 for m in messages if isinstance(m, HumanMessage) and not is_summary_message(m))
    tools = [
        call.get("name", "?")
        for m in messages
        if isinstance(m, AIMessage)
        for call in (m.tool_calls or [])
    ]
    errors = sum(
        1 for m in messages if isinstance(m, ToolMessage) and _text_of(m).startswith("ERROR:")
    )
    previous = next((_text_of(m) for m in messages if is_summary_message(m)), "")
    carts = open_carts(state.get("carts"))
    lines = [
        f"Turnos del cliente resumidos: {turns}.",
        f"Etapa alcanzada: {state.get('stage') or overall_stage(carts)}.",
    ]
    if not carts:
        lines.append("Carritos: ninguno abierto.")
    elif len(carts) == 1:
        cart_id, record = next(iter(carts.items()))
        lines.append(f"Carrito [{cart_id}]: {cart_summary(record.get('lines'))}.")
    else:
        lines.append(f"Carritos abiertos a la vez: {len(carts)} — {', '.join(carts)}.")
    customer = state.get("customer") or {}
    if customer.get("name"):
        lines.append("El cliente ya dio su nombre (está en la memoria de la conversación).")
    if any(c.get("quoteId") for c in carts.values()):
        lines.append("Ya se emitió al menos una cotización (ver memoria de la conversación).")
    if any(c.get("checkoutLink") for c in carts.values()):
        lines.append("Ya se compartió al menos un enlace de pago.")
    if tools:
        counted: dict[str, int] = {}
        for name in tools:
            counted[name] = counted.get(name, 0) + 1
        lines.append(
            "Herramientas usadas: " + ", ".join(f"{k} x{v}" for k, v in sorted(counted.items())) + "."
        )
    if errors:
        lines.append(f"Hubo {errors} error(es) de herramienta; no repitas la misma llamada a ciegas.")
    if previous:
        prior = previous[len(SUMMARY_PREFIX) :].strip()
        if prior:
            lines.append("Resumen anterior: " + prior[:600])
    return "\n".join(lines)


def _with_new_id(message: BaseMessage) -> BaseMessage:
    return message.model_copy(update={"id": f"kept-{uuid.uuid4().hex}"})


async def compact_thread(
    agent: Any,
    config: dict[str, Any],
    *,
    keep_turns: int,
    summarizer: Summarizer | None = None,
    reason: str = "manual",
) -> CompactionResult:
    """Compacta el hilo de ``config`` (ver docstring del módulo).

    ``agent`` es cualquier objeto con ``aget_state``/``aupdate_state`` (el
    grafo compilado, o un doble en pruebas). Nunca lanza por un fallo del
    ``summarizer``: cae al resumen determinista.
    """
    snapshot = await agent.aget_state(config)
    values: dict[str, Any] = dict(getattr(snapshot, "values", None) or {})
    messages: list[BaseMessage] = list(values.get("messages") or [])
    cut = cut_index(messages, keep_turns)
    if cut <= 0:
        return CompactionResult(False, kept=len(messages), reason="nada que compactar")

    old, tail = messages[:cut], messages[cut:]
    summary = ""
    source = "heuristic"
    if summarizer is not None:
        try:
            summary = (await summarizer(old, values) or "").strip()
            source = "llm" if summary else "heuristic"
        except Exception:  # noqa: BLE001 - el resumen por LLM es opcional
            logger.warning("resumen por LLM falló; se usa el determinista", exc_info=True)
            summary = ""
    if not summary:
        summary = deterministic_summary(old, values)
    summary = summary[:MAX_SUMMARY_CHARS]

    summary_message = HumanMessage(
        content=f"{SUMMARY_PREFIX}\n{summary}", id=f"summary-{uuid.uuid4().hex}"
    )
    updates: list[BaseMessage] = [RemoveMessage(id=REMOVE_ALL_MESSAGES), summary_message]
    updates.extend(_with_new_id(m) for m in tail)
    await agent.aupdate_state(config, {"messages": updates})
    logger.info(
        "hilo compactado (%s): %d mensajes → resumen + %d conservados", reason, len(old), len(tail)
    )
    return CompactionResult(
        True,
        removed=len(old),
        kept=len(tail),
        summary_chars=len(summary),
        source=source,
        reason=reason,
    )


async def clear_history(agent: Any, config: dict[str, Any]) -> int:
    """Borra todos los mensajes del hilo; conserva carrito, cliente, cotización.

    Devuelve cuántos mensajes había.
    """
    snapshot = await agent.aget_state(config)
    values: dict[str, Any] = dict(getattr(snapshot, "values", None) or {})
    count = len(values.get("messages") or [])
    if count:
        await agent.aupdate_state(config, {"messages": [RemoveMessage(id=REMOVE_ALL_MESSAGES)]})
    return count


def build_llm_summarizer(model: Any) -> Summarizer:
    """Summarizer que usa ``model.ainvoke``; el texto que ve el modelo va sin
    datos personales (los hechos del cliente ya viven en el estado)."""
    from langchain_core.messages import HumanMessage as _Human, SystemMessage as _System

    from ..guards.pii import redact

    async def summarize(messages: Sequence[BaseMessage], state: dict[str, Any]) -> str:
        transcript: list[str] = []
        for message in messages:
            if isinstance(message, HumanMessage):
                role = "cliente"
            elif isinstance(message, AIMessage):
                role = "agente"
            elif isinstance(message, ToolMessage):
                role = f"herramienta:{getattr(message, 'name', '') or '?'}"
            else:
                continue
            text = redact(_text_of(message))[:600]
            if text:
                transcript.append(f"{role}: {text}")
        if not transcript:
            return ""
        result = await model.ainvoke(
            [
                _System(
                    "Resume en español, en máximo 8 líneas, qué se ha conversado entre un "
                    "cliente y un agente de ventas. Incluye: qué productos le interesan, qué "
                    "decidió, qué falta por cerrar y el tono del cliente. NO incluyas nombres, "
                    "teléfonos, correos, direcciones ni números de tarjeta: esos datos ya "
                    "están guardados aparte. No inventes nada que no esté en la transcripción."
                ),
                _Human("\n".join(transcript)[-12_000:]),
            ]
        )
        content = getattr(result, "content", "")
        return content if isinstance(content, str) else str(content)

    return summarize
