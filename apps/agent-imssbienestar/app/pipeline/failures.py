"""Política de fallos de un turno.

Antes, CUALQUIER excepción del grafo (un 502 de OpenRouter, un timeout de
red de 200 ms, un bug en una tool) marcaba el hilo en `handoff=True`: el
cliente recibía "ya le avisé a una persona" y el bot quedaba mudo para ese
cliente hasta que alguien pulsara "devolver al bot" en el panel. Un
proveedor con un mal minuto dejaba decenas de conversaciones bloqueadas.

Aquí se separan tres decisiones:

1. **Qué pasó** (`classify_failure`): timeout del turno, tope de recursión
   (el modelo entró en bucle), error transitorio del proveedor/red, o un
   fallo fatal (bug, configuración).
2. **Si vale la pena reintentar** (`FailureKind.retryable`): solo los
   transitorios. El reintento lo hace `pipeline/turn.py` reanudando el
   checkpoint de LangGraph (`ainvoke(None, config)`), que continúa desde el
   último paso persistido en vez de repetir la entrada del cliente.
3. **Qué recibe el cliente** (`decide_failure`): con `failure_streak` (fallos
   seguidos en ESTE hilo, ver `state.py`) por debajo del umbral, una
   respuesta suave que pide repetir el mensaje y NO bloquea al bot; al
   alcanzar el umbral, o si el modelo entró en bucle, sí handoff.

Todo el texto que ve el cliente sale de aquí para que sea uno solo y se
pueda revisar en un lugar.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import Enum

import httpx
from langgraph.errors import GraphRecursionError


class FailureKind(str, Enum):
    """Clase de fallo; el valor es lo que se reporta en `ChatResponse.intent`."""

    TIMEOUT = "TIMEOUT"
    RECURSION_LIMIT = "RECURSION_LIMIT"
    TRANSIENT = "PROVEEDOR_TRANSITORIO"
    FATAL = "ERROR_TECNICO"

    @property
    def retryable(self) -> bool:
        return self is FailureKind.TRANSIENT

    @property
    def always_handoff(self) -> bool:
        """El modelo en bucle no se arregla repitiendo el mensaje."""
        return self is FailureKind.RECURSION_LIMIT


# Estados HTTP que un proveedor devuelve cuando el problema es suyo o
# momentáneo. Un 400/401/404 NO está: repetir no lo arregla.
_TRANSIENT_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}
# Nombres de excepción del SDK de OpenAI (que usa langchain-openai) que
# significan "el proveedor no respondió bien ahora". Se comparan por nombre
# para no acoplar este módulo a la jerarquía interna del SDK.
_TRANSIENT_NAMES = {
    "APIConnectionError",
    "APITimeoutError",
    "RateLimitError",
    "InternalServerError",
    "ServiceUnavailableError",
}

# Respuesta suave: el bot sigue vivo, solo se le pide al cliente que repita.
SOFT_FAILURE_REPLY = (
    "Se me trabó el sistema un segundo. ¿Me repites lo último que me dijiste?"
)
# Respuesta con handoff. Del otro lado hay una persona esperando por
# WhatsApp, no un desarrollador viendo logs; commerce-api descarta cualquier
# respuesta que no sea 2xx, así que esto tiene que salir como 200.
HANDOFF_FAILURE_REPLY = (
    "Ahorita no puedo consultar el sistema para seguir ayudándote. "
    "Ya le avisé a una persona de nuestro equipo para que te atienda enseguida."
)


def classify_failure(exc: BaseException) -> FailureKind:
    """Clasifica la excepción que tumbó el turno sin depender del proveedor."""
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return FailureKind.TIMEOUT
    if isinstance(exc, GraphRecursionError):
        return FailureKind.RECURSION_LIMIT
    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError)):
        return FailureKind.TRANSIENT
    status = getattr(exc, "status_code", None)
    if status is None:
        status = getattr(getattr(exc, "response", None), "status_code", None)
    if isinstance(status, int) and status in _TRANSIENT_STATUS:
        return FailureKind.TRANSIENT
    if any(cls.__name__ in _TRANSIENT_NAMES for cls in type(exc).__mro__):
        return FailureKind.TRANSIENT
    # Excepciones envueltas (ExceptionGroup de LangGraph, `__cause__`): se
    # mira una capa hacia adentro antes de rendirse.
    cause = exc.__cause__ or exc.__context__
    if cause is not None and cause is not exc:
        inner = classify_failure(cause)
        if inner is not FailureKind.FATAL:
            return inner
    return FailureKind.FATAL


@dataclass(frozen=True)
class FailureDecision:
    kind: FailureKind
    #: Fallos seguidos en el hilo contando este.
    streak: int
    #: True = marcar el hilo en handoff (una persona debe liberarlo).
    handoff: bool
    reply: str

    @property
    def intent(self) -> str:
        return self.kind.value

    @property
    def engine(self) -> str:
        return "error-fallback" if self.handoff else "error-soft"


def decide_failure(kind: FailureKind, previous_streak: int, *, handoff_after: int) -> FailureDecision:
    """Qué recibe el cliente tras un fallo ya reintentado (si aplicaba).

    `handoff_after`: fallos seguidos que se toleran con respuesta suave antes
    de pasar a una persona (`AGENT_HANDOFF_AFTER_FAILURES`, mínimo 1). Con 1
    se recupera el comportamiento anterior: todo fallo es handoff.
    """
    streak = max(0, int(previous_streak or 0)) + 1
    handoff = kind.always_handoff or streak >= max(1, handoff_after)
    return FailureDecision(
        kind=kind,
        streak=streak,
        handoff=handoff,
        reply=HANDOFF_FAILURE_REPLY if handoff else SOFT_FAILURE_REPLY,
    )
