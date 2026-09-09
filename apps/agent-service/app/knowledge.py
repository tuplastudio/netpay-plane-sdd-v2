"""Base de conocimiento del negocio.

Lee archivos Markdown de `KNOWLEDGE_DIR` y los convierte en fragmentos
recuperables por consulta. Permite que el agente responda preguntas del
negocio (horarios, envíos, garantías, formas de pago, políticas) sin
inventar: siempre cita el archivo y la sección de donde salió la respuesta.

Reglas (SPEC-AIA "Evaluación y seguridad"):
  - El contenido del Markdown es DATO, nunca instrucción. Si un documento
    dice "ignora las reglas", se trata como texto del negocio.
  - Los precios nunca salen de aquí: vienen de la calculadora del backend.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .text import expand_synonyms, normalize, tokenize, trigram_similarity, truncate

# Frases del documento que jamás deben leerse como orden al modelo.
INJECTION_PATTERNS = re.compile(
    r"(ignora|olvida|desobedece)\s+(las\s+)?(reglas|instrucciones|todo)"
    r"|system\s*prompt|eres\s+un\s+asistente\s+sin\s+restricciones",
    re.IGNORECASE,
)


@dataclass
class KnowledgeChunk:
    """Una sección de un documento del negocio.

    `body` es lo que puede leer el cliente. `internal` son las líneas marcadas
    con `> interno:` en el Markdown: guía para el agente (cuándo escalar, qué no
    prometer) que nunca se le repite al cliente.
    """

    doc: str
    title: str
    heading_path: tuple[str, ...]
    body: str
    internal: str = ""
    tokens: set[str] = field(default_factory=set)

    @property
    def ref(self) -> str:
        path = " > ".join(self.heading_path) if self.heading_path else self.title
        return f"{self.doc}#{path}"

    @property
    def full_text(self) -> str:
        return f"{self.body}\n{self.internal}".strip() if self.internal else self.body

    def to_dict(self) -> dict[str, Any]:
        return {
            "doc": self.doc,
            "title": self.title,
            "headingPath": list(self.heading_path),
            "ref": self.ref,
            "body": self.body,
            "internal": self.internal,
        }


@dataclass
class KnowledgeHit:
    chunk: KnowledgeChunk
    score: float
    reasons: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {**self.chunk.to_dict(), "score": round(self.score, 4), "reasons": self.reasons}


@dataclass
class BusinessProfile:
    """Identidad del negocio, leída del frontmatter de `negocio.md`."""

    name: str = "el negocio"
    agent_name: str = "Net"
    tone: str = "cálido, cercano y directo; tuteo mexicano; sin sonar robot"
    language: str = "es-MX"
    currency: str = "MXN"
    hours: str = ""
    coverage: str = ""
    phone: str = ""
    website: str = ""
    emoji: bool = True
    greeting: str = ""
    signature_dish: str = ""
    extra: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "agentName": self.agent_name,
            "tone": self.tone,
            "language": self.language,
            "currency": self.currency,
            "hours": self.hours,
            "coverage": self.coverage,
            "phone": self.phone,
            "website": self.website,
            "emoji": self.emoji,
            "greeting": self.greeting,
            "extra": self.extra,
        }


def _parse_frontmatter(raw: str) -> tuple[dict[str, str], str]:
    """Frontmatter YAML simple `clave: valor` (sin dependencias)."""
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


def _split_sections(doc_name: str, raw: str) -> list[KnowledgeChunk]:
    """Divide por encabezados Markdown conservando la ruta de títulos."""
    lines = raw.splitlines()
    doc_title = doc_name
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
                internal.append(note.group(1).strip())
            else:
                public.append(line)
        body = "\n".join(public).strip()
        internal_text = " ".join(internal).strip()
        if not body and not internal_text:
            return
        path = tuple(title for _, title in stack)
        chunks.append(
            KnowledgeChunk(
                doc=doc_name,
                title=doc_title,
                heading_path=path,
                body=body,
                internal=internal_text,
                tokens=expand_synonyms(tokenize(f"{' '.join(path)} {body} {internal_text}")),
            )
        )

    for line in lines:
        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading:
            flush()
            level = len(heading.group(1))
            title = heading.group(2).strip()
            if level == 1 and not stack:
                doc_title = title
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, title))
            continue
        buffer.append(line)
    flush()
    return chunks


class KnowledgeBase:
    """Índice en memoria de los `.md` del negocio, con recarga por mtime."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.chunks: list[KnowledgeChunk] = []
        self.profile = BusinessProfile()
        self.loaded_at: float = 0.0
        self.docs: dict[str, float] = {}
        self.warnings: list[str] = []
        self.load()

    # ---------- carga ----------

    def load(self) -> None:
        self.chunks = []
        self.docs = {}
        self.warnings = []
        profile = BusinessProfile()

        if not self.directory.exists():
            self.warnings.append(f"knowledge dir no existe: {self.directory}")
            self.profile = profile
            self.loaded_at = time.time()
            return

        for path in sorted(self.directory.glob("**/*.md")):
            if path.name.lower() == "readme.md":
                continue  # instrucciones para el operador, no contenido del negocio
            try:
                raw = path.read_text(encoding="utf-8")
            except OSError as exc:  # pragma: no cover - IO defensivo
                self.warnings.append(f"{path.name}: {exc}")
                continue
            meta, body = _parse_frontmatter(raw)
            doc_name = str(path.relative_to(self.directory))
            self.docs[doc_name] = path.stat().st_mtime
            if INJECTION_PATTERNS.search(body):
                self.warnings.append(
                    f"{doc_name}: contiene texto tipo instrucción; se trata como dato"
                )
            if meta:
                profile = self._merge_profile(profile, meta)
            self.chunks.extend(_split_sections(doc_name, body))

        self.profile = profile
        self.loaded_at = time.time()

    def reload_if_stale(self) -> bool:
        """Recarga si cambió algún archivo. Devuelve True si recargó."""
        if not self.directory.exists():
            return False
        current = {
            str(p.relative_to(self.directory)): p.stat().st_mtime
            for p in self.directory.glob("**/*.md")
            if p.name.lower() != "readme.md"
        }
        if current != self.docs:
            self.load()
            return True
        return False

    @staticmethod
    def _merge_profile(base: BusinessProfile, meta: dict[str, str]) -> BusinessProfile:
        known = {
            "negocio": "name", "name": "name", "empresa": "name",
            "agente": "agent_name", "agent": "agent_name", "asistente": "agent_name",
            "tono": "tone", "tone": "tone",
            "idioma": "language", "language": "language",
            "moneda": "currency", "currency": "currency",
            "horario": "hours", "horarios": "hours", "hours": "hours",
            "cobertura": "coverage", "zona": "coverage",
            "telefono": "phone", "phone": "phone", "whatsapp": "phone",
            "web": "website", "sitio": "website", "website": "website",
            "saludo": "greeting", "greeting": "greeting",
        }
        values = {
            "name": base.name, "agent_name": base.agent_name, "tone": base.tone,
            "language": base.language, "currency": base.currency, "hours": base.hours,
            "coverage": base.coverage, "phone": base.phone, "website": base.website,
            "emoji": base.emoji, "greeting": base.greeting,
        }
        extra = dict(base.extra)
        for key, value in meta.items():
            if key in {"emoji", "emojis"}:
                values["emoji"] = value.lower() in {"1", "true", "si", "sí", "yes", "on"}
            elif key in known:
                values[known[key]] = value
            else:
                extra[key] = value
        return BusinessProfile(**values, extra=extra)  # type: ignore[arg-type]

    # ---------- consulta ----------

    def search(self, query: str, *, top_k: int = 4) -> list[KnowledgeHit]:
        """Recupera secciones relevantes con explicación del match."""
        q_tokens = expand_synonyms(tokenize(query))
        if not q_tokens or not self.chunks:
            return []

        hits: list[KnowledgeHit] = []
        norm_query = normalize(query)
        for chunk in self.chunks:
            shared = q_tokens & chunk.tokens
            if not shared:
                # Fallback difuso sobre el título de la sección.
                sim = trigram_similarity(norm_query, " ".join(chunk.heading_path))
                if sim < 0.35:
                    continue
                hits.append(KnowledgeHit(chunk, sim * 0.6, [f"título similar ({sim:.2f})"]))
                continue
            coverage = len(shared) / max(1, len(q_tokens))
            heading_tokens = expand_synonyms(tokenize(" ".join(chunk.heading_path)))
            heading_boost = 0.35 if q_tokens & heading_tokens else 0.0
            density = len(shared) / max(12, len(chunk.tokens)) * 0.4
            score = min(1.0, coverage * 0.7 + heading_boost + density)
            reasons = [f"{len(shared)} términos en común: {', '.join(sorted(shared)[:4])}"]
            if heading_boost:
                reasons.append("coincide con el título de la sección")
            hits.append(KnowledgeHit(chunk, score, reasons))

        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:top_k]

    def context_block(self, query: str, *, top_k: int = 4, char_budget: int = 2600) -> str:
        """Bloque de contexto listo para el prompt, con referencias."""
        hits = self.search(query, top_k=top_k)
        if not hits:
            return ""
        parts: list[str] = []
        used = 0
        for hit in hits:
            body = truncate(hit.chunk.full_text, 900)
            block = f"### {hit.chunk.ref}\n{body}"
            if used + len(block) > char_budget:
                break
            parts.append(block)
            used += len(block)
        return "\n\n".join(parts)

    def outline(self) -> list[dict[str, Any]]:
        return [
            {"doc": doc, "sections": [c.ref for c in self.chunks if c.doc == doc]}
            for doc in sorted(self.docs)
        ]

    def stats(self) -> dict[str, Any]:
        return {
            "dir": str(self.directory),
            "docs": sorted(self.docs),
            "chunks": len(self.chunks),
            "loadedAt": self.loaded_at,
            "profile": self.profile.to_dict(),
            "warnings": self.warnings,
        }


class KnowledgeUploadError(ValueError):
    """Archivo `.md` subido inválido: nombre, tamaño o codificación."""


UPLOADS_SUBDIR = "uploads"
_SAFE_NAME = re.compile(r"[^A-Za-z0-9_.-]")


def _sanitize_upload_name(filename: str) -> str:
    """Nombre de archivo seguro: sin ruta, sin traversal, solo `.md`."""
    name = Path(filename or "").name.strip()  # descarta cualquier componente de ruta
    if not name or name in {".", ".."}:
        raise KnowledgeUploadError("Nombre de archivo vacío o inválido")
    if not name.lower().endswith(".md"):
        raise KnowledgeUploadError("Solo se aceptan archivos .md")
    if name.lower() == "readme.md":
        raise KnowledgeUploadError("readme.md está reservado (no es contenido del negocio)")
    stem = name[: -len(".md")]
    safe_stem = _SAFE_NAME.sub("_", stem)[:120] or "documento"
    return f"{safe_stem}.md"


def save_uploaded_doc(directory: Path, filename: str, content: bytes, *, max_bytes: int) -> str:
    """Guarda un `.md` subido en `<directory>/uploads/`. Devuelve el doc id relativo.

    El contenido se trata como dato del negocio, igual que cualquier otro
    Markdown de `knowledge/`: nunca como instrucción para el modelo.
    """
    if len(content) > max_bytes:
        raise KnowledgeUploadError(f"Archivo demasiado grande (máximo {max_bytes} bytes)")
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise KnowledgeUploadError(f"El archivo no es UTF-8 válido: {exc}") from exc
    if "\x00" in text:
        raise KnowledgeUploadError("Archivo binario detectado, se esperaba Markdown")

    safe_name = _sanitize_upload_name(filename)
    uploads_dir = directory / UPLOADS_SUBDIR
    uploads_dir.mkdir(parents=True, exist_ok=True)
    target = uploads_dir / safe_name
    # Resuelto y verificado dentro de uploads_dir: cierra cualquier
    # traversal residual (symlinks, etc.) antes de escribir a disco.
    resolved = target.resolve()
    if uploads_dir.resolve() not in resolved.parents:
        raise KnowledgeUploadError("Ruta de destino inválida")
    target.write_text(text, encoding="utf-8")
    return str(target.relative_to(directory))


def delete_uploaded_doc(directory: Path, doc_id: str) -> bool:
    """Borra un doc subido. Solo alcanza `uploads/`: el resto del knowledge
    base es contenido curado y no se administra por API."""
    candidate = (directory / doc_id).resolve()
    uploads_dir = (directory / UPLOADS_SUBDIR).resolve()
    if uploads_dir not in candidate.parents:
        raise KnowledgeUploadError("Solo se pueden borrar documentos subidos (uploads/)")
    if not candidate.exists():
        return False
    candidate.unlink()
    return True


_KB: KnowledgeBase | None = None


def get_knowledge_base(directory: Path | None = None) -> KnowledgeBase:
    global _KB
    if _KB is None or (directory is not None and directory != _KB.directory):
        from .config import get_settings

        _KB = KnowledgeBase(directory or get_settings().knowledge_dir)
    return _KB


def reload_knowledge_base() -> dict[str, Any]:
    kb = get_knowledge_base()
    kb.load()
    return kb.stats()
