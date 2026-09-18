"""Traza por turno y métricas del proceso.

`TurnTrace` marca cuánto tardó cada etapa del turno (guards, compactación,
modelo, guard de salida) y termina en UNA línea de log estructurada
(`turn.done`) con el `turnId` que también viaja en `ChatResponse.turnId`:
con eso se correlaciona lo que vio el canal con lo que hizo el agente sin
buscar entre logs sueltos. Nunca lleva el texto del cliente ni de la
respuesta (los logs ya pasan por el filtro de PII, pero no hace falta
tentar a la suerte).

`Metrics` son contadores en memoria del proceso (turnos, fallos por clase,
guards disparados, ráfagas unidas) y un reservorio de latencias para
p50/p95. Se exponen en `GET /metrics` como JSON; no pretenden reemplazar a
Prometheus, sino responder "¿está sano el agente?" sin infraestructura.
"""

from __future__ import annotations

import time
import uuid
from collections import Counter, deque
from typing import Any


def new_turn_id() -> str:
    return uuid.uuid4().hex[:12]


class TurnTrace:
    def __init__(self, turn_id: str | None = None) -> None:
        self.turn_id = turn_id or new_turn_id()
        self._started = time.perf_counter()
        self._last = self._started
        self.events: list[dict[str, Any]] = []
        self.fields: dict[str, Any] = {}

    def mark(self, stage: str, **fields: Any) -> None:
        """Cierra la etapa `stage`: registra su duración desde la marca previa."""
        now = time.perf_counter()
        event = {"stage": stage, "ms": int((now - self._last) * 1000)}
        event.update({k: v for k, v in fields.items() if v is not None})
        self.events.append(event)
        self._last = now

    def note(self, **fields: Any) -> None:
        """Datos del turno que no son una etapa (motor, intent, reintento)."""
        self.fields.update({k: v for k, v in fields.items() if v is not None})

    @property
    def elapsed_ms(self) -> int:
        return int((time.perf_counter() - self._started) * 1000)

    def to_dict(self) -> dict[str, Any]:
        return {
            "turnId": self.turn_id,
            "totalMs": self.elapsed_ms,
            **self.fields,
            "stages": self.events,
        }


class Metrics:
    def __init__(self, latency_samples: int = 500) -> None:
        self.started_at = time.time()
        self.counters: Counter[str] = Counter()
        self._latencies: deque[int] = deque(maxlen=max(10, latency_samples))

    def incr(self, name: str, amount: int = 1) -> None:
        self.counters[name] += amount

    def observe_latency(self, ms: int) -> None:
        self._latencies.append(int(ms))

    @staticmethod
    def _percentile(values: list[int], pct: float) -> int:
        if not values:
            return 0
        index = min(len(values) - 1, max(0, int(round((pct / 100.0) * (len(values) - 1)))))
        return values[index]

    def snapshot(self) -> dict[str, Any]:
        values = sorted(self._latencies)
        return {
            "uptimeSeconds": int(time.time() - self.started_at),
            "counters": dict(sorted(self.counters.items())),
            "latencyMs": {
                "samples": len(values),
                "p50": self._percentile(values, 50),
                "p95": self._percentile(values, 95),
                "max": values[-1] if values else 0,
            },
        }
