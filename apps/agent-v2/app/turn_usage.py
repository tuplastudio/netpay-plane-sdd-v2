"""Contabilidad de tokens por turno.

`agent._report_usage` ya manda el consumo de cada llamada al modelo a
commerce-api (facturación por tenant). Lo que faltaba era verlo POR TURNO
en el proceso: cuántos tokens de entrada/salida costó contestar un mensaje,
cuántas llamadas al modelo hubo, y acumularlo en `GET /metrics` para medir
si un cambio de prompt o de política ahorra de verdad.

`TurnUsage` vive en un `ContextVar` que `pipeline/turn.py` abre al inicio del
turno (`begin_turn_usage`) y cierra al final; las llamadas al modelo dentro del
grafo (tasks hijas de la task del turno) heredan la referencia y suman en el
mismo objeto. Fuera de un turno (`current()` devuelve `None`) no se
contabiliza nada: nunca lanza.

Vive en `app/` y no en `pipeline/` a propósito: `agent.py` lo importa y
`pipeline/__init__.py` importa `turn.py`, que importa `agent.py` (ciclo).
"""

from __future__ import annotations

import contextvars
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TurnUsage:
    """Tokens y llamadas al modelo acumulados en un turno."""

    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    model_calls: int = 0
    models: list[str] = field(default_factory=list)

    def add(self, *, model: str, input_tokens: int, output_tokens: int, cached_tokens: int = 0) -> None:
        self.input_tokens += max(0, int(input_tokens or 0))
        self.output_tokens += max(0, int(output_tokens or 0))
        self.cached_tokens += max(0, int(cached_tokens or 0))
        self.model_calls += 1
        if model and model not in self.models:
            self.models.append(model)

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    def to_dict(self) -> dict[str, Any]:
        return {
            "modelCalls": self.model_calls,
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
            "cachedTokens": self.cached_tokens,
            "models": list(self.models),
        }


_USAGE: contextvars.ContextVar[TurnUsage | None] = contextvars.ContextVar("turn_usage", default=None)


def begin_turn_usage() -> contextvars.Token[TurnUsage | None]:
    """Abre la contabilidad del turno; `end_turn_usage(token)` la cierra."""
    return _USAGE.set(TurnUsage())


def end_turn_usage(token: contextvars.Token[TurnUsage | None]) -> None:
    _USAGE.reset(token)


def current() -> TurnUsage | None:
    """La contabilidad del turno en curso, o `None` fuera de un turno."""
    return _USAGE.get()


def record(model: str, input_tokens: int, output_tokens: int, cached_tokens: int = 0) -> None:
    """Suma una llamada al modelo al turno en curso. No-op fuera de un turno."""
    usage = _USAGE.get()
    if usage is None:
        return
    usage.add(
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cached_tokens=cached_tokens,
    )
