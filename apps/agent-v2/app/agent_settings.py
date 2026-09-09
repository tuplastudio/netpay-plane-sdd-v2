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

import json
import re
import time
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any

from .config import SERVICE_DIR, _env

SALES_STYLES: tuple[str, ...] = ("cerrador", "consultivo", "informativo")
DELIVERY_MODES: tuple[str, ...] = ("PICKUP", "LOCAL_DELIVERY")


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

    # Canal
    whatsapp_plain_text: bool = True
    auto_reply: bool = True

    updated_at: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def effective_model(self, default: str) -> str:
        return self.text_model.strip() or default


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
    data = current.to_dict()
    allowed = {f.name for f in fields(AgentSettings)} - {"updated_at"}
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
