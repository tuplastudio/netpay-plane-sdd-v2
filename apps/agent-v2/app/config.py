"""Configuración del agente v2. Todo por env, sin secretos en código."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent.parent

# Entornos donde está bien arrancar sin AGENT_INTERNAL_KEY (degradar a
# abierto para no trabar el desarrollo local). Cualquier otro valor de
# APP_ENV se trata como productivo y exige la llave.
_OPEN_ENVIRONMENTS = {"local", "development", "dev", "test", ""}


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name) or default)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name).lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name) or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    # ---- Entorno ----
    environment: str = field(default_factory=lambda: _env("APP_ENV", "local").lower())

    # ---- Modelo (OpenRouter, compatible con la API de OpenAI) ----
    openrouter_key: str = field(
        default_factory=lambda: _env("OPENROUTER_KEY_REF") or _env("OPENROUTER_API_KEY")
    )
    openrouter_base_url: str = field(
        default_factory=lambda: _env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    )
    model: str = field(default_factory=lambda: _env("MODEL_ID", "openai/gpt-4o-mini"))
    summary_model: str = field(default_factory=lambda: _env("SUMMARY_MODEL_ID", ""))
    temperature: float = field(default_factory=lambda: _env_float("AGENT_TEMPERATURE", 0.4))
    max_tokens: int = field(default_factory=lambda: _env_int("AGENT_MAX_TOKENS", 800))

    # ---- API comercial ----
    commerce_api_url: str = field(
        default_factory=lambda: _env("COMMERCE_API_URL", "http://localhost:4000/api/v1")
    )
    commerce_api_key: str = field(default_factory=lambda: _env("AGENT_API_KEY_REF"))
    commerce_timeout: float = field(default_factory=lambda: _env_float("COMMERCE_TIMEOUT", 15.0))

    # ---- Autenticación de servicio a servicio ----
    internal_key: str = field(
        default_factory=lambda: _env("AGENT_INTERNAL_KEY_REF") or _env("AGENT_INTERNAL_KEY")
    )

    # ---- Cifrado de secretos por tenant (ej. su propia OpenRouter API key) ----
    # No es un KMS de producción: una sola clave simétrica de servidor,
    # suficiente para esta etapa. Ver agent_settings.py `_encrypt`/`_decrypt`.
    secret_key: str = field(default_factory=lambda: _env("AGENT_SECRET_KEY"))

    # ---- Persistencia: el "hilo" de cada conversación y la memoria larga ----
    data_dir: Path = field(
        default_factory=lambda: Path(_env("AGENT_V2_DATA_DIR") or str(SERVICE_DIR / ".data"))
    )

    # ---- Presupuestos por turno ----
    recursion_limit: int = field(default_factory=lambda: _env_int("AGENT_RECURSION_LIMIT", 40))
    turn_timeout_seconds: float = field(
        default_factory=lambda: _env_float("AGENT_TURN_TIMEOUT_SECONDS", 90.0)
    )
    max_input_chars: int = field(default_factory=lambda: _env_int("AGENT_MAX_INPUT_CHARS", 8000))
    # v1 topaba el audio con AGENT_MAX_AUDIO_BYTES; v2 no tenía tope para
    # imageBase64 (ver security.image_size_error, falta cablearlo en main.py).
    max_image_bytes: int = field(
        default_factory=lambda: _env_int("AGENT_MAX_IMAGE_BYTES", 5 * 1024 * 1024)
    )

    # ---- Guardarraíl de tema ----
    # Un clasificador barato decide si el mensaje va del negocio antes de
    # gastar el bucle de herramientas. Apagable por si estorba en algún canal.
    scope_guard_enabled: bool = field(
        default_factory=lambda: _env_bool("AGENT_SCOPE_GUARD", True)
    )
    scope_guard_model: str = field(default_factory=lambda: _env("SCOPE_GUARD_MODEL_ID", ""))

    # ---- Audio: notas de voz de WhatsApp y micrófono del chat web ----
    stt_model: str = field(default_factory=lambda: _env("STT_MODEL_ID", "openai/whisper-1"))
    # OpenRouter NO expone /audio/speech: `openai/tts-1` responde "Model does
    # not exist" (comprobado). El endpoint /audio/tts queda por paridad con v1
    # y degrada a 503; para usarlo hay que apuntar OPENROUTER_BASE_URL a un
    # proveedor que sí lo soporte (la API de OpenAI directa, por ejemplo).
    tts_model: str = field(default_factory=lambda: _env("TTS_MODEL_ID", "openai/tts-1"))
    tts_voice: str = field(default_factory=lambda: _env("TTS_VOICE", "alloy"))
    max_audio_bytes: int = field(
        default_factory=lambda: _env_int("AGENT_MAX_AUDIO_BYTES", 8 * 1024 * 1024)
    )
    max_tts_chars: int = field(default_factory=lambda: _env_int("AGENT_MAX_TTS_CHARS", 700))
    # Transcribir una nota de voz tarda más que un turno de chat: timeout aparte.
    audio_timeout_seconds: float = field(
        default_factory=lambda: _env_float("AGENT_AUDIO_TIMEOUT_SECONDS", 60.0)
    )
    # Tope genérico para argumentos de texto libre de las tools (consulta,
    # notas, motivo/resumen de escalamiento): sin esto, un mensaje puede
    # inflar indefinidamente el estado persistido y lo que se reinyecta en
    # cada turno al prompt.
    max_tool_arg_chars: int = field(
        default_factory=lambda: _env_int("AGENT_MAX_TOOL_ARG_CHARS", 2000)
    )
    max_cart_lines: int = field(default_factory=lambda: _env_int("AGENT_MAX_CART_LINES", 40))
    max_quantity: int = field(default_factory=lambda: _env_int("AGENT_MAX_QUANTITY", 100_000))
    # Resumen: se dispara por número de mensajes y conserva los últimos N.
    summarize_after_messages: int = field(
        default_factory=lambda: _env_int("AGENT_SUMMARIZE_AFTER", 30)
    )
    keep_messages: int = field(default_factory=lambda: _env_int("AGENT_KEEP_MESSAGES", 12))

    # ---- Enlaces públicos ----
    public_base_url: str = field(
        default_factory=lambda: _env("PUBLIC_BASE_URL", "http://localhost:3000")
    )

    knowledge_dir: Path = field(
        default_factory=lambda: Path(_env("KNOWLEDGE_DIR") or str(SERVICE_DIR / "knowledge"))
    )

    @property
    def llm_live(self) -> bool:
        return bool(self.openrouter_key)

    @property
    def commerce_live(self) -> bool:
        # Multi-tenant usa aserciones HMAC por petición; la API key global se
        # conserva solo para despliegues legacy de una empresa.
        return bool(self.internal_key or self.commerce_api_key)

    @property
    def checkpoint_path(self) -> Path:
        return self.data_dir / "threads.sqlite"

    @property
    def store_path(self) -> Path:
        return self.data_dir / "memory.sqlite"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    # Fuera de local/desarrollo, degradar a "sin autenticación de servicio"
    # (comportamiento heredado de v1) deja el puerto abierto a cualquiera
    # que lo alcance: quien pueda pegarle a /chat puede ejecutar tools con
    # dinero real. En local se mantiene abierto para no trabar el arranque.
    if settings.environment not in _OPEN_ENVIRONMENTS and not settings.internal_key:
        raise RuntimeError(
            f"AGENT_INTERNAL_KEY_REF es obligatoria con APP_ENV={settings.environment!r}: "
            "sin ella el servicio queda abierto a cualquiera que alcance el puerto."
        )
    return settings
