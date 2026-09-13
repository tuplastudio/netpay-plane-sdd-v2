"""Configuración del agente por tenant, editable desde el panel.

Puerto de `apps/agent-service/app/agent_settings.py` (v1) a v2: mismo esquema
JSON por tenant, así el panel del frontend (`agent-settings-form.tsx`) puede
apuntar a este servicio sin cambios. Los valores vacíos/None caen al perfil de
`negocio.md` (ver `knowledge.py`) y a las variables de entorno de `config.py`,
así que sin configurar nada el agente sigue igual que hoy.

`classifier_model` se conserva solo por compatibilidad de esquema con el
panel: v2 no tiene paso de clasificación de intención separado (a diferencia
de v1), así que ese campo no se lee en ningún lado todavía.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import time
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import SERVICE_DIR, _env

SALES_STYLES: tuple[str, ...] = ("cerrador", "consultivo", "informativo")
DELIVERY_MODES: tuple[str, ...] = ("PICKUP", "LOCAL_DELIVERY")

# Qué hacer cuando el filtro detecta que una respuesta humana maltrata al
# cliente: "block" no la manda y le pide al operador que la reescriba;
# "warn" la manda igual pero deja constancia del hallazgo.
HUMAN_REPLY_FILTER_ACTIONS: tuple[str, ...] = ("block", "warn")

# ---- Autocierre por inactividad ----
# Formato compacto que pidió el negocio: 30s, 15m, 2h, 1d.
_DURATION_RE = re.compile(r"^(\d{1,7})(s|m|h|d)$")
_DURATION_UNIT_SECONDS: dict[str, int] = {"s": 1, "m": 60, "h": 3600, "d": 86400}
# Menos de 30s cerraría hilos vivos (el cliente todavía está tecleando) y más
# de 30d no cierra nada en la práctica: los extremos se recortan, no se
# rechazan, para que un valor raro no deje al panel sin poder guardar.
AUTO_CLOSE_MIN_SECONDS = 30
AUTO_CLOSE_MAX_SECONDS = 30 * 86400


def duration_to_seconds(value: str) -> int:
    """`"2h"` -> 7200. 0 si la cadena no tiene el formato compacto."""
    match = _DURATION_RE.match((value or "").strip().lower())
    if not match:
        return 0
    amount, unit = match.groups()
    return int(amount) * _DURATION_UNIT_SECONDS[unit]


def normalize_duration(value: str) -> str:
    """Cadena canónica ya recortada al rango permitido, o "" si no es válida.

    Se conserva la unidad que escribió la persona (`90m` no se reescribe a
    `1h`): el panel muestra de vuelta lo que tecleó. Solo cambia si hubo que
    recortar, y entonces se emite en la unidad más grande que dé exacto.
    """
    seconds = duration_to_seconds(value)
    if seconds <= 0:
        return ""
    clamped = max(AUTO_CLOSE_MIN_SECONDS, min(AUTO_CLOSE_MAX_SECONDS, seconds))
    if clamped == seconds:
        return (value or "").strip().lower()
    for unit, size in (("d", 86400), ("h", 3600), ("m", 60), ("s", 1)):
        if clamped % size == 0:
            return f"{clamped // size}{unit}"
    return f"{clamped}s"


def _secret_key() -> bytes:
    """Clave AES-256 derivada de AGENT_SECRET_KEY (env var, cualquier largo).

    No es un KMS de producción: una sola clave simétrica de servidor, igual
    para todos los tenants (solo protege el archivo en disco, no separa
    blast radius entre tenants). Suficiente para esta etapa del proyecto.
    """
    raw = _env("AGENT_SECRET_KEY") or "dev-insecure-default-key-change-me"
    return hashlib.sha256(raw.encode("utf-8")).digest()


def encrypt_secret(plaintext: str) -> str:
    """AES-256-GCM: nonce(12) + ciphertext+tag, todo en base64url."""
    if not plaintext:
        return ""
    aesgcm = AESGCM(_secret_key())
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.urlsafe_b64encode(nonce + ciphertext).decode("ascii")


def decrypt_secret(blob: str) -> str:
    if not blob:
        return ""
    try:
        raw = base64.urlsafe_b64decode(blob.encode("ascii"))
        nonce, ciphertext = raw[:12], raw[12:]
        aesgcm = AESGCM(_secret_key())
        return aesgcm.decrypt(nonce, ciphertext, None).decode("utf-8")
    except Exception:
        # Blob corrupto o clave rotada: tratar como "sin key propia" en vez
        # de tumbar el turno de chat.
        return ""


@dataclass
class AgentSettings:
    # Identidad (vacío = tomar del frontmatter de negocio.md)
    agent_name: str = ""
    business_name: str = ""
    tone: str = ""
    greeting: str = ""
    language: str = ""
    currency: str = ""
    emoji: bool | None = None

    # Comportamiento comercial
    sales_style: str = "cerrador"  # cerrador | consultivo | informativo
    ask_name_before_quote: bool = True
    ask_email_before_quote: bool = False
    auto_history_lookup: bool = True
    max_products_per_message: int = 3
    default_delivery_mode: str = "PICKUP"
    handoff_keywords: list[str] = field(default_factory=list)
    forbidden_topics: str = ""
    extra_rules: str = ""

    # Modelos (vacío = env MODEL_ID; classifier_model sin uso en v2, ver docstring)
    text_model: str = ""
    classifier_model: str = ""
    temperature: float | None = None
    max_tokens: int | None = None

    # OpenRouter propio del tenant (vacío = usar la key global del proceso).
    # Cifrado at-rest con AES-256-GCM (ver encrypt_secret/decrypt_secret);
    # nunca se guarda ni se devuelve en texto plano fuera de build_model.
    openrouter_api_key_encrypted: str = ""

    # Prompt versionado (ver app/prompts/registry.py). "" = usar el default del
    # proceso (`PROMPT_VERSION`, normalmente "latest"); "latest" explícito o
    # "X.Y.Z" fijan una versión. Una versión inexistente degrada a latest.
    prompt_version: str = ""

    # Canal
    whatsapp_plain_text: bool = True
    auto_reply: bool = True

    # ---- Atención humana: filtro de respuestas del operador ----
    # Cada respuesta que escribe una persona pasa por un modelo pequeño antes
    # de salir. Apagado por defecto: cada revisión es una llamada al LLM que
    # el negocio paga, así que se activa a conciencia.
    human_reply_filter_enabled: bool = False
    # Vacío = el modelo barato por defecto del servicio (ver moderation.py).
    human_reply_filter_model: str = ""
    human_reply_filter_action: str = "block"  # block | warn

    # ---- Atención humana: autocierre por inactividad ----
    # Apagado ("desconfigurado") de fábrica. `auto_close_after` es la ventana
    # sin mensajes en formato compacto: 30s, 15m, 2h, 1d.
    auto_close_enabled: bool = False
    auto_close_after: str = ""

    updated_at: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        """Para el panel: nunca expone el cifrado, solo si hay una key guardada."""
        data = asdict(self)
        data["openrouter_api_key_set"] = bool(self.openrouter_api_key_encrypted)
        data.pop("openrouter_api_key_encrypted", None)
        return data

    def effective_model(self, default: str) -> str:
        return self.text_model.strip() or default

    def openrouter_api_key(self) -> str:
        """Key propia del tenant en claro, o "" si no configuró una."""
        return decrypt_secret(self.openrouter_api_key_encrypted)

    def auto_close_seconds(self) -> int:
        """Ventana de inactividad en segundos, o 0 si no hay autocierre.

        El valor guardado se ignora mientras el check está apagado: así se
        conserva lo que la persona escribió (para cuando lo vuelva a
        encender) sin que el job lo tome como configuración activa.
        """
        if not self.auto_close_enabled:
            return 0
        return duration_to_seconds(self.auto_close_after)


_BOOL_FIELDS = {"ask_name_before_quote", "ask_email_before_quote", "auto_history_lookup",
                "whatsapp_plain_text", "auto_reply", "human_reply_filter_enabled",
                "auto_close_enabled"}
_OPT_BOOL_FIELDS = {"emoji"}
_STR_LIMITS = {
    "agent_name": 60, "business_name": 120, "tone": 300, "greeting": 300,
    "language": 10, "currency": 8, "forbidden_topics": 2000, "extra_rules": 4000,
    "text_model": 120, "classifier_model": 120, "human_reply_filter_model": 120,
}
_PROMPT_VERSION_RE = re.compile(r"^(latest|v?\d+\.\d+\.\d+)$")


def sanitize(payload: dict[str, Any], base: AgentSettings | None = None) -> AgentSettings:
    """Valida y recorta un payload del panel. Campos desconocidos se ignoran."""
    current = base or AgentSettings()
    data = asdict(current)  # incluye openrouter_api_key_encrypted; to_dict() lo oculta
    allowed = {f.name for f in fields(AgentSettings)} - {"updated_at"}

    # Caso especial: el panel manda la key en claro bajo un nombre que no es
    # un campo real del dataclass (nunca se guarda tal cual). "" borra la key
    # guardada; ausente/no-string deja la que ya había.
    if "openrouter_api_key" in payload:
        raw_key = payload["openrouter_api_key"]
        if isinstance(raw_key, str):
            data["openrouter_api_key_encrypted"] = encrypt_secret(raw_key.strip())

    for key, value in payload.items():
        if key not in allowed:
            continue
        if key in _STR_LIMITS:
            text = str(value or "").strip()
            data[key] = text[: _STR_LIMITS[key]]
        elif key in _BOOL_FIELDS:
            data[key] = bool(value)
        elif key in _OPT_BOOL_FIELDS:
            data[key] = None if value is None else bool(value)
        elif key == "prompt_version":
            # Solo "latest" o semver; cualquier otra cosa = "" (default del
            # proceso). La existencia real de la versión la valida el registro
            # al resolver, degradando a latest si no está.
            raw_version = str(value or "").strip().lower()
            data[key] = raw_version.lstrip("v") if _PROMPT_VERSION_RE.match(raw_version) else ""
        elif key == "sales_style":
            style = str(value or "").strip().lower()
            data[key] = style if style in SALES_STYLES else "cerrador"
        elif key == "human_reply_filter_action":
            action = str(value or "").strip().lower()
            data[key] = action if action in HUMAN_REPLY_FILTER_ACTIONS else "block"
        elif key == "auto_close_after":
            # Formato inválido = "" (sin autocierre), nunca un error duro: el
            # panel ya valida en vivo y un valor raro no debe trabar el guardado.
            data[key] = normalize_duration(str(value or ""))
        elif key == "default_delivery_mode":
            mode = str(value or "").strip().upper()
            data[key] = mode if mode in DELIVERY_MODES else "PICKUP"
        elif key == "max_products_per_message":
            try:
                data[key] = max(1, min(10, int(value)))
            except (TypeError, ValueError):
                pass
        elif key == "temperature":
            try:
                data[key] = None if value in (None, "") else max(0.0, min(1.5, float(value)))
            except (TypeError, ValueError):
                pass
        elif key == "max_tokens":
            try:
                data[key] = None if value in (None, "") else max(64, min(4000, int(value)))
            except (TypeError, ValueError):
                pass
        elif key == "openrouter_api_key_encrypted":
            # Solo llega por esta vía al releer el JSON de disco (`get()`);
            # el panel nunca manda el blob cifrado, manda `openrouter_api_key`
            # en claro (ver arriba).
            data[key] = str(value or "")
        elif key == "handoff_keywords":
            if isinstance(value, str):
                value = [v for v in re.split(r"[,\n]", value)]
            words = [str(v).strip().lower()[:60] for v in (value or []) if str(v).strip()]
            data[key] = words[:30]
    data["updated_at"] = time.time()
    return AgentSettings(**data)


class AgentSettingsStore:
    def __init__(self, directory: Path | None = None) -> None:
        self.directory = directory or Path(_env("AGENT_SETTINGS_DIR") or str(SERVICE_DIR / ".settings"))
        self.directory.mkdir(parents=True, exist_ok=True)
        self._cache: dict[str, AgentSettings] = {}

    def _path(self, tenant_id: str) -> Path:
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", tenant_id)[:64]
        return self.directory / f"{safe}.json"

    def get(self, tenant_id: str) -> AgentSettings:
        cached = self._cache.get(tenant_id)
        if cached is not None:
            return cached
        path = self._path(tenant_id)
        settings = AgentSettings()
        if path.exists():
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                settings = sanitize(raw)
                settings.updated_at = float(raw.get("updated_at") or 0.0)
            except (OSError, ValueError, TypeError):
                settings = AgentSettings()
        self._cache[tenant_id] = settings
        return settings

    def update(self, tenant_id: str, payload: dict[str, Any]) -> AgentSettings:
        settings = sanitize(payload, base=self.get(tenant_id))
        path = self._path(tenant_id)
        tmp = path.with_suffix(".tmp")
        # OJO: hay que persistir `asdict()`, NO `to_dict()`. `to_dict()` es la
        # vista para el panel y BORRA `openrouter_api_key_encrypted` (lo sustituye
        # por el booleano `openrouter_api_key_set`), así que guardar eso dejaba el
        # blob cifrado fuera del JSON: la key sobrevivía solo en `self._cache` y se
        # perdía en el primer reinicio (y el siguiente PUT la "borraba" al releer
        # de disco un base sin key). El cifrado at-rest lo da encrypt_secret().
        tmp.write_text(json.dumps(asdict(settings), ensure_ascii=False, indent=2), encoding="utf-8")
        # El JSON ahora lleva el secreto cifrado: solo el dueño del proceso lo lee.
        os.chmod(tmp, 0o600)
        tmp.replace(path)
        self._cache[tenant_id] = settings
        return settings

    def reset(self, tenant_id: str) -> AgentSettings:
        self._path(tenant_id).unlink(missing_ok=True)
        self._cache.pop(tenant_id, None)
        return self.get(tenant_id)


_STORE: AgentSettingsStore | None = None


def get_settings_store() -> AgentSettingsStore:
    global _STORE
    if _STORE is None:
        _STORE = AgentSettingsStore()
    return _STORE


def get_agent_settings(tenant_id: str) -> AgentSettings:
    return get_settings_store().get(tenant_id)
