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

    # Canal
    whatsapp_plain_text: bool = True
    auto_reply: bool = True

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


_BOOL_FIELDS = {"ask_name_before_quote", "ask_email_before_quote", "auto_history_lookup",
                "whatsapp_plain_text", "auto_reply"}
_OPT_BOOL_FIELDS = {"emoji"}
_STR_LIMITS = {
    "agent_name": 60, "business_name": 120, "tone": 300, "greeting": 300,
    "language": 10, "currency": 8, "forbidden_topics": 2000, "extra_rules": 4000,
    "text_model": 120, "classifier_model": 120,
}


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
        elif key == "sales_style":
            style = str(value or "").strip().lower()
            data[key] = style if style in SALES_STYLES else "cerrador"
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
        tmp.write_text(json.dumps(settings.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
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
