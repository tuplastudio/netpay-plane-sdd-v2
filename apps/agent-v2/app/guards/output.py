"""Guard de salida: revisa la respuesta del modelo antes de mandarla al canal.

El prompt le pide al modelo que no revele su configuración, no programe y no
invente enlaces; esto es la capa que no depende de que obedezca. Es
determinista (sin llamadas al LLM) y barata, así que corre en todos los
turnos.

Verificaciones, en orden:

1. **Secretos del proceso** (key de OpenRouter, llave interna, API key de
   commerce): si aparecen, se bloquea la respuesta.
2. **Fuga de prompt**: cualquier línea distintiva del prompt estático
   (``PromptVersion.protected_lines``) repetida literalmente → bloqueo.
3. **Fuga de notas internas**: cualquier nota ``> interno:`` del
   conocimiento repetida literalmente → bloqueo.
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


def _normalize(text: str) -> str:
    return " ".join((text or "").split()).lower()


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
        allowed_urls: Iterable[str] = (),
        seed: str = "",
    ) -> OutputVerdict:
        """Evalúa ``reply``; nunca lanza."""
        text = reply or ""
        if not text.strip():
            return OutputVerdict(True, text)
        seed = seed or text
        reasons: list[str] = []

        for secret in self._secrets():
            if secret in text:
                return OutputVerdict(False, _pick(_LEAK_REPLIES, seed, business), ["secreto"])

        normalized = _normalize(text)
        for line in protected_lines:
            candidate = _normalize(line)
            if len(candidate) >= 40 and candidate in normalized:
                return OutputVerdict(False, _pick(_LEAK_REPLIES, seed, business), ["fuga_prompt"])
        for note in internal_notes:
            candidate = _normalize(note)
            if len(candidate) >= 25 and candidate in normalized:
                return OutputVerdict(False, _pick(_LEAK_REPLIES, seed, business), ["fuga_nota_interna"])

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
