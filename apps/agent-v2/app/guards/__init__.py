"""Guardas del agente: todo lo que decide qué entra y qué sale sin confiar en
que el modelo obedezca el prompt.

- ``pii``: detección/redacción de datos personales (memoria, logs, señales).
- ``injection``: heurísticas de inyección y de fuera de alcance sobre el
  mensaje del cliente (antes del LLM).
- ``scope``: clasificador LLM de tema (segunda capa, falla abierto).
- ``output``: revisión de la respuesta del modelo (fugas, código, URLs,
  datos sensibles) antes de salir al canal.
- ``nemo_rails``: capa extra opcional (NVIDIA NeMo Guardrails, apagada de
  fábrica) sobre inyección/jailbreak. Ver docstring del módulo.

Orden en un turno (``pipeline/turn.py``)::

    neutralize → detect_injection → off_scope_category → is_off_topic (LLM)
      → nemo_check_input (opcional) → [compactación de contexto] → grafo
      → OutputGuard.check → canal
"""

from .injection import InjectionVerdict, detect_injection, neutralize, off_scope_category
from .nemo_rails import check_input as nemo_check_input
from .output import OutputGuard, OutputVerdict, urls_from_messages
from .pii import (
    RedactingFilter,
    contains_pii,
    detect as detect_pii,
    install_log_redaction,
    redact as redact_pii,
    redact_names as redact_pii_names,
)
from .scope import is_off_topic, redirect_reply

__all__ = [
    "InjectionVerdict",
    "OutputGuard",
    "OutputVerdict",
    "RedactingFilter",
    "contains_pii",
    "detect_injection",
    "detect_pii",
    "install_log_redaction",
    "is_off_topic",
    "nemo_check_input",
    "neutralize",
    "off_scope_category",
    "redact_pii",
    "redact_pii_names",
    "redirect_reply",
    "urls_from_messages",
]
