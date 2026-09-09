"""Configuración del agente v2. Todo por env, sin secretos en código."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent.parent


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name) or default)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name) or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
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
        return bool(self.commerce_api_key)

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
    return settings
