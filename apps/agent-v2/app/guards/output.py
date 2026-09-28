"""Guard de salida: revisa la respuesta del modelo antes de mandarla al canal.

El prompt le pide al modelo que no revele su configuración, no programe y no
invente enlaces; esto es la capa que no depende de que obedezca. Es
determinista (sin llamadas al LLM) y barata, así que corre en todos los
turnos.

Verificaciones, en orden:

1. **Secretos del proceso** (key de OpenRouter, llave interna, API key de
   commerce): si aparecen, se bloquea la respuesta.
2. **Fuga de prompt**: cualquier línea distintiva del prompt estático
   (``PromptVersion.protected_lines``) repetida literalmente —comparando
   tokens normalizados, así que cambiar puntuación, acentos o poner una
   palabra por renglón no la esconde— → bloqueo.
3. **Fuga de notas internas y contenido dinámico**: notas ``> interno:``,
   reglas del negocio (``extra_rules``, sin lo entrecomillado), ``<lecciones>``
   (``protected_blocks``) y temas prohibidos / ``<memoria_cliente>``
   (``recitation_blocks``). Además de la comparación literal, se detecta
   copia casi literal por shingles de 8 tokens (ver ``shingle_leak``) → bloqueo.
4. **Código / formatos ajenos al chat**: bloques ``\`\`\```, ``def ...(``,
   ``SELECT ... FROM``, JSON largo → bloqueo (fuera de alcance).
5. **Datos sensibles** (tarjeta, CLABE, CURP): se enmascaran, la respuesta
   sigue (``modified=True``).
6. **URLs no autorizadas**: toda URL de la respuesta debe haber salido de una
   herramienta de esta conversación, del conocimiento del negocio o colgar
   de ``PUBLIC_BASE_URL``. Las demás se sustituyen por un aviso.

Cuando se bloquea, el canal recibe un mensaje de redirección estable (mismo
mensaje para el mismo turno), y ``main.py`` sustituye el ``AIMessage`` en el
hilo para que la fuga tampoco quede en el historial que verá el modelo en el
siguiente turno.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable

from ..config import Settings, get_settings
from . import pii

_URL_RE = re.compile(r"https?://[^\s<>()\"']+", re.IGNORECASE)
_CODE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"```"),
    re.compile(r"(^|\n)\s*(def|class)\s+\w+\s*[(:]", re.IGNORECASE),
    re.compile(r"(^|\n)\s*(import\s+\w+|from\s+\w+\s+import\s+\w+)", re.IGNORECASE),
    re.compile(r"(^|\n)\s*(function\s+\w+\s*\(|const\s+\w+\s*=\s*\(|let\s+\w+\s*=|var\s+\w+\s*=)"),
    re.compile(r"\bSELECT\s+.+?\s+FROM\s+\w+", re.IGNORECASE | re.DOTALL),
    re.compile(r"(^|\n)\s*#include\s*<|<\?php", re.IGNORECASE),
    re.compile(r"(^|\n)\s*\{\s*\"\w+\"\s*:\s*.{20,}\}\s*$", re.DOTALL),
)

_LEAK_REPLIES: tuple[str, ...] = (
    "Eso no te lo puedo compartir 🙂 ¿Seguimos con lo de {business}?",
    "Ahí sí no puedo entrar en detalles. Si buscas algo de {business}, dime qué necesitas.",
)
_OFF_SCOPE_REPLIES: tuple[str, ...] = (
    "Uy, de eso no te puedo ayudar por aquí 🙂 Pero si buscas algo de {business}, dime qué necesitas.",
    "Eso se me sale de lo mío. Aquí te ayudo con productos, precios y pedidos de {business}.",
)
_URL_PLACEHOLDER = "[enlace no disponible]"


def _pick(options: tuple[str, ...], seed: str, business: str) -> str:
    digest = hashlib.md5(seed.encode("utf-8")).digest()
    return options[digest[0] % len(options)].format(business=business or "nosotros")


# ---- Detección por shingles (fugas "casi literales") ----
#
# La comparación literal no ve una fuga con la puntuación cambiada, una
# palabra por renglón o acentos quitados. Se compara en TOKENS normalizados
# (minúsculas, sin acentos, solo letras/dígitos) y en shingles de
# `SHINGLE_SIZE` tokens seguidos: un shingle de 8 palabras idénticas casi
# nunca aparece por casualidad en una respuesta de venta.
SHINGLE_SIZE = 8
# Un renglón protegido se da por filtrado si al menos este porcentaje de
# sus shingles aparece en la respuesta (y al menos `_MIN_SEGMENT_HITS`)...
SHINGLE_RATIO = 0.30
_MIN_SEGMENT_HITS = 3
# ...o si la respuesta copia una racha de shingles CONSECUTIVOS del bloque
# (6 shingles = 13 tokens seguidos), aunque el bloque sea largo.
SHINGLE_RUN = 6
_TOKEN_RE = re.compile(r"\w+", re.UNICODE)
# Texto entre comillas en las reglas del negocio suele ser un guion que el
# bot SÍ debe decir ("responde: “los envíos tardan 3 a 5 días”"): no se
# protege, o cada respuesta que lo use se bloquearía.
_QUOTED_RE = re.compile(r"\"[^\"\n]*\"|“[^”\n]*”|«[^»\n]*»")


def tokens(text: str) -> list[str]:
    """Tokens normalizados: minúsculas, sin diacríticos, solo ``\\w+``."""
    folded = unicodedata.normalize("NFKD", (text or "").lower())
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
    return _TOKEN_RE.findall(folded)


def _shingles(toks: list[str], size: int = SHINGLE_SIZE) -> list[tuple[str, ...]]:
    return [tuple(toks[i : i + size]) for i in range(len(toks) - size + 1)]


def strip_quoted(text: str) -> str:
    """Quita los fragmentos entre comillas (guiones que el bot sí dice)."""
    return _QUOTED_RE.sub(" ", text or "")


def shingle_leak(reply_shingles: set[tuple[str, ...]], block: str, *, ratio: bool = True) -> bool:
    """¿La respuesta reproduce ``block`` casi literal?

    - Racha: ``SHINGLE_RUN`` shingles consecutivos del bloque presentes en la
      respuesta (siempre).
    - Proporción (``ratio=True``): algún renglón del bloque con al menos
      ``_MIN_SEGMENT_HITS`` shingles y ``SHINGLE_RATIO`` de ellos presentes.
      Se mide por renglón para que una regla larga no diluya la fuga de uno.
    """
    if not reply_shingles:
        return False
    run = 0
    for shingle in _shingles(tokens(block)):
        run = run + 1 if shingle in reply_shingles else 0
        if run >= SHINGLE_RUN:
            return True
    if not ratio:
        return False
    for segment in (block or "").splitlines():
        seg = _shingles(tokens(segment))
        if len(seg) < _MIN_SEGMENT_HITS:
            continue
        hits = sum(1 for s in seg if s in reply_shingles)
        if hits >= _MIN_SEGMENT_HITS and hits / len(seg) >= SHINGLE_RATIO:
            return True
    return False


@dataclass
class OutputVerdict:
    """Resultado del guard: ``reply`` es lo que debe salir al canal."""

    allowed: bool
    reply: str
    reasons: list[str] = field(default_factory=list)
    modified: bool = False

    @property
    def changed(self) -> bool:
        return (not self.allowed) or self.modified


def extract_urls(text: str) -> set[str]:
    return {m.group(0).rstrip(".,;:") for m in _URL_RE.finditer(text or "")}


class OutputGuard:
    """Ver el docstring del módulo. Sin estado entre llamadas."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    def _secrets(self) -> tuple[str, ...]:
        return tuple(
            s
            for s in (
                self.settings.openrouter_key,
                self.settings.internal_key,
                self.settings.commerce_api_key,
            )
            if s and len(s) >= 8
        )

    def check(
        self,
        reply: str,
        *,
        business: str = "",
        protected_lines: Iterable[str] = (),
        internal_notes: Iterable[str] = (),
        protected_blocks: Iterable[str] = (),
        recitation_blocks: Iterable[str] = (),
        allowed_urls: Iterable[str] = (),
        seed: str = "",
    ) -> OutputVerdict:
        """Evalúa ``reply``; nunca lanza.

        ``protected_blocks``: contenido dinámico que el cliente nunca debe
        leer (reglas del negocio, ``<lecciones>``); se revisa por racha y por
        proporción de shingles. ``recitation_blocks``: contenido que el bot
        puede USAR pero no recitar (temas prohibidos, ``<memoria_cliente>``):
        solo por racha, para no bloquear un "¿seguimos con la pintura blanca
        que te interesó?". Las notas internas cuentan como protegidas.
        """
        text = reply or ""
        if not text.strip():
            return OutputVerdict(True, text)
        seed = seed or text
        reasons: list[str] = []

        for secret in self._secrets():
            if secret in text:
                return OutputVerdict(False, _pick(_LEAK_REPLIES, seed, business), ["secreto"])

        # Literal, pero sobre tokens normalizados: sobrevive a puntuación
        # cambiada, acentos quitados y una palabra por renglón.
        reply_tokens = tokens(text)
        joined = f" {' '.join(reply_tokens)} "
        for line in protected_lines:
            candidate = " ".join(tokens(line))
            if len(candidate) >= 40 and f" {candidate} " in joined:
                return OutputVerdict(False, _pick(_LEAK_REPLIES, seed, business), ["fuga_prompt"])
        notes = [n for n in internal_notes if n]
        for note in notes:
            candidate = " ".join(tokens(note))
            if len(candidate) >= 25 and f" {candidate} " in joined:
                return OutputVerdict(False, _pick(_LEAK_REPLIES, seed, business), ["fuga_nota_interna"])

        reply_shingles = set(_shingles(reply_tokens))
        if reply_shingles:
            if any(shingle_leak(reply_shingles, note) for note in notes):
                return OutputVerdict(False, _pick(_LEAK_REPLIES, seed, business), ["fuga_nota_interna"])
            if any(shingle_leak(reply_shingles, block) for block in protected_blocks if block):
                return OutputVerdict(False, _pick(_LEAK_REPLIES, seed, business), ["fuga_contenido_protegido"])
            if any(shingle_leak(reply_shingles, block, ratio=False) for block in recitation_blocks if block):
                return OutputVerdict(False, _pick(_LEAK_REPLIES, seed, business), ["fuga_contenido_protegido"])

        for pattern in _CODE_PATTERNS:
            if pattern.search(text):
                return OutputVerdict(
                    False, _pick(_OFF_SCOPE_REPLIES, seed, business), ["codigo_en_respuesta"]
                )

        modified = False
        if pii.contains_pii(text, kinds=pii.SENSITIVE_KINDS):
            matches = [m for m in pii.detect(text) if m.kind in pii.SENSITIVE_KINDS]
            for match in sorted(matches, key=lambda m: m.start, reverse=True):
                text = text[: match.start] + pii.MASKS[match.kind] + text[match.end :]
            reasons.append("pii_sensible_enmascarada")
            modified = True

        allowed = {u.rstrip("/") for u in allowed_urls}
        public_base = (self.settings.public_base_url or "").rstrip("/")
        for url in sorted(extract_urls(text), key=len, reverse=True):
            clean = url.rstrip("/")
            if clean in allowed or (public_base and clean.startswith(public_base)):
                continue
            text = text.replace(url, _URL_PLACEHOLDER)
            reasons.append("url_no_autorizada")
            modified = True

        return OutputVerdict(True, text, reasons, modified)


def urls_from_messages(messages: Iterable[object]) -> set[str]:
    """URLs devueltas por herramientas en el hilo (las únicas que el modelo puede citar)."""
    found: set[str] = set()
    for message in messages:
        if message.__class__.__name__ != "ToolMessage":
            continue
        content = getattr(message, "content", "")
        if isinstance(content, str):
            found |= extract_urls(content)
    return found
