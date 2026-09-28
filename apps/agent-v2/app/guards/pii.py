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
CURP, y en modo agresivo cualquier secuencia de 6+ dígitos. `redact()` es
puro regex a propósito (la usa el filtro de logs en cada línea; no puede
cargar un modelo de NLP).

**Nombres y lugares** (`redact_names`, opcional): regex no detecta "Juan
Pérez" ni "Culiacán" como dato personal — para eso hace falta NER, no
patrones. Cuando `AGENT_PRESIDIO_ENABLED=1` y las dependencias están
instaladas (`presidio-analyzer`, `spacy` + el modelo `es_core_news_sm`),
`redact_names` corre Microsoft Presidio (entidades PERSON/LOCATION) sobre
texto YA pasado por `redact()`. Apagado de fábrica: el modelo de spaCy pesa
~15 MB y analizar cuesta más que un regex, así que solo vale la pena en los
puntos de más riesgo (memoria episódica, perfil de cliente), nunca en cada
línea de log. Si la librería falta, el modelo no está descargado, o el
análisis falla, se degrada a devolver el texto tal cual (nunca revienta el
turno ni deja de redactar lo que sí cubre el regex) — mismo principio de
"falla hacia el cliente" que el resto de las capas.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import unquote

from ..config import get_settings
from ..remote_config import get_bool as remote_bool

# Orden importa: lo más específico primero (tarjeta/CLABE antes que teléfono,
# CURP antes que RFC porque un CURP contiene un patrón parecido al RFC).
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", re.UNICODE)
_CURP_RE = re.compile(r"\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b", re.IGNORECASE)
_RFC_RE = re.compile(r"\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b", re.IGNORECASE)
# Grupos de dígitos separados por espacio/guion/punto: tarjeta, CLABE, teléfono.
_DIGIT_RUN_RE = re.compile(r"(?<![\w@])\+?\(?\d[\d\s().-]{5,24}\d(?![\w@])")
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


_logger = logging.getLogger(__name__)

_PRESIDIO_ENTITIES: dict[str, str] = {"PERSON": "[nombre]", "LOCATION": "[lugar]"}
_PRESIDIO_LANGUAGE = "es"
_PRESIDIO_MODEL = "es_core_news_sm"

# Estado del analizador, cacheado a nivel de proceso: cargar el modelo de
# spaCy toma un segundo largo, así que se hace una sola vez (al primer uso
# real, no al importar el módulo) y se reusa. `_presidio_broken=True` es
# permanente para el proceso: si falló una vez (librería ausente, modelo sin
# descargar), reintentar en cada turno no lo va a arreglar y solo agrega
# latencia — el próximo despliegue con las dependencias correctas sí lo toma.
_presidio_analyzer: Any = None
_presidio_broken = False


def _get_presidio_analyzer() -> Any:
    global _presidio_analyzer, _presidio_broken
    if _presidio_analyzer is not None or _presidio_broken:
        return _presidio_analyzer
    try:
        from presidio_analyzer import AnalyzerEngine
        from presidio_analyzer.nlp_engine import NlpEngineProvider

        provider = NlpEngineProvider(
            nlp_configuration={
                "nlp_engine_name": "spacy",
                "models": [{"lang_code": _PRESIDIO_LANGUAGE, "model_name": _PRESIDIO_MODEL}],
            }
        )
        _presidio_analyzer = AnalyzerEngine(
            nlp_engine=provider.create_engine(),
            supported_languages=[_PRESIDIO_LANGUAGE],
        )
    except Exception:  # noqa: BLE001 - librería/modelo ausente no debe tumbar el turno
        _logger.warning(
            "Presidio no disponible (falta presidio-analyzer, spacy o el modelo %s); "
            "redact_names() degrada a no-op",
            _PRESIDIO_MODEL,
            exc_info=True,
        )
        _presidio_broken = True
        _presidio_analyzer = None
    return _presidio_analyzer


def redact_names(text: str) -> str:
    """Enmascara nombres de persona y lugares detectados por NER (Presidio).

    No-op si `AGENT_PRESIDIO_ENABLED` está apagado (default) o si Presidio no
    está disponible. Pensado para encadenarse DESPUÉS de `redact()`, sobre
    texto que ya no tiene correos/teléfonos/tarjetas, no como sustituto.
    """
    if not text or not remote_bool("presidio_enabled", get_settings().presidio_enabled):
        return text or ""
    analyzer = _get_presidio_analyzer()
    if analyzer is None:
        return text
    try:
        results = analyzer.analyze(
            text=text, language=_PRESIDIO_LANGUAGE, entities=list(_PRESIDIO_ENTITIES)
        )
    except Exception:  # noqa: BLE001 - un fallo de análisis no debe perder el texto
        _logger.warning("Presidio falló analizando texto; se deja sin redacción de nombres", exc_info=True)
        return text
    if not results:
        return text
    out: list[str] = []
    cursor = 0
    for match in sorted(results, key=lambda r: r.start):
        if match.start < cursor:
            continue  # solapa con una entidad ya enmascarada
        out.append(text[cursor : match.start])
        out.append(_PRESIDIO_ENTITIES.get(match.entity_type, "[dato]"))
        cursor = match.end
    out.append(text[cursor:])
    return "".join(out)


def _redact_log_value(value: Any) -> Any:
    """Redacta un argumento de log de tipo texto; los demás pasan intactos.

    Se decodifica el percent-encoding antes: uvicorn loguea la ruta tal cual
    llegó, y en ``/conversations/t%3A5215512345678`` o ``?phone=%2B52…`` el
    ``%3A``/``%2B`` pegado a los dígitos impide que el regex vea el teléfono.
    """
    if not isinstance(value, str):
        return value
    decoded = unquote(value) if "%" in value else value
    redacted = redact(decoded)
    return redacted if redacted != decoded else value


class RedactingFilter(logging.Filter):
    """Filtro de logging que enmascara PII en mensaje, argumentos y traceback.

    Se instala en HANDLERS (un filtro de logger no aplica a lo que propaga
    desde loggers hijos): los del raíz y los de ``uvicorn``/``uvicorn.error``/
    ``uvicorn.access``, que uvicorn configura con ``propagate=False`` y
    handlers propios (ver ``install_log_redaction``).

    - ``record.args`` en tupla se redacta elemento por elemento conservando
      la forma: ``uvicorn``'s ``AccessFormatter`` desempaca
      ``(client, método, ruta, versión, status)`` de ``record.args`` y
      revienta si se sustituyen por ``()``.
    - Si aun así el mensaje formateado trae PII (en la plantilla misma o en
      un argumento no textual), se sustituye ``msg`` y se vacían ``args``,
      salvo en ``uvicorn.access`` (por lo anterior).
    - La excepción se formatea aquí y se redacta en ``record.exc_text``:
      ``Formatter.format`` reutiliza ``exc_text`` si ya viene puesto, así
      que un ``ValueError("... 5215512345678 ...")`` no sale en claro en el
      traceback. Igual con ``stack_info``.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            self._redact(record)
        except Exception:  # noqa: BLE001 - el filtro nunca debe tirar el log
            pass
        return True

    @staticmethod
    def _redact(record: logging.LogRecord) -> None:
        if isinstance(record.args, tuple) and record.args:
            record.args = tuple(_redact_log_value(a) for a in record.args)
        elif isinstance(record.args, dict) and record.args:
            record.args = {k: _redact_log_value(v) for k, v in record.args.items()}
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001 - un mensaje mal formateado no debe romper el logging
            message = None
        if message is not None and record.name != "uvicorn.access":
            redacted = _redact_log_value(message)
            if redacted != message:
                record.msg = redacted
                record.args = ()
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = redact(record.exc_text)
        if record.stack_info:
            record.stack_info = redact(record.stack_info)


# Loggers de uvicorn con handlers propios (y `propagate=False` en access):
# un filtro solo en el raíz no los alcanza.
_UVICORN_LOGGERS: tuple[str, ...] = ("uvicorn", "uvicorn.error", "uvicorn.access")


def _add_filter(handler: logging.Handler) -> None:
    if not any(isinstance(f, RedactingFilter) for f in handler.filters):
        handler.addFilter(RedactingFilter())


def install_log_redaction(logger: logging.Logger | None = None) -> None:
    """Instala ``RedactingFilter`` en los handlers donde de verdad se escribe.

    Con ``logger`` explícito, solo en los handlers de ese logger. Sin
    argumento (arranque del proceso, en el ``lifespan`` — es decir DESPUÉS
    de que uvicorn configuró su logging):

    1. Si el raíz no tiene handlers (lo normal bajo uvicorn: solo configura
       los suyos) se le agrega un ``StreamHandler``. Sin él, los logs de
       ``agent-v2``/``app.*`` salían por ``logging.lastResort``, que no pasa
       por ningún filtro. No se cambia el nivel del raíz.
    2. El filtro va en los handlers del raíz y en los de ``uvicorn``,
       ``uvicorn.error`` y ``uvicorn.access``.

    Idempotente: se puede llamar más de una vez.
    """
    if logger is not None:
        for handler in logger.handlers:
            _add_filter(handler)
        return
    root = logging.getLogger()
    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
        root.addHandler(handler)
    for target in (root, *(logging.getLogger(name) for name in _UVICORN_LOGGERS)):
        for handler in target.handlers:
            _add_filter(handler)
