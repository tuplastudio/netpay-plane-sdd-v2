"""Memoria episódica: qué aprendemos de CÓMO fue cada conversación.

Qué es y qué NO es
------------------
Al cerrar una conversación (handoff, cierre desde el panel, borrado o
autocierre) se extrae un **episodio**: una ficha corta sobre la dinámica de
la conversación —cuántos turnos tomó, hasta qué etapa llegó, cómo cambió el
ánimo del cliente, dónde hubo fricción, qué funcionó y qué mejorar en el
trato—. El objetivo es que el agente aprenda a conversar mejor con el
tiempo, no que recuerde a nadie.

Por eso el episodio **nunca contiene datos del negocio ni de la persona**:
ni nombres, ni teléfonos, ni correos, ni productos, ni precios, ni el texto
literal del cliente. La información de un negocio es confidencial frente a
los demás negocios de la plataforma y la del cliente lo es frente a todos.
Tres capas lo garantizan, en orden:

1. **Esquema cerrado**: los campos con significado son enumeraciones
   (``OUTCOMES``, ``MOODS``, ``FRICTION_CODES``); el texto libre son tres
   listas cortas + un resumen de comportamiento, todos acotados.
2. **Redacción antes del LLM**: la transcripción que se manda al modelo
   extractor ya va sin PII (``guards.pii.redact`` en modo agresivo), sin el
   nombre del cliente/negocio/agente y sin SKUs ni títulos del carrito.
3. **Scrub después del LLM**: cada campo de texto pasa otra vez por la
   redacción, se eliminan términos prohibidos y se descarta el campo entero
   si aún contiene un correo o una secuencia larga de dígitos.

Sin LLM (sin key, proveedor caído, memoria episódica sin modelo) se guarda
la versión heurística (``heuristic_episode``), que se deriva del estado
comercial y de la forma de los mensajes, no de su contenido.

Uso de vuelta en el prompt
--------------------------
``EpisodeStore.lessons`` agrega los últimos episodios del tenant en un
bloque corto (fricciones más frecuentes + mejoras sugeridas más repetidas)
que ``tenant_context.py`` inyecta como ``<lecciones>``. Es dato, no
instrucción, y el prompt lo dice así.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

import aiosqlite
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

from ..guards.pii import redact
from .context import SUMMARY_PREFIX

logger = logging.getLogger(__name__)

OUTCOMES: tuple[str, ...] = (
    "PAGO_ENVIADO",
    "COTIZACION_EMITIDA",
    "CARRITO_SIN_CIERRE",
    "SOLO_CONSULTA",
    "ESCALADO",
    "FUERA_DE_TEMA",
    "SIN_RESPUESTA",
)
MOODS: tuple[str, ...] = ("neutral", "contento", "apurado", "confundido", "molesto", "indeciso")
FRICTION_CODES: tuple[str, ...] = (
    "pidio_dato_ya_conocido",
    "repitio_pregunta",
    "respuesta_larga",
    "no_entendio_pedido",
    "tardo_en_cerrar",
    "error_herramienta",
    "producto_no_encontrado",
    "precio_no_disponible",
    "cliente_fuera_de_tema",
    "intento_inyeccion",
    "cliente_pidio_humano",
    "cliente_molesto",
    "sin_friccion",
)

MAX_LIST_ITEMS = 3
MAX_ITEM_CHARS = 160
MAX_SUMMARY_CHARS = 320
MAX_TRANSCRIPT_CHARS = 9_000
DEFAULT_MAX_ROWS_PER_TENANT = 2_000

_FORBIDDEN_TEXT_RE = re.compile(r"@|\d{5,}|https?://", re.IGNORECASE)
_LONG_MESSAGE_CHARS = 420


@dataclass
class Episode:
    """Ficha de comportamiento de una conversación. Sin PII ni datos del negocio."""

    id: str
    tenant_id: str
    conversation_key: str  # hash del id de conversación: correlaciona sin exponer teléfono
    created_at: float
    channel: str
    prompt_version: str
    model: str
    turns: int
    tool_calls: int
    tool_errors: int
    stage_reached: str
    outcome: str
    handoff_reason: str
    mood_start: str
    mood_end: str
    friction: list[str] = field(default_factory=list)
    what_worked: list[str] = field(default_factory=list)
    improvements: list[str] = field(default_factory=list)
    summary: str = ""
    source: str = "heuristic"  # "heuristic" | "llm"

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        return {
            "id": data["id"],
            "tenantId": data["tenant_id"],
            "conversationKey": data["conversation_key"],
            "createdAt": data["created_at"],
            "channel": data["channel"],
            "promptVersion": data["prompt_version"],
            "model": data["model"],
            "turns": data["turns"],
            "toolCalls": data["tool_calls"],
            "toolErrors": data["tool_errors"],
            "stageReached": data["stage_reached"],
            "outcome": data["outcome"],
            "handoffReason": data["handoff_reason"],
            "moodStart": data["mood_start"],
            "moodEnd": data["mood_end"],
            "friction": data["friction"],
            "whatWorked": data["what_worked"],
            "improvements": data["improvements"],
            "summary": data["summary"],
            "source": data["source"],
        }


def conversation_key(tenant_id: str, conversation_id: str) -> str:
    """Hash estable del id de conversación (que suele llevar el teléfono)."""
    return hashlib.sha256(f"{tenant_id}:{conversation_id}".encode("utf-8")).hexdigest()[:16]


# ------------------------------------------------------------------ scrub


def scrub_text(text: str, forbidden_terms: Iterable[str] = ()) -> str:
    """Texto libre apto para el episodio, o "" si no se puede limpiar con certeza."""
    cleaned = redact(str(text or ""), aggressive=True)
    for term in forbidden_terms:
        term = (term or "").strip()
        if len(term) >= 3:
            cleaned = re.sub(re.escape(term), "[…]", cleaned, flags=re.IGNORECASE)
    cleaned = " ".join(cleaned.split())
    if _FORBIDDEN_TEXT_RE.search(cleaned):
        return ""
    return cleaned


def scrub_list(items: Any, forbidden_terms: Iterable[str] = ()) -> list[str]:
    if not isinstance(items, list):
        return []
    out: list[str] = []
    for item in items:
        text = scrub_text(str(item), forbidden_terms)[:MAX_ITEM_CHARS]
        if text and text not in out:
            out.append(text)
        if len(out) >= MAX_LIST_ITEMS:
            break
    return out


def _enum(value: Any, allowed: tuple[str, ...], default: str) -> str:
    text = str(value or "").strip()
    if text.upper() in allowed:
        return text.upper()
    if text.lower() in allowed:
        return text.lower()
    return default


def _codes(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    out = [str(v).strip().lower() for v in values]
    return [v for v in dict.fromkeys(out) if v in FRICTION_CODES][:6]


def forbidden_terms_from_state(state: dict[str, Any], *extra: str) -> list[str]:
    """Nombre del cliente, SKUs/títulos de TODOS los carritos abiertos y lo
    que pase en ``extra`` (nombre del negocio, del agente): nada de eso puede
    quedar en un episodio."""
    terms: list[str] = [t for t in extra if t]
    customer = state.get("customer") or {}
    for key in ("name", "email", "phone"):
        value = customer.get(key)
        if value:
            terms.append(str(value))
            if key == "name":
                terms.extend(part for part in str(value).split() if len(part) >= 3)
    for record in (state.get("carts") or {}).values():
        for line in record.get("lines") or []:
            for key in ("sku", "title"):
                if line.get(key):
                    terms.append(str(line[key]))
    return terms


# ------------------------------------------------------------- heurística


def _text_of(message: BaseMessage) -> str:
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(str(p.get("text", "")) if isinstance(p, dict) else str(p) for p in content)
    return str(content or "")


def _outcome_from_state(state: dict[str, Any], turns: int) -> str:
    """El resultado más avanzado entre TODOS los carritos de la conversación
    (si uno de dos pedidos llegó a pago, eso pesa más que el otro quedando
    solo cotizado)."""
    if state.get("handoff"):
        return "ESCALADO"
    carts = list((state.get("carts") or {}).values())
    if any(c.get("checkoutLink") for c in carts):
        return "PAGO_ENVIADO"
    if any(c.get("quoteId") for c in carts):
        return "COTIZACION_EMITIDA"
    if any(c.get("lines") for c in carts):
        return "CARRITO_SIN_CIERRE"
    if turns == 0:
        return "SIN_RESPUESTA"
    return "SOLO_CONSULTA"


def heuristic_episode(
    messages: Sequence[BaseMessage],
    state: dict[str, Any],
    *,
    tenant_id: str,
    conversation_id: str,
    channel: str = "",
    prompt_version: str = "",
    model: str = "",
    extra_friction: Iterable[str] = (),
) -> Episode:
    """Episodio sin LLM: solo forma de los mensajes y estado comercial."""
    humans = [m for m in messages if isinstance(m, HumanMessage) and not _text_of(m).startswith(SUMMARY_PREFIX)]
    ais = [m for m in messages if isinstance(m, AIMessage)]
    tool_calls = sum(len(m.tool_calls or []) for m in ais)
    tool_errors = sum(1 for m in messages if isinstance(m, ToolMessage) and _text_of(m).startswith("ERROR:"))
    turns = len(humans)

    friction: list[str] = list(extra_friction)
    if tool_errors:
        friction.append("error_herramienta")
    if any(len(_text_of(m)) > _LONG_MESSAGE_CHARS for m in ais if isinstance(m.content, str)):
        friction.append("respuesta_larga")
    if state.get("handoff"):
        friction.append("cliente_pidio_humano")
    any_quoted = any(c.get("quoteId") for c in (state.get("carts") or {}).values())
    if turns >= 10 and not any_quoted:
        friction.append("tardo_en_cerrar")
    if any("Sin resultados en el catálogo" in _text_of(m) for m in messages if isinstance(m, ToolMessage)):
        friction.append("producto_no_encontrado")
    friction = [f for f in dict.fromkeys(friction) if f in FRICTION_CODES] or ["sin_friccion"]

    handoff_reason = str(state.get("handoff_reason") or "").strip().upper()[:40]
    return Episode(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        conversation_key=conversation_key(tenant_id, conversation_id),
        created_at=time.time(),
        channel=(channel or "")[:20],
        prompt_version=(prompt_version or "")[:20],
        model=(model or "")[:80],
        turns=turns,
        tool_calls=tool_calls,
        tool_errors=tool_errors,
        stage_reached=str(state.get("stage") or "DESCUBRIMIENTO")[:40],
        outcome=_outcome_from_state(state, turns),
        handoff_reason=handoff_reason,
        mood_start="neutral",
        mood_end="molesto" if handoff_reason == "QUEJA" else "neutral",
        friction=friction,
        source="heuristic",
    )


# ------------------------------------------------------------------ LLM

_EXTRACTION_SYSTEM = """\
Analizas la transcripción de una conversación entre un cliente y un agente de \
ventas por WhatsApp para extraer SOLO aprendizajes sobre CÓMO conversó el \
agente. No te interesa qué se vendió ni a quién.

PROHIBIDO en tu respuesta: nombres de personas o negocios, teléfonos, correos, \
direcciones, productos, marcas, SKUs, precios, cantidades, fechas, enlaces o \
cualquier texto literal de la transcripción. Si un aprendizaje solo se puede \
expresar con esos datos, omítelo.

Responde SOLO un JSON con esta forma exacta:
{"mood_start": "...", "mood_end": "...", "friction": ["..."], \
"what_worked": ["..."], "improvements": ["..."], "summary": "..."}

- mood_start / mood_end: uno de %(moods)s.
- friction: cero o más de %(codes)s.
- what_worked: máximo 3 frases cortas sobre el comportamiento del agente que ayudó.
- improvements: máximo 3 frases cortas, accionables, sobre cómo conversar mejor \
(tono, ritmo, cuándo preguntar, cuándo cerrar, cómo manejar objeciones).
- summary: una frase (máximo 40 palabras) sobre la dinámica de la conversación, \
sin datos.
""" % {"moods": ", ".join(MOODS), "codes": ", ".join(FRICTION_CODES)}


def _parse_json(content: str) -> dict[str, Any] | None:
    raw = (content or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.S)
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end < 0:
        return None
    try:
        payload = json.loads(raw[start : end + 1])
    except ValueError:
        return None
    return payload if isinstance(payload, dict) else None


def redacted_transcript(messages: Sequence[BaseMessage], forbidden_terms: Iterable[str]) -> str:
    """Transcripción para el extractor: roles + texto ya sin PII ni términos del negocio."""
    terms = [t for t in forbidden_terms if t]
    lines: list[str] = []
    for message in messages:
        if isinstance(message, HumanMessage):
            if _text_of(message).startswith(SUMMARY_PREFIX):
                continue
            role = "cliente"
        elif isinstance(message, AIMessage):
            role = "agente"
            if not isinstance(message.content, str) or not message.content.strip():
                if message.tool_calls:
                    lines.append("agente: [usó una herramienta]")
                continue
        elif isinstance(message, ToolMessage):
            text = _text_of(message)
            lines.append("herramienta: [error]" if text.startswith("ERROR:") else "herramienta: [ok]")
            continue
        else:
            continue
        text = redact(_text_of(message), aggressive=True)
        for term in terms:
            if len(term) >= 3:
                text = re.sub(re.escape(term), "[…]", text, flags=re.IGNORECASE)
        lines.append(f"{role}: {text[:500]}")
    return "\n".join(lines)[-MAX_TRANSCRIPT_CHARS:]


async def enrich_with_llm(
    episode: Episode,
    messages: Sequence[BaseMessage],
    *,
    model: Any,
    forbidden_terms: Iterable[str],
    timeout: float = 20.0,
) -> Episode:
    """Completa ánimo, fricción, aciertos y mejoras con el modelo. Nunca lanza."""
    from langchain_core.messages import HumanMessage as _Human, SystemMessage as _System

    terms = list(forbidden_terms)
    transcript = redacted_transcript(messages, terms)
    if not transcript.strip():
        return episode
    try:
        response = await asyncio.wait_for(
            model.ainvoke([_System(_EXTRACTION_SYSTEM), _Human(transcript)]), timeout=timeout
        )
    except Exception:  # noqa: BLE001 - el episodio heurístico ya es válido
        logger.warning("extractor episódico falló; se guarda la versión heurística", exc_info=True)
        return episode
    payload = _parse_json(getattr(response, "content", "") or "")
    if not payload:
        return episode

    friction = _codes(payload.get("friction")) or episode.friction
    for code in episode.friction:
        if code != "sin_friccion" and code not in friction:
            friction.append(code)
    if len(friction) > 1 and "sin_friccion" in friction:
        friction.remove("sin_friccion")

    episode.mood_start = _enum(payload.get("mood_start"), MOODS, episode.mood_start)
    episode.mood_end = _enum(payload.get("mood_end"), MOODS, episode.mood_end)
    episode.friction = friction[:6]
    episode.what_worked = scrub_list(payload.get("what_worked"), terms)
    episode.improvements = scrub_list(payload.get("improvements"), terms)
    episode.summary = scrub_text(str(payload.get("summary") or ""), terms)[:MAX_SUMMARY_CHARS]
    episode.source = "llm"
    return episode


# ---------------------------------------------------------------- store

_SCHEMA = """
CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    created_at REAL NOT NULL,
    channel TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    model TEXT NOT NULL,
    turns INTEGER NOT NULL,
    tool_calls INTEGER NOT NULL,
    tool_errors INTEGER NOT NULL,
    stage_reached TEXT NOT NULL,
    outcome TEXT NOT NULL,
    handoff_reason TEXT NOT NULL,
    mood_start TEXT NOT NULL,
    mood_end TEXT NOT NULL,
    friction TEXT NOT NULL,
    what_worked TEXT NOT NULL,
    improvements TEXT NOT NULL,
    summary TEXT NOT NULL,
    source TEXT NOT NULL
);
"""
_INDEXES = (
    "CREATE INDEX IF NOT EXISTS idx_episodes_tenant_created ON episodes(tenant_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_episodes_conversation ON episodes(tenant_id, conversation_key)",
)


def _row_to_episode(row: aiosqlite.Row) -> Episode:
    return Episode(
        id=row["id"],
        tenant_id=row["tenant_id"],
        conversation_key=row["conversation_key"],
        created_at=row["created_at"],
        channel=row["channel"],
        prompt_version=row["prompt_version"],
        model=row["model"],
        turns=row["turns"],
        tool_calls=row["tool_calls"],
        tool_errors=row["tool_errors"],
        stage_reached=row["stage_reached"],
        outcome=row["outcome"],
        handoff_reason=row["handoff_reason"],
        mood_start=row["mood_start"],
        mood_end=row["mood_end"],
        friction=json.loads(row["friction"] or "[]"),
        what_worked=json.loads(row["what_worked"] or "[]"),
        improvements=json.loads(row["improvements"] or "[]"),
        summary=row["summary"],
        source=row["source"],
    )


class EpisodeStore:
    """Episodios en SQLite, particionados por tenant. Perezoso: no toca disco
    hasta el primer uso; las lecciones se cachean por tenant con TTL."""

    def __init__(
        self,
        db_path: Path,
        *,
        max_rows_per_tenant: int = DEFAULT_MAX_ROWS_PER_TENANT,
        lessons_ttl_seconds: float = 300.0,
    ) -> None:
        self._db_path = Path(db_path)
        self._max_rows_per_tenant = max_rows_per_tenant
        self._lessons_ttl = lessons_ttl_seconds
        self._conn: aiosqlite.Connection | None = None
        self._init_lock = asyncio.Lock()
        self._write_lock = asyncio.Lock()
        self._lessons_cache: dict[str, tuple[float, str]] = {}

    async def _conn_ready(self) -> aiosqlite.Connection:
        if self._conn is not None:
            return self._conn
        async with self._init_lock:
            if self._conn is not None:
                return self._conn
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
            conn = await aiosqlite.connect(str(self._db_path))
            conn.row_factory = aiosqlite.Row
            await conn.execute("PRAGMA journal_mode=WAL")
            await conn.execute(_SCHEMA)
            for stmt in _INDEXES:
                await conn.execute(stmt)
            await conn.commit()
            self._conn = conn
            return conn

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def save(self, episode: Episode) -> Episode:
        """Inserta (o reemplaza el episodio previo de la misma conversación)."""
        conn = await self._conn_ready()
        async with self._write_lock:
            await conn.execute(
                "DELETE FROM episodes WHERE tenant_id=? AND conversation_key=?",
                (episode.tenant_id, episode.conversation_key),
            )
            await conn.execute(
                "INSERT INTO episodes (id, tenant_id, conversation_key, created_at, channel, "
                "prompt_version, model, turns, tool_calls, tool_errors, stage_reached, outcome, "
                "handoff_reason, mood_start, mood_end, friction, what_worked, improvements, "
                "summary, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    episode.id,
                    episode.tenant_id,
                    episode.conversation_key,
                    episode.created_at,
                    episode.channel,
                    episode.prompt_version,
                    episode.model,
                    episode.turns,
                    episode.tool_calls,
                    episode.tool_errors,
                    episode.stage_reached,
                    episode.outcome,
                    episode.handoff_reason,
                    episode.mood_start,
                    episode.mood_end,
                    json.dumps(episode.friction, ensure_ascii=False),
                    json.dumps(episode.what_worked, ensure_ascii=False),
                    json.dumps(episode.improvements, ensure_ascii=False),
                    episode.summary,
                    episode.source,
                ),
            )
            # Tope por tenant: se podan los más viejos.
            await conn.execute(
                "DELETE FROM episodes WHERE tenant_id=? AND id NOT IN ("
                "SELECT id FROM episodes WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?)",
                (episode.tenant_id, episode.tenant_id, self._max_rows_per_tenant),
            )
            await conn.commit()
        self._lessons_cache.pop(episode.tenant_id, None)
        return episode

    async def list(self, tenant_id: str, *, limit: int = 50) -> list[Episode]:
        conn = await self._conn_ready()
        cur = await conn.execute(
            "SELECT * FROM episodes WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?",
            (tenant_id, max(1, min(limit, 500))),
        )
        return [_row_to_episode(r) for r in await cur.fetchall()]

    async def stats(self, tenant_id: str, *, window: int = 200) -> dict[str, Any]:
        """Agregados de los últimos ``window`` episodios del tenant."""
        episodes = await self.list(tenant_id, limit=window)
        outcomes: dict[str, int] = {}
        friction: dict[str, int] = {}
        moods_end: dict[str, int] = {}
        for ep in episodes:
            outcomes[ep.outcome] = outcomes.get(ep.outcome, 0) + 1
            moods_end[ep.mood_end] = moods_end.get(ep.mood_end, 0) + 1
            for code in ep.friction:
                friction[code] = friction.get(code, 0) + 1
        turns = [ep.turns for ep in episodes]
        return {
            "tenantId": tenant_id,
            "episodes": len(episodes),
            "avgTurns": round(sum(turns) / len(turns), 2) if turns else 0.0,
            "outcomes": dict(sorted(outcomes.items(), key=lambda kv: -kv[1])),
            "friction": dict(sorted(friction.items(), key=lambda kv: -kv[1])),
            "moodEnd": dict(sorted(moods_end.items(), key=lambda kv: -kv[1])),
            "bySource": {
                "llm": sum(1 for ep in episodes if ep.source == "llm"),
                "heuristic": sum(1 for ep in episodes if ep.source == "heuristic"),
            },
        }

    async def lessons(self, tenant_id: str, *, limit: int = 5, window: int = 60) -> str:
        """Bloque corto para el prompt: fricciones frecuentes + mejoras repetidas."""
        if limit <= 0:
            return ""
        now = time.monotonic()
        cached = self._lessons_cache.get(tenant_id)
        if cached and now - cached[0] < self._lessons_ttl:
            return cached[1]
        episodes = await self.list(tenant_id, limit=window)
        block = render_lessons(episodes, limit=limit)
        self._lessons_cache[tenant_id] = (now, block)
        return block

    async def delete_tenant(self, tenant_id: str) -> int:
        conn = await self._conn_ready()
        async with self._write_lock:
            cur = await conn.execute("DELETE FROM episodes WHERE tenant_id=?", (tenant_id,))
            await conn.commit()
        self._lessons_cache.pop(tenant_id, None)
        return cur.rowcount or 0


def render_lessons(episodes: Sequence[Episode], *, limit: int = 5) -> str:
    """Texto de ``<lecciones>`` a partir de episodios (puro, para pruebas)."""
    if not episodes:
        return ""
    friction: dict[str, int] = {}
    improvements: dict[str, int] = {}
    for ep in episodes:
        for code in ep.friction:
            if code != "sin_friccion":
                friction[code] = friction.get(code, 0) + 1
        for item in ep.improvements:
            key = item.strip().lower()
            if key:
                improvements[key] = improvements.get(key, 0) + 1
    lines: list[str] = []
    top_friction = sorted(friction.items(), key=lambda kv: -kv[1])[:limit]
    if top_friction:
        lines.append(
            "Fricciones más frecuentes en conversaciones recientes: "
            + ", ".join(f"{code} ({n})" for code, n in top_friction)
            + "."
        )
    for text, _count in sorted(improvements.items(), key=lambda kv: -kv[1])[:limit]:
        lines.append(f"- {text[0].upper() + text[1:]}")
    return "\n".join(lines)


_STORE: EpisodeStore | None = None


def get_episode_store() -> EpisodeStore:
    """Singleton perezoso sobre ``settings.episodes_path``."""
    global _STORE
    if _STORE is None:
        from ..config import get_settings

        _STORE = EpisodeStore(get_settings().episodes_path)
    return _STORE


def reset_episode_store() -> None:
    """Para pruebas."""
    global _STORE
    _STORE = None
