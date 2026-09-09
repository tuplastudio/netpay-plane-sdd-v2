"""Registro de modelos (T-AIA-02).

Guarda ID exacto, capacidades, límites, versión de prompt y fecha de
evaluación. Cambiar de modelo exige evidencia comparativa (T-AIA-07), así que
el registro es la fuente de verdad de qué se puede usar y para qué.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

REGISTRY_PATH = Path(__file__).resolve().parent / "model_registry.json"

PROMPT_VERSION = "2026-09-persona-v2"


@dataclass(frozen=True)
class ModelEntry:
    id: str
    role: str  # text | stt | tts
    tool_calling: bool = False
    json_schema: bool = False
    languages: tuple[str, ...] = ("es",)
    max_context: int = 128_000
    usd_per_1k_input: float = 0.0
    usd_per_1k_output: float = 0.0
    evaluated_at: str = ""
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "languages": list(self.languages)}


def _load() -> dict[str, ModelEntry]:
    if not REGISTRY_PATH.exists():
        return {}
    raw = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    entries: dict[str, ModelEntry] = {}
    for item in raw.get("models", []):
        item = dict(item)
        item["languages"] = tuple(item.get("languages", ("es",)))
        entries[item["id"]] = ModelEntry(**item)
    return entries


REGISTRY: dict[str, ModelEntry] = _load()


def get(model_id: str) -> ModelEntry | None:
    return REGISTRY.get(model_id)


def supports_tools(model_id: str) -> bool:
    entry = REGISTRY.get(model_id)
    # Desconocido ⇒ se asume sin tool calling y el agente usa el motor determinista.
    return bool(entry and entry.tool_calling)


def estimate_cost_usd(model_id: str, prompt_tokens: int, completion_tokens: int) -> float:
    entry = REGISTRY.get(model_id)
    if entry is None:
        return 0.0
    return (
        prompt_tokens / 1000 * entry.usd_per_1k_input
        + completion_tokens / 1000 * entry.usd_per_1k_output
    )


def describe() -> dict[str, Any]:
    return {
        "promptVersion": PROMPT_VERSION,
        "models": [entry.to_dict() for entry in REGISTRY.values()],
    }
