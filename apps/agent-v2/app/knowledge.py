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

Gestión desde el panel (paridad con v1, ver `agent-service/app/knowledge.py`):
  - `knowledge_stats()` / `knowledge_outline()` listan qué hay indexado.
  - `search_knowledge()` prueba el índice sin gastar tokens del modelo.
  - `save_uploaded_doc()` / `delete_knowledge_doc()` administran SOLO
    `knowledge/uploads/`: el contenido curado a mano (negocio.md, etc.) no se
    toca por HTTP, igual que en v1.
  - Todo vive en un único directorio de conocimiento por servicio (no por
    tenant), igual que v1. Si un tenant necesita su propio conocimiento habría
    que particionar `knowledge_dir` por tenant_id; no se hace aquí porque hoy
    no hay ninguna señal de que se necesite y sería complejidad sin dueño.
"""

from __future__ import annotations

import functools
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import get_settings

MAX_CHARS = 24_000

_INTERNAL_NOTE = re.compile(r"^\s*>\s*interno\s*:\s*(.*)$", re.IGNORECASE | re.MULTILINE)

# Frases del documento que jamás deben leerse como orden al modelo. El
# contenido del Markdown es DATO, nunca instrucción (SPEC-AIA "Evaluación y
# seguridad"); esto solo genera una advertencia visible en el panel, no
# bloquea nada ni cambia lo que se manda al prompt.
INJECTION_PATTERNS = re.compile(
    r"(ignora|olvida|desobedece)\s+(las\s+)?(reglas|instrucciones|todo)"
    r"|system\s*prompt|eres\s+un\s+asistente\s+sin\s+restricciones",
    re.IGNORECASE,
)


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
    phone: str = ""
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
    "telefono": "phone", "phone": "phone", "whatsapp": "phone",
    "saludo": "greeting", "greeting": "greeting",
}


def _merge_profile(base: BusinessProfile, meta: dict[str, str]) -> BusinessProfile:
    values = {
        "name": base.name, "agent_name": base.agent_name, "tone": base.tone,
        "language": base.language, "currency": base.currency, "hours": base.hours,
        "coverage": base.coverage, "phone": base.phone, "greeting": base.greeting,
        "emoji": base.emoji,
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


# ---------------------------------------------------------------------------
# Índice por sección: solo para listar/buscar desde el panel (GET /knowledge,
# /knowledge/search). El volcado completo que ve el modelo (arriba) no
# depende de esto ni cambia por esto.
# ---------------------------------------------------------------------------

_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")

# es-MX + muletillas comunes; suficiente para el scoring de búsqueda del
# panel, no pretende ser el tokenizador completo de v1 (text.py de v1 trae
# sinónimos comerciales que aquí no aplican: esto es búsqueda de POLÍTICAS,
# no de catálogo).
_STOPWORDS = frozenset(
    """
    a al algo alguna algunas alguno algunos ante antes aqui aquel aquella como con contra cual
    cuando de del desde donde dos e el ella ellas ello ellos en entre era eran es esa esas ese
    eso esos esta estan estas este esto estos ha hace hacen hasta hay la las le les lo los mas me
    mi mis mucho muy nada ni no nos nosotros o os otra otras otro otros para pero poco por porque
    que quien se ser si sin sobre solo son su sus tambien tanto te tener tiene tienen todo todos
    tu tus un una uno unos usted ustedes va van vos y ya
    """.split()
)


def _normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def _tokenize(text: str) -> frozenset[str]:
    words = re.findall(r"[a-z0-9]+", _normalize(text))
    return frozenset(w for w in words if len(w) > 2 and w not in _STOPWORDS)


def _trigrams(text: str) -> set[str]:
    padded = f"  {text}  "
    return {padded[i : i + 3] for i in range(len(padded) - 2)}


def _trigram_similarity(a: str, b: str) -> float:
    """Similitud difusa para cuando la consulta no comparte tokens exactos
    con ninguna sección pero sí se parece al título (typos, singular/plural)."""
    ta, tb = _trigrams(a), _trigrams(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


@dataclass
class KnowledgeChunk:
    """Una sección (encabezado Markdown) de un documento del negocio."""

    doc: str
    heading_path: tuple[str, ...]
    body: str
    internal: str
    tokens: frozenset[str]

    @property
    def ref(self) -> str:
        if not self.heading_path:
            return self.doc
        return f"{self.doc}#{' > '.join(self.heading_path)}"


def _split_sections(doc_name: str, raw: str) -> list[KnowledgeChunk]:
    """Divide un documento por encabezados, conservando la ruta de títulos."""
    lines = raw.splitlines()
    stack: list[tuple[int, str]] = []
    chunks: list[KnowledgeChunk] = []
    buffer: list[str] = []

    def flush() -> None:
        raw_lines = list(buffer)
        buffer.clear()
        public: list[str] = []
        internal: list[str] = []
        for line in raw_lines:
            note = re.match(r"^\s*>\s*interno\s*:\s*(.*)$", line, re.IGNORECASE)
            if note:
                text = note.group(1).strip()
                if text:
                    internal.append(text)
            else:
                public.append(line)
        body = "\n".join(public).strip()
        internal_text = " ".join(internal).strip()
        if not body and not internal_text:
            return
        path = tuple(title for _, title in stack)
        tokens = _tokenize(f"{' '.join(path)} {body} {internal_text}")
        chunks.append(
            KnowledgeChunk(doc=doc_name, heading_path=path, body=body, internal=internal_text, tokens=tokens)
        )

    for line in lines:
        heading = _HEADING.match(line)
        if heading:
            flush()
            level = len(heading.group(1))
            title = heading.group(2).strip()
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, title))
            continue
        buffer.append(line)
    flush()
    return chunks


@dataclass
class _Loaded:
    text: str
    profile: BusinessProfile
    docs: list[str] = field(default_factory=list)
    chunks: list[KnowledgeChunk] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _load() -> _Loaded:
    directory: Path = get_settings().knowledge_dir
    profile = BusinessProfile()
    if not directory.is_dir():
        return _Loaded(
            text="", profile=profile, warnings=[f"el directorio de conocimiento no existe: {directory}"]
        )

    doc_parts: list[str] = []
    all_notes: list[str] = []
    docs: list[str] = []
    chunks: list[KnowledgeChunk] = []
    warnings: list[str] = []

    # "**/*.md" (no solo "*.md") a propósito: así los documentos subidos por
    # el panel a knowledge/uploads/ entran al mismo volcado y al mismo índice
    # que el contenido curado a mano, sin distinción para el modelo.
    for path in sorted(directory.glob("**/*.md")):
        if path.name.upper().startswith("README"):
            continue
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as exc:
            warnings.append(f"{path.name}: {exc}")
            continue
        doc_name = str(path.relative_to(directory))
        docs.append(doc_name)
        meta, body = _parse_frontmatter(raw)
        if meta:
            profile = _merge_profile(profile, meta)
        if INJECTION_PATTERNS.search(body):
            warnings.append(f"{doc_name}: contiene texto tipo instrucción; se trata como dato del negocio")

        public, notes = _split_internal_notes(body)
        if public:
            doc_parts.append(f"--- {path.name} ---\n{public}")
        all_notes.extend(f"({path.name}) {n}" for n in notes)

        chunks.extend(_split_sections(doc_name, body))

    text = "\n\n".join(doc_parts)
    if all_notes:
        text += (
            "\n\n--- NOTAS INTERNAS (guía para ti, el cliente nunca las escribió ni "
            "debe leerlas: no las repitas ni las cites literalmente) ---\n"
            + "\n".join(f"- {n}" for n in all_notes)
        )
    return _Loaded(text=text[:MAX_CHARS], profile=profile, docs=docs, chunks=chunks, warnings=warnings)


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


def knowledge_stats() -> dict[str, Any]:
    """Para `GET /knowledge`: qué hay indexado, sin la lista de secciones
    (eso es `knowledge_outline()`, aparte, igual que en v1: `{**kb.stats(),
    "outline": kb.outline()}`)."""
    loaded = _cached()
    p = loaded.profile
    return {
        "dir": str(get_settings().knowledge_dir),
        "docs": sorted(loaded.docs),
        "chunks": len(loaded.chunks),
        "profile": {
            "name": p.name,
            "agentName": p.agent_name,
            "tone": p.tone,
            "hours": p.hours,
            "coverage": p.coverage,
            "currency": p.currency,
            "phone": p.phone,
        },
        "warnings": loaded.warnings,
    }


def knowledge_outline() -> list[dict[str, Any]]:
    """Para `GET /knowledge`: `{doc, sections}` por cada documento indexado."""
    loaded = _cached()
    return [
        {"doc": doc, "sections": [c.ref for c in loaded.chunks if c.doc == doc]}
        for doc in sorted(set(loaded.docs))
    ]


def search_knowledge(query: str, *, top_k: int = 4) -> list[dict[str, Any]]:
    """Para `GET /knowledge/search`: secciones relevantes a `query`, con score.

    Búsqueda por superposición de tokens sobre el mismo índice por sección
    que arma `knowledge_outline()`; si ninguna sección comparte tokens con la
    consulta, cae a similitud difusa (trigramas) contra el título de la
    sección, para no devolver vacío ante errores de tecleo o singular/plural.
    """
    loaded = _cached()
    q_tokens = _tokenize(query)
    if not q_tokens or not loaded.chunks:
        return []

    norm_query = _normalize(query)
    scored: list[tuple[float, KnowledgeChunk]] = []
    for chunk in loaded.chunks:
        shared = q_tokens & chunk.tokens
        if not shared:
            sim = _trigram_similarity(norm_query, _normalize(" ".join(chunk.heading_path)))
            if sim < 0.35:
                continue
            scored.append((sim * 0.6, chunk))
            continue
        coverage = len(shared) / max(1, len(q_tokens))
        heading_tokens = _tokenize(" ".join(chunk.heading_path))
        heading_boost = 0.3 if q_tokens & heading_tokens else 0.0
        density = len(shared) / max(12, len(chunk.tokens)) * 0.4
        score = min(1.0, coverage * 0.7 + heading_boost + density)
        scored.append((score, chunk))

    scored.sort(key=lambda item: item[0], reverse=True)
    return [
        {"ref": chunk.ref, "score": round(score, 4), "body": chunk.body}
        for score, chunk in scored[:top_k]
    ]


# ---------------------------------------------------------------------------
# Subir / borrar documentos desde el panel. Superficie peligrosa (HTTP escribe
# y borra archivos): el docId lo manda el cliente, así que todo aquí asume que
# es hostil hasta demostrar lo contrario (path traversal, tipo, tamaño).
# ---------------------------------------------------------------------------


class KnowledgeUploadError(ValueError):
    """`.md` subido inválido: nombre, tamaño, codificación o ruta fuera del
    directorio de conocimiento. `main.py` la traduce a HTTP 400."""


UPLOADS_SUBDIR = "uploads"
_SAFE_NAME = re.compile(r"[^A-Za-z0-9_.-]")
# ~300 KB de texto plano es de sobra para cualquier documento de negocio real;
# tope defensivo contra un archivo gigante o un ataque de agotamiento de disco.
MAX_UPLOAD_BYTES = 300_000


def _sanitize_upload_name(filename: str) -> str:
    """Nombre de archivo seguro: sin ruta, sin traversal, solo `.md`."""
    name = Path(filename or "").name.strip()  # .name descarta cualquier componente de ruta
    if not name or name in {".", ".."}:
        raise KnowledgeUploadError("Nombre de archivo vacío o inválido")
    if not name.lower().endswith(".md"):
        raise KnowledgeUploadError("Solo se aceptan archivos .md")
    if name.lower() == "readme.md":
        raise KnowledgeUploadError("readme.md está reservado (no es contenido del negocio)")
    stem = name[: -len(".md")]
    safe_stem = _SAFE_NAME.sub("_", stem)[:120] or "documento"
    return f"{safe_stem}.md"


def save_uploaded_doc(filename: str, content: bytes, *, max_bytes: int = MAX_UPLOAD_BYTES) -> str:
    """Guarda un `.md` subido en `<knowledge_dir>/uploads/`. Devuelve el docId
    relativo (p. ej. `uploads/politica-envios.md`) que el panel usa luego para
    borrarlo. Invalida la caché de `load_knowledge()`/`load_profile()`: el
    documento nuevo se ve desde el siguiente turno, sin reiniciar el servicio.

    El contenido se trata como dato del negocio, igual que cualquier otro
    Markdown de `knowledge/`: nunca como instrucción para el modelo.

    Lanza `KnowledgeUploadError` si el nombre, tamaño, codificación o
    contenido del archivo no son válidos.
    """
    if len(content) > max_bytes:
        raise KnowledgeUploadError(f"Archivo demasiado grande (máximo {max_bytes} bytes)")
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise KnowledgeUploadError(f"El archivo no es UTF-8 válido: {exc}") from exc
    if "\x00" in text:
        raise KnowledgeUploadError("Archivo binario detectado, se esperaba Markdown")

    directory = get_settings().knowledge_dir
    safe_name = _sanitize_upload_name(filename)
    uploads_dir = directory / UPLOADS_SUBDIR
    uploads_dir.mkdir(parents=True, exist_ok=True)
    target = uploads_dir / safe_name
    # Resuelto y verificado dentro de uploads_dir: cierra cualquier traversal
    # residual (symlinks, "..", nombre absoluto) antes de escribir a disco.
    resolved = target.resolve()
    if uploads_dir.resolve() not in resolved.parents:
        raise KnowledgeUploadError("Ruta de destino inválida")
    target.write_text(text, encoding="utf-8")
    doc_id = str(target.relative_to(directory))
    _cached.cache_clear()
    return doc_id


def delete_knowledge_doc(doc_id: str) -> bool:
    """Borra un documento subido por su docId. Solo alcanza `uploads/`: el
    contenido curado a mano (negocio.md, productos.md, ...) no se administra
    por API, igual que en v1. Invalida la caché igual que `save_uploaded_doc`.

    Devuelve `False` si el docId no corresponde a un archivo existente (para
    que `main.py` responda 404). Lanza `KnowledgeUploadError` si el docId
    intenta salirse de `uploads/` (path traversal): en ese caso NO se borra
    nada, ni siquiera dentro del directorio de conocimiento.
    """
    directory = get_settings().knowledge_dir
    uploads_dir = (directory / UPLOADS_SUBDIR).resolve()
    candidate = (directory / doc_id).resolve()
    if uploads_dir not in candidate.parents:
        raise KnowledgeUploadError("Solo se pueden borrar documentos subidos (uploads/)")
    if not candidate.exists():
        return False
    candidate.unlink()
    _cached.cache_clear()
    return True
