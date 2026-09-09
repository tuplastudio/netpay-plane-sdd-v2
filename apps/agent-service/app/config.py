"""Configuración del agente. Todo por env; sin secretos hardcodeados.

Ver docs/11-aia.md (SPEC-AIA) y ADR-013/ADR-014.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_int(name: str, default: int) -> int:
    raw = _env(name)
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = _env(name)
    try:
        return float(raw) if raw else default
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name).lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


APP_DIR = Path(__file__).resolve().parent
SERVICE_DIR = APP_DIR.parent


@dataclass(frozen=True)
class Settings:
    """Configuración inmutable del servicio."""

    # ---- Modelos (OpenRouter, proveedor único por ADR-014) ----
    openrouter_key: str = field(
        default_factory=lambda: _env("OPENROUTER_KEY_REF") or _env("OPENROUTER_API_KEY")
    )
    openrouter_base_url: str = field(
        default_factory=lambda: _env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    )
    text_model: str = field(default_factory=lambda: _env("MODEL_ID", "openai/gpt-4o-mini"))
    fallback_model: str = field(default_factory=lambda: _env("MODEL_ID_FALLBACK", ""))
    # Clasificador de intención: modelo pequeño y barato; vacío = usa text_model.
    classifier_model: str = field(default_factory=lambda: _env("CLASSIFIER_MODEL_ID", ""))
    stt_model: str = field(default_factory=lambda: _env("STT_MODEL_ID", "openai/whisper-1"))
    tts_model: str = field(default_factory=lambda: _env("TTS_MODEL_ID", "openai/tts-1"))
    tts_voice: str = field(default_factory=lambda: _env("TTS_VOICE", "alloy"))
    temperature: float = field(default_factory=lambda: _env_float("AGENT_TEMPERATURE", 0.55))
    max_tokens: int = field(default_factory=lambda: _env_int("AGENT_MAX_TOKENS", 700))

    # ---- API comercial (tool gateway backend) ----
    commerce_api_url: str = field(
        default_factory=lambda: _env("COMMERCE_API_URL", "http://localhost:4000/api/v1")
    )
    commerce_api_key: str = field(default_factory=lambda: _env("AGENT_API_KEY_REF"))
    commerce_timeout: float = field(default_factory=lambda: _env_float("COMMERCE_TIMEOUT", 10.0))

    # ---- Autenticación de servicio a servicio ----
    # Sin esta clave, el servicio queda abierto a cualquiera que alcance el
    # puerto (mismo riesgo que sin AGENT_API_KEY_REF): configurarla es
    # obligatorio fuera de un laptop de desarrollo.
    internal_key: str = field(
        default_factory=lambda: _env("AGENT_INTERNAL_KEY_REF") or _env("AGENT_INTERNAL_KEY")
    )

    # ---- Conocimiento del negocio ----
    knowledge_dir: Path = field(
        default_factory=lambda: Path(_env("KNOWLEDGE_DIR") or str(SERVICE_DIR / "knowledge"))
    )
    knowledge_top_k: int = field(default_factory=lambda: _env_int("KNOWLEDGE_TOP_K", 4))

    # ---- Checkpoints del grafo ----
    checkpoint_dir: Path = field(
        default_factory=lambda: Path(
            _env("AGENT_CHECKPOINT_DIR") or str(SERVICE_DIR / ".checkpoints")
        )
    )
    checkpoint_enabled: bool = field(
        default_factory=lambda: _env_bool("AGENT_CHECKPOINT_ENABLED", True)
    )

    # ---- Presupuestos por turno (SPEC-AIA "Salida de intención y límites") ----
    max_tool_steps: int = field(default_factory=lambda: _env_int("AGENT_MAX_TOOL_STEPS", 8))
    max_tool_retries: int = field(default_factory=lambda: _env_int("AGENT_MAX_TOOL_RETRIES", 2))
    turn_budget_seconds: float = field(
        default_factory=lambda: _env_float("AGENT_TURN_BUDGET_SECONDS", 30.0)
    )
    max_input_chars: int = field(default_factory=lambda: _env_int("AGENT_MAX_INPUT_CHARS", 8000))
    history_window: int = field(default_factory=lambda: _env_int("AGENT_HISTORY_WINDOW", 12))
    summarize_after: int = field(default_factory=lambda: _env_int("AGENT_SUMMARIZE_AFTER", 20))
    max_cost_usd_per_conversation: float = field(
        default_factory=lambda: _env_float("AGENT_MAX_COST_USD", 1.0)
    )

    # ---- Audio ----
    max_audio_bytes: int = field(
        default_factory=lambda: _env_int("AGENT_MAX_AUDIO_BYTES", 8 * 1024 * 1024)
    )
    max_tts_chars: int = field(default_factory=lambda: _env_int("AGENT_MAX_TTS_CHARS", 700))

    # ---- Conocimiento: subida y aprendizaje ----
    max_knowledge_upload_bytes: int = field(
        default_factory=lambda: _env_int("AGENT_MAX_KNOWLEDGE_UPLOAD_BYTES", 2 * 1024 * 1024)
    )
    learning_dir: Path = field(
        default_factory=lambda: Path(
            _env("AGENT_LEARNING_DIR") or str(SERVICE_DIR / "learning")
        )
    )
    max_learning_signals: int = field(
        default_factory=lambda: _env_int("AGENT_MAX_LEARNING_SIGNALS", 2000)
    )

    # ---- Enlaces públicos ----
    public_base_url: str = field(
        default_factory=lambda: _env("PUBLIC_BASE_URL", "http://localhost:3000")
    )

    @property
    def llm_live(self) -> bool:
        return bool(self.openrouter_key)

    @property
    def commerce_live(self) -> bool:
        return bool(self.commerce_api_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    """Solo para tests: recarga env."""
    get_settings.cache_clear()
