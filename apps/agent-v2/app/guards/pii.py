"""Detección y redacción de datos personales (PII) en texto libre.

Dónde se usa:

- **Memoria episódica** (``memory/episodic.py``): nada de lo que se guarda
  sobre una conversación puede contener datos de personas. Se redacta en
  modo agresivo (también secuencias largas de dígitos).
- **Señales de aprendizaje** (``learning.py`` vía ``main.py``): la pregunta
  del cliente que revisa el dueño del negocio va sin teléfonos ni correos.
- **Logs** (``RedactingFilter``): los ids de conversación traen el teléfono
  del cliente; el filtro lo enmascara antes de que toque disco.
- **Guard de salida** (``guards/output.py``): si el modelo intenta repetir
  una tarjeta, CLABE o CURP, se enmascara.

Patrones cubiertos: correo, teléfono (10 a 13 dígitos con o sin +52),
tarjeta bancaria (13-19 dígitos con Luhn válido), CLABE (18 dígitos), RFC,
CURP, y en modo agresivo cualquier secuencia de 6+ dígitos. No pretende ser
un detector NER de nombres: los nombres se tratan aparte (por ejemplo, la
memoria episódica elimina el nombre conocido del cliente y del negocio).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

# Orden importa: lo más específico primero (tarjeta/CLABE antes que teléfono,
# CURP antes que RFC porque un CURP contiene un patrón parecido al RFC).
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", re.UNICODE)
_CURP_RE = re.compile(r"\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b", re.IGNORECASE)
_RFC_RE = re.compile(r"\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b", re.IGNORECASE)
# Grupos de dígitos separados por espacio/guion/punto: tarjeta, CLABE, teléfono.
_DIGIT_RUN_RE = re.compile(r"(?<![\w@])\+?\d[\d\s().-]{5,24}\d(?![\w@])")
_LONG_DIGITS_RE = re.compile(r"(?<!\d)\d{6,}(?!\d)")

MASKS = {
    "email": "[correo]",
    "card": "[tarjeta]",
    "clabe": "[clabe]",
    "phone": "[teléfono]",
    "curp": "[curp]",
    "rfc": "[rfc]",
    "number": "[número]",
}


@dataclass(frozen=True)
class PiiMatch:
    kind: str
    value: str
    start: int
    end: int


def _luhn_ok(digits: str) -> bool:
    total = 0
    parity = len(digits) % 2
    for index, char in enumerate(digits):
        digit = int(char)
        if index % 2 == parity:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


def _classify_digit_run(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 18:
        return "clabe"
    if 13 <= len(digits) <= 19 and _luhn_ok(digits):
        return "card"
    if 10 <= len(digits) <= 13:
        # Un precio "1500.00 2000" no llega aquí porque el punto decimal corta
        # el run en la mayoría de los casos; con separadores mezclados
        # exigimos que parezca teléfono: con +, paréntesis o 10-13 dígitos.
        return "phone"
    return None


def detect(text: str, *, aggressive: bool = False) -> list[PiiMatch]:
    """Todos los datos personales encontrados, sin solapamientos."""
    if not text:
        return []
    found: list[PiiMatch] = []
    taken: list[tuple[int, int]] = []

    def free(start: int, end: int) -> bool:
        return all(end <= s or start >= e for s, e in taken)

    def add(kind: str, match: re.Match[str]) -> None:
        if free(match.start(), match.end()):
            found.append(PiiMatch(kind, match.group(0), match.start(), match.end()))
            taken.append((match.start(), match.end()))

    for match in _EMAIL_RE.finditer(text):
        add("email", match)
    for match in _CURP_RE.finditer(text):
        add("curp", match)
    for match in _RFC_RE.finditer(text):
        add("rfc", match)
    for match in _DIGIT_RUN_RE.finditer(text):
        kind = _classify_digit_run(match.group(0))
        if kind:
            add(kind, match)
    if aggressive:
        for match in _LONG_DIGITS_RE.finditer(text):
            add("number", match)
    found.sort(key=lambda m: m.start)
    return found


def redact(text: str, *, aggressive: bool = False) -> str:
    """Sustituye cada dato personal por su máscara (``[correo]``, ``[teléfono]``...)."""
    matches = detect(text, aggressive=aggressive)
    if not matches:
        return text or ""
    out: list[str] = []
    cursor = 0
    for match in matches:
        out.append(text[cursor : match.start])
        out.append(MASKS[match.kind])
        cursor = match.end
    out.append(text[cursor:])
    return "".join(out)


def contains_pii(text: str, *, kinds: tuple[str, ...] | None = None) -> bool:
    """``True`` si hay algún dato personal (opcionalmente solo de ``kinds``)."""
    matches = detect(text)
    if kinds is None:
        return bool(matches)
    return any(m.kind in kinds for m in matches)


SENSITIVE_KINDS: tuple[str, ...] = ("card", "clabe", "curp")
"""Datos que el agente jamás debe pedir ni repetir (ver prompt v1.1.0)."""


class RedactingFilter(logging.Filter):
    """Filtro de logging que enmascara PII en el mensaje ya formateado.

    Se instala en los handlers del logger raíz (no en los loggers) para que
    aplique también a los registros que propagan desde ``uvicorn`` y
    ``app.*``. Modifica ``record.msg``/``record.args`` in-place después de
    formatear, así el formato original del mensaje no se pierde.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001 - un mensaje mal formateado no debe romper el logging
            return True
        redacted = redact(message)
        if redacted != message:
            record.msg = redacted
            record.args = ()
        return True


def install_log_redaction(logger: logging.Logger | None = None) -> None:
    """Agrega ``RedactingFilter`` a todos los handlers del logger (raíz por defecto)."""
    target = logger or logging.getLogger()
    for handler in target.handlers:
        if not any(isinstance(f, RedactingFilter) for f in handler.filters):
            handler.addFilter(RedactingFilter())
