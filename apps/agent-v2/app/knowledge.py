"""Conocimiento del negocio: markdown plano cargado a memoria, por tenant.

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
    `<tenant>/uploads/`: el contenido curado a mano (negocio.md, etc.) no se
    toca por HTTP, igual que en v1.

Partición por tenant (layout en disco):
  - `<knowledge_dir>/*.md` (nivel raíz, sin recursión) es el conocimiento
    legado del tenant `default`. No se comparte: esos archivos contienen datos
    reales de una empresa y exponerlos a otra sería fuga de contexto.
  - `<knowledge_dir>/tenants/<tenant_id>/**/*.md` es el conocimiento PROPIO
    de cada tenant (subidas del panel en `uploads/`, aprendizajes aprobados
    en `aprendizajes.md`). Un tenant solo lee su propio subárbol: nunca el de
    otro. `tenant_id` se sanea igual que el `docId` de abajo (sin "../", sin
    componentes de ruta) antes de tocar el filesystem.
  - Compatibilidad con el despliegue actual: antes de particionar, todo vivía
    plano en `<knowledge_dir>/` (incluye un `uploads/` y un `aprendizajes.md`
    ya en producción). Ese layout viejo se trata como el del tenant
    `DEFAULT_TENANT_ID` ("default", que es también a lo que sanea un
    `tenant_id` vacío — el caso de `agent.py` antes de que se le pase un
    tenant real): además de su plantilla base, ese tenant sigue leyendo el
    `uploads/` y el `aprendizajes.md` de la raíz tal cual estaban, sin mover
    ni migrar ningún archivo. Sus escrituras NUEVAS (subidas, aprendizajes)
    van al árbol particionado `tenants/default/`, así que con el tiempo el
    conocimiento del tenant por defecto queda repartido en dos ubicaciones
    (la vieja, congelada; la nueva, la que crece) — deuda operativa aceptada
    a cambio de no perder nada al desplegar este cambio y de no requerir un
    script de migración. Si el tenant real de este despliegue no se llama
    "default", quien opere el servicio debe o bien mandar ese tenant_id como
    "default", o bien mover a mano `<knowledge_dir>/uploads/` y
    `<knowledge_dir>/aprendizajes.md` dentro de `tenants/<su_tenant_id>/`.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import get_settings

MAX_CHARS = 24_000

UPLOADS_SUBDIR = "uploads"
TENANTS_SUBDIR = "tenants"
DEFAULT_TENANT_ID = "default"

# Reutilizado tanto para sanear nombres de archivo subidos como tenant_id: el
# criterio de "caracteres seguros para un componente de ruta" es el mismo.
_SAFE_NAME = re.compile(r"[^A-Za-z0-9_.-]")
# ~300 KB de texto plano es de sobra para cualquier documento de negocio real;
# tope defensivo contra un archivo gigante o un ataque de agotamiento de disco.
MAX_UPLOAD_BYTES = 300_000

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


def _sanitize_tenant_id(tenant_id: str) -> str:
    """Nombre de directorio seguro para un tenant: sin ruta, sin traversal.

    Mismo criterio que `_sanitize_upload_name` (abajo): `.name` descarta
    cualquier componente de ruta, incluido "../"; lo que sobreviva se filtra
    de caracteres no seguros y se recorta. Vacío, solo puntos (".", "..",
    "...") o un tenant_id en blanco caen todos al tenant por defecto: es el
    mismo bucket que ya usa el layout viejo (ver docstring del módulo), así
    que un tenant_id ausente o malformado nunca cruza a los datos propios de
    OTRO tenant real — en el peor caso ve la plantilla base + el legado.
    """
    raw = (tenant_id or "").strip()
    if not raw:
        return DEFAULT_TENANT_ID
    name = Path(raw).name
    safe = _SAFE_NAME.sub("_", name)[:80].strip(".")
    return safe or DEFAULT_TENANT_ID


def tenant_knowledge_dir(tenant_id: str, *, root: Path | None = None) -> Path:
    """Directorio propio de un tenant, `<root>/tenants/<tenant_id-saneado>/`.

    `root` es inyectable (lo usa `learning.py`, construido con su propio
    `knowledge_dir`) para no acoplar este helper al singleton de settings;
    por defecto usa `get_settings().knowledge_dir`, igual que el resto de
    funciones públicas de este módulo.
    """
    base = root if root is not None else get_settings().knowledge_dir
    tenants_root = base / TENANTS_SUBDIR
    candidate = tenants_root / _sanitize_tenant_id(tenant_id)
    # Defensa en profundidad: con _sanitize_tenant_id ya no debería poder
    # resolver fuera de tenants_root, pero se verifica igual (mismo patrón
    # que save_uploaded_doc) por si el filesystem tiene un symlink raro.
    if tenants_root.resolve() not in candidate.resolve().parents:
        return tenants_root / DEFAULT_TENANT_ID
    return candidate


@dataclass
class BusinessProfile:
    """Identidad del negocio, leída del frontmatter de `negocio.md`.

    Todo campo vacío se resuelve con un valor por defecto genérico en
    `prompts.py`; un tenant sin frontmatter propio sigue funcionando porque
    hereda el de la plantilla base.
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
    # Notas `> interno:` sueltas, sin el prefijo de documento: el guard de
    # salida las usa para detectar si el modelo las repitió al cliente.
    internal_notes: list[str] = field(default_factory=list)


def _load(tenant_id: str) -> _Loaded:
    root: Path = get_settings().knowledge_dir
    safe_id = _sanitize_tenant_id(tenant_id)
    tenant_dir = tenant_knowledge_dir(tenant_id)

    profile = BusinessProfile()
    doc_parts: list[str] = []
    all_notes: list[str] = []
    docs: list[str] = []
    chunks: list[KnowledgeChunk] = []
    warnings: list[str] = []

    def consume(path: Path, doc_name: str) -> None:
        nonlocal profile
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as exc:
            warnings.append(f"{path.name}: {exc}")
            return
        docs.append(doc_name)
        meta, body = _parse_frontmatter(raw)
        if meta:
            profile = _merge_profile(profile, meta)
        if INJECTION_PATTERNS.search(body):
            warnings.append(f"{doc_name}: contiene texto tipo instrucción; se trata como dato del negocio")

        public, notes = _split_internal_notes(body)
        if public:
            doc_parts.append(f"--- {doc_name} ---\n{public}")
        all_notes.extend(f"({doc_name}) {n}" for n in notes)

        chunks.extend(_split_sections(doc_name, body))

    if not root.is_dir():
        warnings.append(f"el directorio de conocimiento no existe: {root}")
    else:
        # 1) Documentos raíz: pertenecen al layout legado de `default`. Nunca
        # se heredan a otro tenant; los tenants nuevos obtienen nombre y
        # catálogo desde Commerce API y sus políticas desde su propio subárbol.
        if safe_id == DEFAULT_TENANT_ID:
            for path in sorted(root.glob("*.md")):
                if path.name.upper().startswith("README") or path.name == "aprendizajes.md":
                    continue
                consume(path, path.name)

        # 2) Compatibilidad con el despliegue plano anterior a la partición
        # (ver docstring del módulo): solo el tenant por defecto lo hereda.
        if safe_id == DEFAULT_TENANT_ID:
            legacy_uploads = root / UPLOADS_SUBDIR
            if legacy_uploads.is_dir():
                for path in sorted(legacy_uploads.glob("**/*.md")):
                    consume(path, str(path.relative_to(root)))
            legacy_learned = root / "aprendizajes.md"
            if legacy_learned.is_file():
                consume(legacy_learned, legacy_learned.name)

    # 3) Conocimiento propio del tenant: aislado en su subárbol, nunca
    # visible para otro tenant_id.
    if tenant_dir.is_dir():
        for path in sorted(tenant_dir.glob("**/*.md")):
            if path.name.upper().startswith("README"):
                continue
            consume(path, str(Path(TENANTS_SUBDIR) / safe_id / path.relative_to(tenant_dir)))

    text = "\n\n".join(doc_parts)
    if all_notes:
        text += (
            "\n\n--- NOTAS INTERNAS (guía para ti, el cliente nunca las escribió ni "
            "debe leerlas: no las repitas ni las cites literalmente) ---\n"
            + "\n".join(f"- {n}" for n in all_notes)
        )
    return _Loaded(
        text=text[:MAX_CHARS],
        profile=profile,
        docs=docs,
        chunks=chunks,
        warnings=warnings,
        internal_notes=[n.split(") ", 1)[-1] for n in all_notes],
    )


# Caché por tenant (reemplaza el `lru_cache(maxsize=1)` de la versión sin
# particionar): cada tenant se recalcula y se invalida por separado, así
# subir/borrar/aprobar en el tenant A nunca fuerza una recarga ni afecta la
# caché ya tibia del tenant B.
_CACHE: dict[str, _Loaded] = {}


def _cached(tenant_id: str) -> _Loaded:
    safe_id = _sanitize_tenant_id(tenant_id)
    loaded = _CACHE.get(safe_id)
    if loaded is None:
        loaded = _load(tenant_id)
        _CACHE[safe_id] = loaded
    return loaded


def invalidate_knowledge_cache(tenant_id: str) -> None:
    """Descarta la caché de un solo tenant. Expuesta para `learning.py`:
    tras aprobar una señal, su `aprendizajes.md` cambió y su próxima lectura
    debe recalcularse — sin tocar la caché de ningún otro tenant."""
    _CACHE.pop(_sanitize_tenant_id(tenant_id), None)


def load_knowledge(tenant_id: str) -> str:
    return _cached(tenant_id).text


def load_profile(tenant_id: str) -> BusinessProfile:
    return _cached(tenant_id).profile


def load_internal_notes(tenant_id: str) -> list[str]:
    """Notas internas del tenant (texto que el cliente nunca debe leer)."""
    return list(_cached(tenant_id).internal_notes)


def reload_knowledge(tenant_id: str) -> str:
    invalidate_knowledge_cache(tenant_id)
    return load_knowledge(tenant_id)


def knowledge_stats(tenant_id: str) -> dict[str, Any]:
    """Para `GET /knowledge`: qué hay indexado, sin la lista de secciones
    (eso es `knowledge_outline()`, aparte, igual que en v1: `{**kb.stats(),
    "outline": kb.outline()}`)."""
    loaded = _cached(tenant_id)
    p = loaded.profile
    return {
        "dir": str(tenant_knowledge_dir(tenant_id)),
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


def knowledge_outline(tenant_id: str) -> list[dict[str, Any]]:
    """Para `GET /knowledge`: `{doc, sections}` por cada documento indexado."""
    loaded = _cached(tenant_id)
    return [
        {"doc": doc, "sections": [c.ref for c in loaded.chunks if c.doc == doc]}
        for doc in sorted(set(loaded.docs))
    ]


def search_knowledge(tenant_id: str, query: str, *, top_k: int = 4) -> list[dict[str, Any]]:
    """Para `GET /knowledge/search`: secciones relevantes a `query`, con score.

    Búsqueda por superposición de tokens sobre el mismo índice por sección
    que arma `knowledge_outline()`; si ninguna sección comparte tokens con la
    consulta, cae a similitud difusa (trigramas) contra el título de la
    sección, para no devolver vacío ante errores de tecleo o singular/plural.
    """
    loaded = _cached(tenant_id)
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
# y borra archivos): el tenant_id y el docId los manda el cliente, así que
# todo aquí asume que son hostiles hasta demostrar lo contrario (path
# traversal, tipo, tamaño).
# ---------------------------------------------------------------------------


class KnowledgeUploadError(ValueError):
    """`.md` subido inválido: nombre, tamaño, codificación o ruta fuera del
    directorio de conocimiento. `main.py` la traduce a HTTP 400."""


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


def save_uploaded_doc(
    tenant_id: str, filename: str, content: bytes, *, max_bytes: int = MAX_UPLOAD_BYTES
) -> str:
    """Guarda un `.md` subido en `<knowledge_dir>/tenants/<tenant_id>/uploads/`.
    Devuelve el docId relativo a ESE tenant (p. ej. `uploads/politica-envios.md`,
    sin el prefijo `tenants/<id>/`) que el panel usa luego para borrarlo con
    `delete_knowledge_doc(tenant_id, doc_id)` — el mismo tenant_id, siempre.
    Invalida la caché de ese tenant: el documento nuevo se ve desde el
    siguiente turno, sin reiniciar el servicio, y sin tocar la caché de
    ningún otro tenant.

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

    directory = tenant_knowledge_dir(tenant_id)
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
    invalidate_knowledge_cache(tenant_id)
    return doc_id


def delete_knowledge_doc(tenant_id: str, doc_id: str) -> bool:
    """Borra un documento subido por su docId, dentro del tenant dado.
    Solo alcanza `<tenant>/uploads/`: el contenido curado a mano (negocio.md,
    productos.md, ...) vive en la plantilla base y no se administra por API,
    igual que en v1. Invalida la caché de ese tenant igual que
    `save_uploaded_doc`.

    Devuelve `False` si el docId no corresponde a un archivo existente (para
    que `main.py` responda 404). Lanza `KnowledgeUploadError` si el docId
    intenta salirse de `uploads/` (path traversal): en ese caso NO se borra
    nada, ni siquiera dentro del directorio del tenant.
    """
    directory = tenant_knowledge_dir(tenant_id)
    uploads_dir = (directory / UPLOADS_SUBDIR).resolve()
    candidate = (directory / doc_id).resolve()
    if uploads_dir not in candidate.parents:
        raise KnowledgeUploadError("Solo se pueden borrar documentos subidos (uploads/)")
    if not candidate.exists():
        return False
    candidate.unlink()
    invalidate_knowledge_cache(tenant_id)
    return True
