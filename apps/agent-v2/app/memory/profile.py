"""Memoria del cliente por número de teléfono.

Qué resuelve
------------
El checkpoint de LangGraph vive en un ``thread_id`` = ``tenant:conversación``.
Cuando una conversación se cierra (handoff resuelto, cierre desde el panel,
autocierre por inactividad) y el mismo cliente vuelve a escribir días después,
el canal abre una conversación nueva: hilo nuevo, estado vacío, y el agente
vuelve a preguntar el nombre, la dirección y qué le interesaba. Esta capa es
la que sobrevive a eso.

La llave es **el teléfono**, no la conversación: es el único identificador
estable de un cliente de WhatsApp. Se guarda en un SQLite propio
(``customer-profiles.sqlite``), particionado por tenant, y se reinyecta al
prompt como bloque ``<memoria_cliente>`` en cuanto ese número vuelve a
escribir.

Qué NO es
---------
No es la memoria episódica (``episodic.py``): aquélla aprende *cómo* conversar
y por eso no puede contener datos de nadie. Ésta existe precisamente para
recordar a **este** cliente, así que sí guarda sus datos — y por eso tiene sus
propias reglas:

* **Aislamiento por tenant**: la llave primaria es ``(tenant_id, phone_key)``
  y toda consulta lleva el ``tenant_id``. Un negocio nunca ve al cliente de
  otro, aunque sea el mismo número.
* **El teléfono no se guarda en claro**: la llave es un HMAC-SHA256 del número
  normalizado con el ``tenant_id`` como sal. Sirve para buscar, no para leer;
  una filtración del archivo no entrega la lista de teléfonos.
* **Esquema cerrado y acotado**: nombre, correo, ciudad/CP, preferencias,
  última etapa y un resumen corto. Las listas tienen tope y cada campo de
  texto pasa por ``guards.pii.redact`` para que no se cuele un número de
  tarjeta ni un dato que nadie pidió recordar.
* **Caducidad y borrado**: ``ttl_days`` deja de inyectar un perfil inactivo y
  ``delete`` / ``delete_tenant`` lo borran de verdad (derecho al olvido).

El bloque que entra al prompt es DATO, no instrucción, y va delimitado como
todos los demás (ver ``prompts/assembler.py``).
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
import time
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import aiosqlite

from ..guards.pii import redact

logger = logging.getLogger(__name__)

MAX_LIST_ITEMS = 5
MAX_ITEM_CHARS = 120
MAX_SUMMARY_CHARS = 400
MAX_NAME_CHARS = 80
DEFAULT_MAX_ROWS_PER_TENANT = 50_000

_DIGITS_RE = re.compile(r"\D+")
_EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


def normalize_phone(phone: str | None) -> str:
    """Sólo dígitos, sin el `1` que WhatsApp agrega a los móviles mexicanos.

    `+52 1 55 1234 5678`, `5215512345678` y `525512345678` tienen que dar la
    misma llave: si no, el mismo cliente estrena perfil según por dónde entre
    su número.
    """
    digits = _DIGITS_RE.sub("", phone or "")
    if len(digits) == 13 and digits.startswith("521"):
        digits = "52" + digits[3:]
    return digits


def profile_key(tenant_id: str, phone: str | None) -> str:
    """HMAC del teléfono normalizado con el tenant como sal, o "" si no hay número.

    Se usa el tenant como clave del HMAC —no una sal global— para que la misma
    llave no correlacione al mismo número entre dos negocios distintos.
    """
    digits = normalize_phone(phone)
    if len(digits) < 8:
        return ""
    return hmac.new(tenant_id.encode("utf-8"), digits.encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def _clean(text: Any, limit: int, *, strip_pii: bool = True) -> str:
    """Texto corto de una línea.

    ``strip_pii`` enmascara correos y teléfonos con ``guards.pii.redact``. Va
    activo en todo lo que viene de texto libre (intereses, notas, resumen):
    ahí un dato personal entra por accidente y no aporta nada. Va APAGADO en
    los campos que existen para guardar justo ese dato —nombre, correo,
    ciudad, CP—, que es lo que el cliente dio a propósito y lo que hace útil
    volver a atenderlo.
    """
    value = str(text or "")
    if strip_pii:
        value = redact(value)
    return " ".join(value.split())[:limit]


def _clean_list(values: Any) -> list[str]:
    if not isinstance(values, (list, tuple)):
        return []
    out: list[str] = []
    for item in values:
        text = _clean(item, MAX_ITEM_CHARS)
        if text and text not in out:
            out.append(text)
        if len(out) >= MAX_LIST_ITEMS:
            break
    return out


@dataclass
class CustomerProfile:
    """Lo que el negocio recuerda de un cliente entre conversaciones."""

    tenant_id: str
    phone_key: str
    created_at: float
    updated_at: float
    conversations: int = 0
    name: str = ""
    email: str = ""
    city: str = ""
    postal_code: str = ""
    delivery_mode: str = ""
    interests: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    last_stage: str = ""
    last_outcome: str = ""
    summary: str = ""
    source: str = "heuristic"  # "heuristic" | "llm"

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        return {
            "tenantId": data["tenant_id"],
            "phoneKey": data["phone_key"],
            "createdAt": data["created_at"],
            "updatedAt": data["updated_at"],
            "conversations": data["conversations"],
            "name": data["name"],
            "email": data["email"],
            "city": data["city"],
            "postalCode": data["postal_code"],
            "deliveryMode": data["delivery_mode"],
            "interests": data["interests"],
            "notes": data["notes"],
            "lastStage": data["last_stage"],
            "lastOutcome": data["last_outcome"],
            "summary": data["summary"],
            "source": data["source"],
        }


def render_profile(profile: CustomerProfile | None, *, now: float | None = None) -> str:
    """Bloque ``<memoria_cliente>`` (sin los delimitadores, los pone el assembler).

    Devuelve "" si no hay nada que valga la pena inyectar: un perfil recién
    creado sin un solo dato no aporta y sí gasta tokens en cada turno.
    """
    if profile is None:
        return ""
    lines: list[str] = []
    if profile.name:
        lines.append(f"Nombre con el que se presentó antes: {profile.name}.")
    if profile.email:
        lines.append(f"Correo que dio antes: {profile.email}.")
    where = ", ".join(p for p in (profile.city, profile.postal_code) if p)
    if where:
        lines.append(f"Zona de entrega de compras anteriores: {where}.")
    if profile.delivery_mode:
        lines.append(f"Prefiere entrega tipo {profile.delivery_mode}.")
    if profile.interests:
        lines.append("Le han interesado: " + ", ".join(profile.interests) + ".")
    if profile.notes:
        lines.extend(f"- {note}" for note in profile.notes)
    if profile.summary:
        lines.append(profile.summary)
    if profile.conversations > 1:
        lines.append(f"Conversaciones previas con este negocio: {profile.conversations}.")
        if profile.last_outcome:
            lines.append(f"La última terminó en: {profile.last_outcome}.")
    if not lines:
        return ""
    when = time.strftime("%Y-%m-%d", time.localtime(profile.updated_at))
    lines.append(f"(Última vez que escribió: {when}.)")
    return "\n".join(lines)


def merge_profile(
    previous: CustomerProfile | None,
    *,
    tenant_id: str,
    phone_key: str,
    facts: dict[str, Any],
    now: float | None = None,
) -> CustomerProfile:
    """Perfil nuevo = perfil anterior + lo aprendido en esta conversación.

    Los campos escalares se pisan sólo si la conversación trajo un valor
    nuevo: que el cliente no vuelva a decir su nombre no significa que lo haya
    perdido. Las listas se acumulan con tope, lo más reciente primero.
    """
    stamp = now if now is not None else time.time()
    base = previous or CustomerProfile(
        tenant_id=tenant_id, phone_key=phone_key, created_at=stamp, updated_at=stamp
    )

    def pick(key: str, current: str, limit: int, *, strip_pii: bool = False) -> str:
        return _clean(facts.get(key), limit, strip_pii=strip_pii) or current

    email = pick("email", base.email, MAX_ITEM_CHARS)
    if email and not _EMAIL_RE.fullmatch(email):
        email = base.email

    interests = _clean_list(facts.get("interests")) + base.interests
    notes = _clean_list(facts.get("notes")) + base.notes

    return CustomerProfile(
        tenant_id=tenant_id,
        phone_key=phone_key,
        created_at=base.created_at,
        updated_at=stamp,
        conversations=base.conversations + 1,
        name=pick("name", base.name, MAX_NAME_CHARS),
        email=email,
        city=pick("city", base.city, MAX_ITEM_CHARS),
        postal_code=pick("postal_code", base.postal_code, 12),
        delivery_mode=pick("delivery_mode", base.delivery_mode, 20),
        interests=list(dict.fromkeys(interests))[:MAX_LIST_ITEMS],
        notes=list(dict.fromkeys(notes))[:MAX_LIST_ITEMS],
        last_stage=pick("last_stage", base.last_stage, 40),
        last_outcome=pick("last_outcome", base.last_outcome, 40),
        summary=_clean(facts.get("summary"), MAX_SUMMARY_CHARS, strip_pii=True) or base.summary,
        source=str(facts.get("source") or base.source or "heuristic")[:20],
    )


def facts_from_state(state: dict[str, Any]) -> dict[str, Any]:
    """Hechos duraderos derivados del estado comercial, sin LLM.

    El estado es la fuente de verdad de lo que el cliente dijo de sí mismo
    (``recordar_cliente`` lo escribe ahí) y de lo que puso en el carrito, así
    que esto funciona igual sin key de modelo.
    """
    customer = state.get("customer") or {}
    carts = state.get("carts") or {}
    interests: list[str] = []
    delivery_mode = ""
    outcome = ""
    for record in carts.values():
        for line in record.get("lines") or []:
            title = line.get("title") or line.get("sku")
            if title:
                interests.append(str(title))
        delivery_mode = delivery_mode or str(record.get("deliveryMode") or "")
        if record.get("checkoutLink"):
            outcome = "PAGO_ENVIADO"
        elif record.get("quoteId") and outcome != "PAGO_ENVIADO":
            outcome = "COTIZACION_EMITIDA"
    if not outcome and carts:
        outcome = "CARRITO_SIN_CIERRE"
    if state.get("handoff"):
        outcome = "ESCALADO"

    # La dirección vive en `delivery_address` (la escribe
    # `recordar_direccion_entrega`), no dentro de `customer`.
    address = state.get("delivery_address") or {}
    if not isinstance(address, dict):
        address = {}
    return {
        "name": customer.get("name") or "",
        "email": customer.get("email") or "",
        "city": address.get("city") or "",
        "postal_code": address.get("postalCode") or address.get("postal_code") or "",
        "delivery_mode": delivery_mode,
        "interests": interests,
        "last_stage": state.get("stage") or "",
        "last_outcome": outcome,
        "source": "heuristic",
    }


# ---------------------------------------------------------------- store

_SCHEMA = """
CREATE TABLE IF NOT EXISTS customer_profiles (
    tenant_id TEXT NOT NULL,
    phone_key TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    conversations INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    postal_code TEXT NOT NULL DEFAULT '',
    delivery_mode TEXT NOT NULL DEFAULT '',
    interests TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '[]',
    last_stage TEXT NOT NULL DEFAULT '',
    last_outcome TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'heuristic',
    PRIMARY KEY (tenant_id, phone_key)
);
"""
_INDEXES = (
    (
        "CREATE INDEX IF NOT EXISTS idx_profiles_tenant_updated "
        "ON customer_profiles(tenant_id, updated_at DESC)"
    ),
)


def _row_to_profile(row: aiosqlite.Row) -> CustomerProfile:
    return CustomerProfile(
        tenant_id=row["tenant_id"],
        phone_key=row["phone_key"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        conversations=row["conversations"],
        name=row["name"],
        email=row["email"],
        city=row["city"],
        postal_code=row["postal_code"],
        delivery_mode=row["delivery_mode"],
        interests=json.loads(row["interests"] or "[]"),
        notes=json.loads(row["notes"] or "[]"),
        last_stage=row["last_stage"],
        last_outcome=row["last_outcome"],
        summary=row["summary"],
        source=row["source"],
    )


class CustomerProfileStore:
    """Perfiles en SQLite, particionados por tenant. Perezoso: no toca disco
    hasta el primer uso."""

    def __init__(
        self,
        db_path: Path,
        *,
        ttl_days: int = 365,
        max_rows_per_tenant: int = DEFAULT_MAX_ROWS_PER_TENANT,
    ) -> None:
        self._db_path = Path(db_path)
        self._ttl_days = max(0, ttl_days)
        self._max_rows_per_tenant = max_rows_per_tenant
        self._conn: aiosqlite.Connection | None = None
        self._init_lock = asyncio.Lock()
        self._write_lock = asyncio.Lock()

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

    def is_fresh(self, profile: CustomerProfile, *, now: float | None = None) -> bool:
        """`False` si el perfil lleva más de ``ttl_days`` sin actividad."""
        if self._ttl_days == 0:
            return True
        stamp = now if now is not None else time.time()
        return stamp - profile.updated_at <= self._ttl_days * 86_400

    async def get(self, tenant_id: str, phone: str | None) -> CustomerProfile | None:
        key = profile_key(tenant_id, phone)
        if not key:
            return None
        conn = await self._conn_ready()
        cur = await conn.execute(
            "SELECT * FROM customer_profiles WHERE tenant_id=? AND phone_key=?",
            (tenant_id, key),
        )
        row = await cur.fetchone()
        return _row_to_profile(row) if row else None

    async def block_for(self, tenant_id: str, phone: str | None) -> str:
        """Bloque listo para el prompt, o "" si no hay perfil útil o ya caducó."""
        profile = await self.get(tenant_id, phone)
        if profile is None or not self.is_fresh(profile):
            return ""
        return render_profile(profile)

    async def remember(
        self,
        tenant_id: str,
        phone: str | None,
        facts: dict[str, Any],
        *,
        now: float | None = None,
    ) -> CustomerProfile | None:
        """Funde lo aprendido con lo que ya había y lo guarda. `None` sin teléfono."""
        key = profile_key(tenant_id, phone)
        if not key:
            return None
        previous = await self.get(tenant_id, phone)
        merged = merge_profile(
            previous, tenant_id=tenant_id, phone_key=key, facts=facts, now=now
        )
        await self.save(merged)
        return merged

    async def save(self, profile: CustomerProfile) -> CustomerProfile:
        conn = await self._conn_ready()
        async with self._write_lock:
            await conn.execute(
                "INSERT INTO customer_profiles (tenant_id, phone_key, created_at, updated_at, "
                "conversations, name, email, city, postal_code, delivery_mode, interests, notes, "
                "last_stage, last_outcome, summary, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(tenant_id, phone_key) DO UPDATE SET "
                "updated_at=excluded.updated_at, conversations=excluded.conversations, "
                "name=excluded.name, email=excluded.email, city=excluded.city, "
                "postal_code=excluded.postal_code, delivery_mode=excluded.delivery_mode, "
                "interests=excluded.interests, notes=excluded.notes, "
                "last_stage=excluded.last_stage, last_outcome=excluded.last_outcome, "
                "summary=excluded.summary, source=excluded.source",
                (
                    profile.tenant_id,
                    profile.phone_key,
                    profile.created_at,
                    profile.updated_at,
                    profile.conversations,
                    profile.name,
                    profile.email,
                    profile.city,
                    profile.postal_code,
                    profile.delivery_mode,
                    json.dumps(profile.interests, ensure_ascii=False),
                    json.dumps(profile.notes, ensure_ascii=False),
                    profile.last_stage,
                    profile.last_outcome,
                    profile.summary,
                    profile.source,
                ),
            )
            await conn.execute(
                "DELETE FROM customer_profiles WHERE tenant_id=? AND phone_key NOT IN ("
                "SELECT phone_key FROM customer_profiles WHERE tenant_id=? "
                "ORDER BY updated_at DESC LIMIT ?)",
                (profile.tenant_id, profile.tenant_id, self._max_rows_per_tenant),
            )
            await conn.commit()
        return profile

    async def list(self, tenant_id: str, *, limit: int = 50) -> list[CustomerProfile]:
        conn = await self._conn_ready()
        cur = await conn.execute(
            "SELECT * FROM customer_profiles WHERE tenant_id=? ORDER BY updated_at DESC LIMIT ?",
            (tenant_id, max(1, min(limit, 500))),
        )
        return [_row_to_profile(r) for r in await cur.fetchall()]

    async def delete(self, tenant_id: str, phone: str | None) -> int:
        """Derecho al olvido de UN cliente."""
        key = profile_key(tenant_id, phone)
        if not key:
            return 0
        conn = await self._conn_ready()
        async with self._write_lock:
            cur = await conn.execute(
                "DELETE FROM customer_profiles WHERE tenant_id=? AND phone_key=?",
                (tenant_id, key),
            )
            await conn.commit()
        return cur.rowcount or 0

    async def delete_tenant(self, tenant_id: str) -> int:
        conn = await self._conn_ready()
        async with self._write_lock:
            cur = await conn.execute(
                "DELETE FROM customer_profiles WHERE tenant_id=?", (tenant_id,)
            )
            await conn.commit()
        return cur.rowcount or 0

    async def stats(self, tenant_id: str) -> dict[str, Any]:
        profiles = await self.list(tenant_id, limit=500)
        returning = sum(1 for p in profiles if p.conversations > 1)
        outcomes: dict[str, int] = {}
        for p in profiles:
            if p.last_outcome:
                outcomes[p.last_outcome] = outcomes.get(p.last_outcome, 0) + 1
        return {
            "tenantId": tenant_id,
            "profiles": len(profiles),
            "returning": returning,
            "withName": sum(1 for p in profiles if p.name),
            "lastOutcome": dict(sorted(outcomes.items(), key=lambda kv: -kv[1])),
        }


_STORE: CustomerProfileStore | None = None


def get_profile_store() -> CustomerProfileStore:
    """Singleton perezoso sobre ``settings.customer_profiles_path``."""
    global _STORE
    if _STORE is None:
        from ..config import get_settings

        settings = get_settings()
        _STORE = CustomerProfileStore(
            settings.customer_profiles_path, ttl_days=settings.customer_memory_ttl_days
        )
    return _STORE


def reset_profile_store() -> None:
    """Para pruebas."""
    global _STORE
    _STORE = None


# ------------------------------------------------------------------ LLM

_EXTRACTION_SYSTEM = """\
Extraes lo que conviene RECORDAR de un cliente para la próxima vez que \
escriba a este mismo negocio. No resumes la conversación: anotas hechos \
duraderos.

Responde SOLO un JSON con esta forma exacta:
{"name": "", "email": "", "city": "", "postal_code": "", \
"delivery_mode": "", "interests": [], "notes": [], "summary": ""}

- name / email / city / postal_code: sólo si el cliente los dijo en esta \
conversación. Si no los dijo, cadena vacía. No los inventes ni los deduzcas.
- delivery_mode: PICKUP o DELIVERY, si quedó claro. Si no, vacío.
- interests: hasta 5 productos o categorías por los que preguntó, en sus \
palabras, sin precios.
- notes: hasta 5 preferencias útiles para atenderlo mejor la próxima vez \
(horarios, forma de pago preferida, cómo le gusta que le hablen). Nada de \
juicios sobre la persona.
- summary: máximo 2 líneas sobre en qué quedó la conversación.

PROHIBIDO: números de tarjeta, contraseñas, datos de salud, y cualquier dato \
que el cliente no haya dado él mismo.\
"""


async def extract_facts_with_llm(
    model: Any, messages: Sequence[Any], state: dict[str, Any]
) -> dict[str, Any]:
    """Hechos duraderos según el modelo, fundidos sobre los deterministas.

    Nunca lanza: si el modelo falla o responde algo que no es JSON, se
    devuelven los hechos deterministas y se sigue.
    """
    base = facts_from_state(state)
    transcript: list[str] = []
    for message in messages:
        content = getattr(message, "content", "")
        text = content if isinstance(content, str) else str(content)
        role = type(message).__name__.replace("Message", "").lower()
        if role in {"human", "ai"} and text.strip():
            transcript.append(f"{role}: {text.strip()[:600]}")
    if not transcript:
        return base
    try:
        from langchain_core.messages import HumanMessage as _Human
        from langchain_core.messages import SystemMessage as _System

        result = await model.ainvoke(
            [_System(_EXTRACTION_SYSTEM), _Human("\n".join(transcript)[-12_000:])]
        )
        content = getattr(result, "content", "")
        payload = json.loads(content if isinstance(content, str) else str(content))
    except Exception:
        logger.warning("extracción de perfil por LLM falló; se usa la determinista", exc_info=True)
        return base
    if not isinstance(payload, dict):
        return base

    merged = dict(base)
    for key in ("name", "email", "city", "postal_code", "delivery_mode", "summary"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            merged[key] = value.strip()
    for key in ("interests", "notes"):
        value = payload.get(key)
        if isinstance(value, list) and value:
            merged[key] = list(value) + list(merged.get(key) or [])
    merged["source"] = "llm"
    return merged
