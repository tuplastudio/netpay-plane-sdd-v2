"""Contexto de turno: variables de contexto y filtros de logging.

- ``turn_id_var`` (ContextVar): el `turnId` del turno en curso. Cualquier log
  del pipeline (y de los módulos que llama) lo lleva consigo sin tener que
  pasarlo por argumento, así un ``turn.done`` con su `turnId` se correlaciona
  con los warnings o los logs de tools que disparó, sin buscar entre
  registros sueltos.
- ``install_turn_id_filter``: agrega el `turnId` a cada ``LogRecord`` y lo
  expone como ``record.turnId`` para que el ``LogFormatter`` lo imprima.

El `ContextVar` se propaga solo dentro de la misma task de asyncio: cualquier
coroutine lanzada con `asyncio.create_task` dentro del turno hereda el valor
a través de `contextvars.copy_context()` (lo hace `asyncio.create_task` por
defecto). Los hooks post-turn que se lanzan con `Runtime.background(...)`
también heredan el valor porque comparten contexto de tarea.
"""

from __future__ import annotations

import contextvars
import logging

# Vacío cuando no hay turno en curso (arranque, tareas internas).
turn_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "turn_id", default=""
)


class TurnIdFilter(logging.Filter):
    """Inyecta ``record.turnId`` desde ``turn_id_var`` antes de formatear."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not getattr(record, "turnId", None):
            record.turnId = turn_id_var.get()
        return True


def bind_turn_id(turn_id: str) -> contextvars.Token[str]:
    """Fija el `turn_id` para el resto del turno (devuelve un token para
    `reset`). Lo llama `pipeline.turn.run()` al arrancar y al final."""
    return turn_id_var.set(turn_id)


def reset_turn_id(token: contextvars.Token[str]) -> None:
    turn_id_var.reset(token)


def install_turn_id_filter(logger: logging.Logger | None = None) -> None:
    """Agrega `TurnIdFilter` a todos los handlers del logger (raíz por defecto).

    Se instala después de ``RedactingFilter`` para que el `turnId` no se
    redacte accidentalmente si coincide con el patrón de un UUID/dígitos
    (el turno es hex de 12 chars, no entra en los patrones actuales, pero
    el orden es defensivo)."""
    target = logger or logging.getLogger()
    for handler in target.handlers:
        if not any(isinstance(f, TurnIdFilter) for f in handler.filters):
            handler.addFilter(TurnIdFilter())
