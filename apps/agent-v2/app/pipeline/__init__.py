"""Pipeline de un turno de conversación.

`main.py` solía tener el turno completo de `POST /chat` en una sola función
de 250 líneas; aquí cada etapa es un módulo con una responsabilidad y una
prueba propia:

- ``coalesce``: junta la ráfaga de mensajes seguidos de un mismo cliente
  (típico de WhatsApp) en un solo turno, en vez de contestar cada línea.
- ``failures``: clasifica el fallo (timeout, proveedor caído, bucle del
  modelo, bug) y decide si se reintenta, se contesta suave o se pasa a una
  persona. Un error aislado ya no deja al bot mudo hasta que alguien lo libere.
- ``replies``: extrae la respuesta del modelo (texto plano o bloques de
  contenido), garantiza que el cliente nunca reciba un mensaje vacío y arma
  las sugerencias del chat web según la etapa.
- ``responses``: construye el `ChatResponse` a partir del estado del hilo.
- ``post_turn``: señales de aprendizaje y memoria episódica (best-effort).
- ``trace``: traza por turno y métricas del proceso (`GET /metrics`).
- ``turn``: el orquestador que encadena todo lo anterior en orden fijo.

Ver "Flujo de un turno" en docs/ARCHITECTURE.md.
"""

from .coalesce import MessageCoalescer
from .failures import FailureDecision, FailureKind, classify_failure, decide_failure
from .replies import fallback_reply, final_reply, message_text, suggestions
from .responses import cart_payload, response_from_values
from .trace import Metrics, TurnTrace
from .turn import TurnPipeline, TurnRejected

__all__ = [
    "FailureDecision",
    "FailureKind",
    "MessageCoalescer",
    "Metrics",
    "TurnPipeline",
    "TurnRejected",
    "TurnTrace",
    "cart_payload",
    "classify_failure",
    "decide_failure",
    "fallback_reply",
    "final_reply",
    "message_text",
    "response_from_values",
    "suggestions",
]
