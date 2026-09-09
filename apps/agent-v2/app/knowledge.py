"""Conocimiento del negocio: markdown plano cargado a memoria.

El v1 hacía recuperación por trigramas; aquí el documento entero cabe en el
contexto del modelo, y un documento completo evita las respuestas a medias que
salían cuando la búsqueda no traía la sección correcta.
"""

from __future__ import annotations

import functools
from pathlib import Path

from .config import get_settings

MAX_CHARS = 24_000


@functools.lru_cache(maxsize=1)
def load_knowledge() -> str:
    directory: Path = get_settings().knowledge_dir
    if not directory.is_dir():
        return ""
    parts: list[str] = []
    for path in sorted(directory.glob("*.md")):
        if path.name.upper().startswith("README"):
            continue
        try:
            parts.append(f"--- {path.name} ---\n{path.read_text(encoding='utf-8')}")
        except OSError:
            continue
    return "\n\n".join(parts)[:MAX_CHARS]


def reload_knowledge() -> str:
    load_knowledge.cache_clear()
    return load_knowledge()
