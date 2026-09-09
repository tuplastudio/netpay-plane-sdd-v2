"""Ciclo de aprendizaje entre sesiones, portado de `agent-service/app/learning.py` (v1).

Cuando el agente no sabe contestar algo o escala a un humano, se registra
una "señal": una sugerencia pendiente que el dueño del negocio revisa en el
panel web, corrige y aprueba. La aprobación es lo único que incorpora texto
nuevo al conocimiento del agente — igual que en v1, lo que dice un cliente en
una conversación es dato, nunca instrucción, así que promoverlo a
`knowledge/*.md` exige una aprobación humana explícita.

Decisiones de este módulo (ver reporte de entrega para el detalle completo):

- Persistencia: SQLite (`aiosqlite`), no JSON/JSONL como v1. v2 ya corre un
  event loop async con dos sqlite propios en `data_dir` (`threads.sqlite` del
  checkpointer, `memory.sqlite` del store) y un tercero para idempotencia en
  `main.py`; sumar `learning.sqlite` sigue el mismo patrón y evita bloquear
  el loop con I/O de archivo, además de dar filtrado por tenant/status sin
  cargar todo a memoria. El directorio ya vive en el volumen montado de
  Docker (`settings.data_dir`), así que sobrevive reinicios igual que el
  resto del estado.
- Deduplicación: si N clientes preguntan lo mismo, es UNA señal con un
  contador (`occurrences`), no N filas. Quien revisa esto es el dueño de una
  tienda, no un ingeniero leyendo logs: una lista con veinte líneas
  idénticas es ruido, no información. La igualdad se decide por
  (tenant, kind, pregunta normalizada) mientras la señal siga "pending".
- Tope de crecimiento: cap de señales pendientes por tenant (protege la cola
  que de verdad revisa una persona) y un cap total de filas en la tabla
  (protege el disco), podando primero las más viejas ya resueltas
  (aprobadas/descartadas) antes que tocar una pendiente.
- Multi-tenant: toda señal lleva `tenant_id` y el listado se puede filtrar
  por tenant. La escritura a conocimiento (ver `approve`) es la excepción:
  `knowledge_dir` en v2 todavía no está particionado por tenant (ver
  `knowledge.py`, que hace `directory.glob("*.md")` sin subcarpetas), así
  que el `.md` de aprendizajes es hoy un archivo compartido — ver nota en el
  reporte de entrega.
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import aiosqlite

_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[¿?¡!.,;:]")

# Marcadores de "no lo sé" en el texto final del agente. v1 detectaba una
# pregunta sin respuesta porque su tool `answer_business_question` devolvía
# `found=False`; v2 no tiene esa tool (el conocimiento se vuelca completo al
# prompt, ver knowledge.py), así que no hay una señal estructurada de "no
# encontré esto". Este heurístico es la mejor aproximación disponible sin
# tocar agent.py/tools.py: falsos negativos (se pierde la señal) son
# aceptables, falsos positivos también (el dueño simplemente la descarta).
_UNCERTAINTY_MARKERS = re.compile(
    r"no\s+(tengo|cuento con|manejo|encontr[eé]|s[eé]\s+decirte|puedo confirmar)"
    r"|no\s+tengo\s+(esa|ese)\s+(informaci[oó]n|dato)"
    r"|desconozco"
    r"|no\s+(aparece|figura)\s+en\s+mi\s+informaci[oó]n",
    re.IGNORECASE,
)

MAX_QUESTION_CHARS = 500
MAX_REASON_CHARS = 300
MAX_ANSWER_CHARS = 4000
DEFAULT_MAX_PENDING_PER_TENANT = 300
DEFAULT_MAX_TOTAL_ROWS = 5000

VALID_KINDS = {"unanswered_question", "handoff"}
VALID_STATUSES = {"pending", "approved", "dismissed"}


def looks_like_unanswered(reply_text: str) -> bool:
    """Heurística de bajo costo: ¿la respuesta final del agente admite que no
    sabe? Ver nota de `_UNCERTAINTY_MARKERS` arriba."""
    return bool(_UNCERTAINTY_MARKERS.search(reply_text or ""))


class SignalNotFoundError(Exception):
    """No existe una señal con ese id."""


class SignalTenantMismatchError(Exception):
    """La señal existe pero pertenece a otro tenant (chequeo opcional de
    defensa en profundidad; el contrato HTTP actual del panel no manda
    tenantId en approve/dismiss, igual que en v1)."""


@dataclass
class LearningSignal:
    id: str
    tenant_id: str
    conversation_id: str
    kind: str  # "unanswered_question" | "handoff"
    question: str
    reason: str | None = None
    created_at: float = field(default_factory=time.time)
    status: str = "pending"  # pending | approved | dismissed
    doc_id: str | None = None
    # Campos de dedup: el panel actual (apps/web .../agent/page.tsx) no los
    # lee, y una interfaz TS ignora sin romper las claves de más. Se exponen
    # igual porque son la evidencia de "cuántos clientes tropezaron con
    # esto", útil el día que el panel quiera mostrarlo.
    occurrences: int = 1
    last_seen_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "tenantId": self.tenant_id,
            "conversationId": self.conversation_id,
            "kind": self.kind,
            "question": self.question,
            "reason": self.reason,
            "createdAt": self.created_at,
            "status": self.status,
            "docId": self.doc_id,
            "occurrences": self.occurrences,
            "lastSeenAt": self.last_seen_at,
        }


def _normalize(question: str) -> str:
    """Clave de dedup: colapsa espacios/mayúsculas/puntuación. No es NLP, es
    a propósito barato — el objetivo es agrupar "¿Tienen envío a Puebla?" con
    "tienen envio a puebla", no entender parafraseos complejos."""
    text = _PUNCT.sub("", question.strip().lower())
    return _WS.sub(" ", text).strip()


def _row_to_signal(row: aiosqlite.Row) -> LearningSignal:
    return LearningSignal(
        id=row["id"],
        tenant_id=row["tenant_id"],
        conversation_id=row["conversation_id"],
        kind=row["kind"],
        question=row["question"],
        reason=row["reason"],
        created_at=row["created_at"],
        status=row["status"],
        doc_id=row["doc_id"],
        occurrences=row["occurrences"],
        last_seen_at=row["last_seen_at"],
    )


_SCHEMA = """
CREATE TABLE IF NOT EXISTS learning_signals (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    question TEXT NOT NULL,
    question_norm TEXT NOT NULL,
    reason TEXT,
    created_at REAL NOT NULL,
    last_seen_at REAL NOT NULL,
    status TEXT NOT NULL,
    doc_id TEXT,
    occurrences INTEGER NOT NULL DEFAULT 1
);
"""
_INDEXES = (
    "CREATE INDEX IF NOT EXISTS idx_learning_tenant_status "
    "ON learning_signals(tenant_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_learning_dedup "
    "ON learning_signals(tenant_id, kind, question_norm, status)",
)


class LearningStore:
    """Señales de aprendizaje en SQLite + volcado de aprobaciones a markdown.

    Toda operación es async y perezosa: ni `__init__` ni construir el store
    tocan disco (así el servicio no truena si `data_dir`/`knowledge_dir`
    todavía no existen al arrancar). La conexión y las tablas se crean en el
    primer uso real.
    """

    def __init__(
        self,
        db_path: Path,
        knowledge_dir: Path,
        *,
        max_pending_per_tenant: int = DEFAULT_MAX_PENDING_PER_TENANT,
        max_total_rows: int = DEFAULT_MAX_TOTAL_ROWS,
    ) -> None:
        self._db_path = Path(db_path)
        self._knowledge_dir = Path(knowledge_dir)
        self._max_pending_per_tenant = max_pending_per_tenant
        self._max_total_rows = max_total_rows
        self._conn: aiosqlite.Connection | None = None
        self._init_lock = asyncio.Lock()
        # Serializa el ciclo leer-decidir-escribir (dedup, tope) entre
        # corrutinas del mismo proceso: SQLite serializa el archivo, pero no
        # una secuencia de varias sentencias de una misma corrutina lógica.
        self._write_lock = asyncio.Lock()
        # Aparte del lock de escritura de la DB: el volcado a markdown es un
        # archivo de texto plano, no tiene transacciones propias.
        self._file_lock = asyncio.Lock()

    async def start(self) -> None:
        """Opcional: fuerza la inicialización ahora en vez de en el primer
        request. Llamarlo en el startup de FastAPI es buena práctica, pero
        no es obligatorio — cualquier método la dispara igual si hace falta."""
        await self._conn_ready()

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

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

    # ------------------------------------------------------------ registro

    async def record_unanswered_question(
        self, *, tenant_id: str, conversation_id: str, question: str
    ) -> LearningSignal | None:
        """Registra (o refuerza el contador de) una pregunta que el agente
        no supo responder. Devuelve `None` si no hay nada que registrar
        (pregunta vacía, tenant vacío) o si el tope de pendientes del tenant
        ya se alcanzó."""
        return await self._record(
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            kind="unanswered_question",
            question=question,
        )

    async def record_handoff(
        self,
        *,
        tenant_id: str,
        conversation_id: str,
        summary: str,
        reason: str | None = None,
    ) -> LearningSignal | None:
        """Registra (o refuerza) un handoff a humano. `summary` es la
        pregunta/resumen que se muestra en el panel; `reason` es el motivo
        corto (p. ej. el `motivo` de la tool `escalar_a_humano`)."""
        return await self._record(
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            kind="handoff",
            question=summary,
            reason=reason,
        )

    async def _record(
        self,
        *,
        tenant_id: str,
        conversation_id: str,
        kind: str,
        question: str,
        reason: str | None = None,
    ) -> LearningSignal | None:
        if kind not in VALID_KINDS:
            raise ValueError(f"kind inválido: {kind!r}")
        tenant_id = (tenant_id or "").strip()
        question = (question or "").strip()[:MAX_QUESTION_CHARS]
        if not tenant_id or not question:
            return None
        norm = _normalize(question)
        now = time.time()
        conn = await self._conn_ready()
        async with self._write_lock:
            cur = await conn.execute(
                "SELECT * FROM learning_signals "
                "WHERE tenant_id=? AND kind=? AND question_norm=? AND status='pending' "
                "LIMIT 1",
                (tenant_id, kind, norm),
            )
            row = await cur.fetchone()
            if row is not None:
                # Ya hay una sugerencia igual pendiente: no duplicar, solo
                # sumar el conteo (criterio de producto: la cola la lee una
                # persona, no debe crecer con copias idénticas).
                await conn.execute(
                    "UPDATE learning_signals SET occurrences = occurrences + 1, "
                    "last_seen_at=?, conversation_id=? WHERE id=?",
                    (now, conversation_id, row["id"]),
                )
                await conn.commit()
                cur = await conn.execute(
                    "SELECT * FROM learning_signals WHERE id=?", (row["id"],)
                )
                return _row_to_signal(await cur.fetchone())

            cur = await conn.execute(
                "SELECT COUNT(*) AS n FROM learning_signals "
                "WHERE tenant_id=? AND status='pending'",
                (tenant_id,),
            )
            pending = (await cur.fetchone())["n"]
            if pending >= self._max_pending_per_tenant:
                # Tope alcanzado: se prefiere perder una señal nueva a dejar
                # crecer sin control la cola que revisa una persona.
                return None

            sig = LearningSignal(
                id=str(uuid.uuid4()),
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                kind=kind,
                question=question,
                reason=(reason or "").strip()[:MAX_REASON_CHARS] or None,
                created_at=now,
                last_seen_at=now,
            )
            await conn.execute(
                "INSERT INTO learning_signals "
                "(id, tenant_id, conversation_id, kind, question, question_norm, "
                "reason, created_at, last_seen_at, status, doc_id, occurrences) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 1)",
                (
                    sig.id,
                    sig.tenant_id,
                    sig.conversation_id,
                    sig.kind,
                    sig.question,
                    norm,
                    sig.reason,
                    sig.created_at,
                    sig.last_seen_at,
                ),
            )
            await conn.commit()
            await self._prune_if_needed(conn)
            return sig

    async def _prune_if_needed(self, conn: aiosqlite.Connection) -> None:
        cur = await conn.execute("SELECT COUNT(*) AS n FROM learning_signals")
        total = (await cur.fetchone())["n"]
        overflow = total - self._max_total_rows
        if overflow <= 0:
            return
        # Solo se podan filas ya resueltas (aprobadas/descartadas), nunca
        # pendientes: preferible que el tope total se pase un poco a borrar
        # sugerencias que nadie alcanzó a revisar.
        await conn.execute(
            "DELETE FROM learning_signals WHERE id IN ("
            "SELECT id FROM learning_signals WHERE status != 'pending' "
            "ORDER BY last_seen_at ASC LIMIT ?)",
            (overflow,),
        )
        await conn.commit()

    # ------------------------------------------------------------- lectura

    async def list_signals(
        self, *, tenant_id: str | None = None, status: str | None = "pending"
    ) -> list[LearningSignal]:
        """Lista señales, más recientes primero. `tenant_id=None` solo debe
        usarse desde una vista de operación interna (ver reporte): el panel
        del dueño de un negocio siempre debe mandar su propio tenant."""
        conn = await self._conn_ready()
        query = "SELECT * FROM learning_signals WHERE 1=1"
        params: list[Any] = []
        if tenant_id:
            query += " AND tenant_id=?"
            params.append(tenant_id)
        if status:
            if status not in VALID_STATUSES:
                raise ValueError(f"status inválido: {status!r}")
            query += " AND status=?"
            params.append(status)
        query += " ORDER BY last_seen_at DESC"
        cur = await conn.execute(query, params)
        rows = await cur.fetchall()
        return [_row_to_signal(r) for r in rows]

    async def get(self, signal_id: str) -> LearningSignal | None:
        conn = await self._conn_ready()
        cur = await conn.execute("SELECT * FROM learning_signals WHERE id=?", (signal_id,))
        row = await cur.fetchone()
        return _row_to_signal(row) if row else None

    # --------------------------------------------------------- resolución

    async def dismiss(self, signal_id: str, *, tenant_id: str | None = None) -> LearningSignal:
        """Descarta una señal (idempotente: descartar dos veces no falla).

        Excepciones: `SignalNotFoundError` si el id no existe;
        `SignalTenantMismatchError` si se pasó `tenant_id` y no coincide.
        """
        return await self._set_status(signal_id, "dismissed", tenant_id=tenant_id)

    async def approve(
        self,
        signal_id: str,
        *,
        answer: str,
        tenant_id: str | None = None,
    ) -> LearningSignal:
        """Aprueba una señal: la respuesta la escribe una persona (este
        endpoint), nunca el modelo a partir de la conversación. Se vuelca a
        `knowledge_dir/aprendizajes.md` (ver `_append_to_knowledge`) y recién
        entonces se marca `approved` con el `doc_id` resultante.

        Excepciones: `ValueError` si `answer` viene vacía;
        `SignalNotFoundError` si el id no existe;
        `SignalTenantMismatchError` si se pasó `tenant_id` y no coincide.
        Idempotente en el sentido de v1: volver a aprobar una señal ya
        aprobada vuelve a escribir la entrada y no falla.
        """
        answer = (answer or "").strip()
        if not answer:
            raise ValueError("La respuesta no puede estar vacía")
        answer = answer[:MAX_ANSWER_CHARS]

        sig = await self.get(signal_id)
        if sig is None:
            raise SignalNotFoundError(signal_id)
        if tenant_id is not None and sig.tenant_id != tenant_id:
            raise SignalTenantMismatchError(signal_id)

        doc_id = await self._append_to_knowledge(sig, answer)
        return await self._set_status(
            signal_id, "approved", tenant_id=tenant_id, doc_id=doc_id
        )

    async def _set_status(
        self,
        signal_id: str,
        status: str,
        *,
        tenant_id: str | None = None,
        doc_id: str | None = None,
    ) -> LearningSignal:
        conn = await self._conn_ready()
        async with self._write_lock:
            cur = await conn.execute(
                "SELECT * FROM learning_signals WHERE id=?", (signal_id,)
            )
            row = await cur.fetchone()
            if row is None:
                raise SignalNotFoundError(signal_id)
            if tenant_id is not None and row["tenant_id"] != tenant_id:
                raise SignalTenantMismatchError(signal_id)
            now = time.time()
            if doc_id is not None:
                await conn.execute(
                    "UPDATE learning_signals SET status=?, doc_id=?, last_seen_at=? "
                    "WHERE id=?",
                    (status, doc_id, now, signal_id),
                )
            else:
                await conn.execute(
                    "UPDATE learning_signals SET status=?, last_seen_at=? WHERE id=?",
                    (status, now, signal_id),
                )
            await conn.commit()
            cur = await conn.execute(
                "SELECT * FROM learning_signals WHERE id=?", (signal_id,)
            )
            return _row_to_signal(await cur.fetchone())

    async def _append_to_knowledge(self, sig: LearningSignal, answer: str) -> str:
        """Vuelca la Q/A aprobada a un `.md` propio del ciclo de aprendizaje.

        NO se llama a `knowledge.py` (está en cambio en paralelo): se escribe
        directo un archivo markdown que el loader existente de `knowledge.py`
        ya recoge solo, porque itera `*.md` del directorio. Ver el reporte de
        entrega sobre la limitación de que este archivo es compartido entre
        tenants mientras `knowledge_dir` no esté particionado por tenant.
        """
        path = self._knowledge_dir / "aprendizajes.md"
        stamp = time.strftime("%Y-%m-%d %H:%M", time.localtime(sig.last_seen_at))
        # La nota "> interno:" la separa `knowledge.py` del cuerpo público
        # (no se le cita al cliente) pero sí llega al modelo como contexto:
        # sirve para trazabilidad sin ensuciar la respuesta con metadata.
        entry = (
            f"## {sig.question}\n\n"
            f"{answer}\n\n"
            f"> interno: aprobado desde el panel de aprendizaje el {stamp} "
            f"(tenant {sig.tenant_id}, señal {sig.id[:8]})\n\n"
            "---\n\n"
        )
        async with self._file_lock:
            self._knowledge_dir.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as fh:
                fh.write(entry)
        return f"aprendizajes.md#{sig.id[:8]}"


_STORE: LearningStore | None = None


def get_learning_store() -> LearningStore:
    """Singleton perezoso, mismo patrón que v1. No toca disco hasta el
    primer uso real (ver `LearningStore._conn_ready`)."""
    global _STORE
    if _STORE is None:
        from .config import get_settings

        settings = get_settings()
        _STORE = LearningStore(
            db_path=settings.data_dir / "learning.sqlite",
            knowledge_dir=settings.knowledge_dir,
        )
    return _STORE
