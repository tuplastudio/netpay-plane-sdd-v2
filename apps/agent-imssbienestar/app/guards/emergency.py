"""Detector determinista de emergencias de salud.

Una emergencia no puede depender de que el modelo se acuerde de su prompt:
si el mensaje describe una emergencia evidente, el pipeline contesta con un
texto fijo (911) sin invocar al grafo. Es a propósito conservador en lo que
dispara —frases activas ("no respira", "convulsiona"), no menciones sueltas
de una palabra— porque un falso positivo solo cuesta una respuesta de más,
pero una emergencia real tratada como consulta de horarios es inaceptable.
"""

from __future__ import annotations

import re
import unicodedata

_FLAGS = re.IGNORECASE

_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, _FLAGS)
    for p in (
        r"\b(no|ya\s+no|dej[oó]\s+de)\s+respir\w*",
        r"\b(se\s+(esta\s+)?ahog\w*|atragant\w*|se\s+esta\s+asfixi\w*)",
        r"\b(esta|se\s+puso|se\s+ve|lo\s+veo|la\s+veo)\s+(morad[oa]|azul|cian[oó]tic[oa])\b",
        r"\bconvuls\w*",
        r"\b(se\s+desmay\w*|desmayad[oa]|inconsciente|no\s+reacciona|no\s+despierta|no\s+responde)\b",
        r"\b(sangrado|hemorragia)\s+(abundante|fuerte|que\s+no\s+para|no\s+para)",
        r"\bno\s+para\s+de\s+sangrar",
        r"\b(se\s+esta\s+muriendo|se\s+va\s+a\s+morir|se\s+nos\s+muere|se\s+murio)\b",
        r"\b(envenen\w*|intoxic\w*|se\s+trag[oó]\s+(un|una|el|la)\s+\w+)",
        r"\b(accidente\s+grave|se\s+cay[oó]\s+y\s+(no|est[aá]\s+inconsciente)|golpe\s+fuerte\s+en\s+la\s+cabeza)",
        r"\bes\s+una\s+emergencia\b",
        r"\bnecesito\s+una\s+ambulancia\b",
        r"\bmed?ico\s+urgente\b|\burgencia\s+m[eé]dica\b",
    )
)

EMERGENCY_REPLY = (
    "Si es una emergencia, llama YA al 911 o llévalo al servicio de urgencias más "
    "cercano; no esperes a una unidad de consulta. Cuando esté atendido, dime tu "
    "código postal o comparte tu ubicación y te ayudo a ubicar la unidad médica más cercana."
)


def _fold(text: str) -> str:
    base = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in base if not unicodedata.combining(c))


def detect_emergency(text: str) -> bool:
    """``True`` si el mensaje describe una emergencia evidente."""
    body = _fold(text)
    return bool(body) and any(p.search(body) for p in _PATTERNS)
