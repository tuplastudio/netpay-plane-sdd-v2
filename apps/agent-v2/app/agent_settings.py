"""Configuración del agente por tenant, editable desde el panel.

Puerto de `apps/agent-service/app/agent_settings.py` (v1) a v2: mismo esquema
JSON por tenant, así el panel del frontend (`agent-settings-form.tsx`) puede
apuntar a este servicio sin cambios. Los valores vacíos/None caen al perfil de
`negocio.md` (ver `knowledge.py`) y a las variables de entorno de `config.py`,
así que sin configurar nada el agente sigue igual que hoy.

`classifier_model` se conserva solo por compatibilidad de esquema con el
panel: v2 no tiene paso de clasificación de intención separado (a diferencia
de v1), así que ese campo no se lee en ningún lado todavía.

`ask_name_before_quote` también es solo de esquema: en v2 el nombre del
cliente es obligatorio para cotizar por política de datos (T-CRM-01, ver
`tools.emitir_cotizacion`), así que apagarlo no cambia nada. En cambio
`auto_history_lookup=False` sí entra al prompt (ver
`prompts.assembler.overrides_block`): el agente deja de consultar el
historial por iniciativa propia y solo lo hace cuando el cliente pregunta
por compras anteriores.
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

from .config import INSECURE_DEFAULT_SECRET_KEY, SERVICE_DIR, _env

SALES_STYLES: tuple[str, ...] = ("cerrador", "consultivo", "informativo")
DELIVERY_MODES: tuple[str, ...] = ("PICKUP", "LOCAL_DELIVERY")

# ---- Modo de cobro ----
# Qué hace el bot cuando el cliente confirma un pedido:
#   quote_only    → emite la cotización (enlace + PDF) y NUNCA genera ni
#                   comparte un enlace de pago; el cobro se arregla fuera del
#                   chat (una persona da seguimiento). El enlace público de la
#                   cotización tampoco muestra el botón de pagar.
#   quote_and_pay → cotización + enlace de pago en el mismo mensaje (default,
#                   es el flujo que ya funcionaba).
#   pay_first     → sin cotización previa: tras el "sí" va directo al enlace
#                   de pago (el viejo `bot_pay_first=True`).
CHECKOUT_MODES: tuple[str, ...] = ("quote_only", "quote_and_pay", "pay_first")
DEFAULT_CHECKOUT_MODE = "quote_and_pay"
# Lo que dice el bot en `quote_only` en lugar del enlace de pago, si el
# negocio no configuró su propio texto (`quote_only_closing_message`).
DEFAULT_QUOTE_ONLY_CLOSING = (
    "Una persona del equipo te contacta para confirmar el pedido y acordar el pago."
)

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

    El respaldo inseguro solo llega a usarse en local: `config.get_settings`
    niega el arranque desplegado sin una key propia (`_check_secret_key`).
    """
    raw = _env("AGENT_SECRET_KEY") or INSECURE_DEFAULT_SECRET_KEY
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
    # Modo de cobro (ver CHECKOUT_MODES). Es la fuente de verdad; `bot_pay_first`
    # se conserva solo por compatibilidad con paneles/JSON viejos y se DERIVA
    # de aquí (`pay_first` ⇔ `bot_pay_first=True`).
    checkout_mode: str = DEFAULT_CHECKOUT_MODE
    # Texto con el que el bot cierra en `quote_only` en vez del enlace de pago
    # (≤300). Vacío = DEFAULT_QUOTE_ONLY_CLOSING.
    quote_only_closing_message: str = ""
    # Campo heredado. Si True, después de confirmar un pedido el bot va
    # directo al link de pago sin pasar por `emitir_cotizacion` (útil en
    # comida para llevar, recargas). No lo leas directo: usa `pay_first()` /
    # `checkout_mode`; `sanitize` mantiene los dos campos consistentes.
    bot_pay_first: bool = False
    # Si True, antes de cotizar con envío a domicilio el bot pregunta CP /
    # ciudad / estado del cliente y llama `validar_zona_de_envio`. Si False,
    # se cae al `shippingFlat` genérico sin preguntar (modo "rápido").
    collect_customer_address: bool = True
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

    def __post_init__(self) -> None:
        # `checkout_mode` y el heredado `bot_pay_first` nunca se contradicen,
        # también cuando el dataclass se construye a mano (tests, código viejo
        # que solo conoce `bot_pay_first=True`).
        if self.checkout_mode not in CHECKOUT_MODES:
            self.checkout_mode = DEFAULT_CHECKOUT_MODE
        if self.bot_pay_first and self.checkout_mode == DEFAULT_CHECKOUT_MODE:
            self.checkout_mode = "pay_first"
        self.bot_pay_first = self.checkout_mode == "pay_first"

    def to_dict(self) -> dict[str, Any]:
        """Para el panel: nunca expone el cifrado, solo si hay una key guardada."""
        data = asdict(self)
        data["openrouter_api_key_set"] = bool(self.openrouter_api_key_encrypted)
        data.pop("openrouter_api_key_encrypted", None)
        return data

    def effective_model(self, default: str) -> str:
        return self.text_model.strip() or default

    # ---- modo de cobro ----

    def pay_first(self) -> bool:
        """Flujo corto: tras el "sí" va directo al enlace de pago, sin cotización."""
        return self.checkout_mode == "pay_first"

    def payment_links_enabled(self) -> bool:
        """False solo en `quote_only`: ni el bot ni el enlace público cobran."""
        return self.checkout_mode != "quote_only"

    def quote_only_closing(self) -> str:
        """Texto de cierre en `quote_only` (el del negocio o el de fábrica)."""
        return self.quote_only_closing_message.strip() or DEFAULT_QUOTE_ONLY_CLOSING

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
                "auto_close_enabled", "bot_pay_first", "collect_customer_address"}
_OPT_BOOL_FIELDS = {"emoji"}
_STR_LIMITS = {
    "agent_name": 60, "business_name": 120, "tone": 300, "greeting": 300,
    "language": 10, "currency": 8, "forbidden_topics": 2000, "extra_rules": 4000,
    "text_model": 120, "classifier_model": 120, "human_reply_filter_model": 120,
    "quote_only_closing_message": 300,
}


def resolve_checkout_mode(payload: dict[str, Any], current_mode: str) -> str:
    """Modo de cobro que resulta de un payload, con el mapeo del campo heredado.

    - `checkout_mode` válido en el payload gana siempre.
    - Sin él, `bot_pay_first` (panel viejo / JSON viejo en disco) se traduce:
      True → `pay_first`; False → sale de `pay_first` hacia el default, pero
      NO pisa un `quote_only` ya guardado (el panel viejo no conoce ese modo
      y mandaría False sin querer cambiar nada).
    - Sin ninguno de los dos, se conserva el actual.
    """
    if "checkout_mode" in payload:
        mode = str(payload.get("checkout_mode") or "").strip().lower()
        if mode in CHECKOUT_MODES:
            return mode
    if "bot_pay_first" in payload:
        if bool(payload.get("bot_pay_first")):
            return "pay_first"
        if current_mode == "pay_first":
            return DEFAULT_CHECKOUT_MODE
    return current_mode if current_mode in CHECKOUT_MODES else DEFAULT_CHECKOUT_MODE
_PROMPT_VERSION_RE = re.compile(r"^(latest|v?\d+\.\d+\.\d+)$")
_MODEL_FIELDS = {"text_model", "classifier_model", "human_reply_filter_model"}
_MODEL_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._:-]*$")


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

    # Modo de cobro y su campo heredado se resuelven juntos (ver
    # resolve_checkout_mode) para que nunca queden en desacuerdo.
    data["checkout_mode"] = resolve_checkout_mode(payload, str(data.get("checkout_mode") or ""))
    data["bot_pay_first"] = data["checkout_mode"] == "pay_first"

    for key, value in payload.items():
        if key not in allowed or key in ("checkout_mode", "bot_pay_first"):
            continue
        if key in _MODEL_FIELDS:
            # Solo un slug `proveedor/modelo` de OpenRouter (o vacío = el
            # del proceso). Texto libre aquí antes viajaba tal cual al
            # proveedor; el filtro de costo (AGENT_ALLOWED_MODELS) lo aplica
            # `agent._tenant_model_middleware` en cada llamada.
            text = str(value or "").strip()[: _STR_LIMITS[key]]
            data[key] = text if _MODEL_SLUG_RE.match(text) else ""
        elif key in _STR_LIMITS:
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
