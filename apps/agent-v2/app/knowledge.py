"""Conocimiento del negocio: markdown plano cargado a memoria.

Decisión: volcado completo, no recuperación por trigramas como v1
(`agent-service/app/knowledge.py` + `matching.py`). Con el corpus actual (4
archivos, ~14 KB en total, muy por debajo de `MAX_CHARS`) la recuperación por
score no aporta nada y sí puede fallar: la respuesta a "hola, algo sin azúcar
y también dime su horario" necesita dos secciones de dos archivos distintos a
la vez, y un `top_k` fijo puede no traer ambas. Volcar todo garantiza que la
FAQ, las políticas y el perfil del negocio siempre estén, cueste lo que cueste
en tokens. Si el catálogo de documentos crece mucho (varias decenas de KB, o
un tenant con muchos documentos propios), esto deja de escalar y vale la pena
portar la recuperación por secciones de v1 — no antes, sería complejidad sin
beneficio hoy.

Lo que sí se porta de v1 aunque se mantenga el volcado completo:
  - El frontmatter YAML de negocio.md define la identidad del agente (nombre,
    tono, saludo, horario...) para que cada negocio la edite sin tocar código.
  - Las líneas `> interno:` son guía para el agente (de dónde salió el dato,
    cuándo escalar, qué no prometer), NUNCA texto para citar al cliente. v1 las
    separaba del cuerpo público; aquí antes NO se separaban y el modelo veía
    el literal "> interno: ..." mezclado con el texto de venta, con riesgo de
    que lo repitiera tal cual. Ahora se extraen y se listan aparte, marcadas.
"""

from __future__ import annotations

import functools
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import get_settings

MAX_CHARS = 24_000

_INTERNAL_NOTE = re.compile(r"^\s*>\s*interno\s*:\s*(.*)$", re.IGNORECASE | re.MULTILINE)


@dataclass
class BusinessProfile:
    """Identidad del negocio, leída del frontmatter de `negocio.md`.

    Todo campo vacío se resuelve con un valor por defecto genérico en
    `prompts.py`; un tenant sin frontmatter sigue funcionando.
    """

    name: str = ""
    agent_name: str = ""
    tone: str = ""
    language: str = ""
    currency: str = ""
    hours: str = ""
    coverage: str = ""
    greeting: str = ""
    emoji: bool | None = None
    extra: dict[str, str] = field(default_factory=dict)


def _parse_frontmatter(raw: str) -> tuple[dict[str, str], str]:
    """Frontmatter YAML simple `clave: valor` (sin dependencias externas)."""
    if not raw.startswith("---"):
        return {}, raw
    end = raw.find("\n---", 3)
    if end == -1:
        return {}, raw
    header = raw[3:end].strip("\n")
    body = raw[end + 4 :].lstrip("\n")
    meta: dict[str, str] = {}
    for line in header.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip().lower()] = value.strip().strip('"').strip("'")
    return meta, body


_PROFILE_KEYS = {
    "negocio": "name", "name": "name", "empresa": "name",
    "agente": "agent_name", "agent": "agent_name", "asistente": "agent_name",
    "tono": "tone", "tone": "tone",
    "idioma": "language", "language": "language",
    "moneda": "currency", "currency": "currency",
    "horario": "hours", "horarios": "hours", "hours": "hours",
    "cobertura": "coverage", "zona": "coverage",
    "saludo": "greeting", "greeting": "greeting",
}


def _merge_profile(base: BusinessProfile, meta: dict[str, str]) -> BusinessProfile:
    values = {
        "name": base.name, "agent_name": base.agent_name, "tone": base.tone,
        "language": base.language, "currency": base.currency, "hours": base.hours,
        "coverage": base.coverage, "greeting": base.greeting, "emoji": base.emoji,
    }
    extra = dict(base.extra)
    for key, value in meta.items():
        if key in {"emoji", "emojis"}:
            values["emoji"] = value.lower() in {"1", "true", "si", "sí", "yes", "on"}
        elif key in _PROFILE_KEYS:
            values[_PROFILE_KEYS[key]] = value
        else:
            extra[key] = value
    return BusinessProfile(**values, extra=extra)  # type: ignore[arg-type]


def _split_internal_notes(body: str) -> tuple[str, list[str]]:
    """Saca las líneas `> interno:` del cuerpo público y las regresa aparte."""
    notes = [m.group(1).strip() for m in _INTERNAL_NOTE.finditer(body) if m.group(1).strip()]
    public = _INTERNAL_NOTE.sub("", body)
    # Colapsa las líneas en blanco que deja el hueco de la nota removida.
    public = re.sub(r"\n{3,}", "\n\n", public).strip()
    return public, notes


@dataclass
class _Loaded:
    text: str
    profile: BusinessProfile


def _load() -> _Loaded:
    directory: Path = get_settings().knowledge_dir
    profile = BusinessProfile()
    if not directory.is_dir():
        return _Loaded(text="", profile=profile)

    doc_parts: list[str] = []
    all_notes: list[str] = []
    for path in sorted(directory.glob("*.md")):
        if path.name.upper().startswith("README"):
            continue
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError:
            continue
        meta, body = _parse_frontmatter(raw)
        if meta:
            profile = _merge_profile(profile, meta)
        public, notes = _split_internal_notes(body)
        if public:
            doc_parts.append(f"--- {path.name} ---\n{public}")
        all_notes.extend(f"({path.name}) {n}" for n in notes)

    text = "\n\n".join(doc_parts)
    if all_notes:
        text += (
            "\n\n--- NOTAS INTERNAS (guía para ti, el cliente nunca las escribió ni "
            "debe leerlas: no las repitas ni las cites literalmente) ---\n"
            + "\n".join(f"- {n}" for n in all_notes)
        )
    return _Loaded(text=text[:MAX_CHARS], profile=profile)


@functools.lru_cache(maxsize=1)
def _cached() -> _Loaded:
    return _load()


def load_knowledge() -> str:
    return _cached().text


def load_profile() -> BusinessProfile:
    return _cached().profile


def reload_knowledge() -> str:
    _cached.cache_clear()
    return load_knowledge()
