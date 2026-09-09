"""ModelGateway: adaptador único a OpenRouter (ADR-014).

Chat con tool calling, STT y TTS en endpoints separados. Sin
`OPENROUTER_KEY_REF` el gateway no es "live" y el agente usa su motor
determinista, sin fingir que hubo una llamada real al proveedor.
"""

from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from ..config import Settings, get_settings
from . import model_registry


class ModelUnavailable(RuntimeError):
    """El proveedor no respondió o la configuración es inválida."""


@dataclass
class ChatResult:
    content: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    model: str = ""
    finish_reason: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    repaired: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "content": self.content,
            "toolCalls": self.tool_calls,
            "model": self.model,
            "finishReason": self.finish_reason,
            "promptTokens": self.prompt_tokens,
            "completionTokens": self.completion_tokens,
            "costUsd": round(self.cost_usd, 6),
            "latencyMs": self.latency_ms,
            "repaired": self.repaired,
        }


class ModelGateway:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.calls: int = 0
        self.total_cost_usd: float = 0.0

    # ---------- capacidades ----------

    def is_live(self) -> bool:
        return self.settings.llm_live

    def supports_tools(self) -> bool:
        return self.is_live() and model_registry.supports_tools(self.settings.text_model)

    def diagnostics(self) -> dict[str, Any]:
        entry = model_registry.get(self.settings.text_model)
        return {
            "live": self.is_live(),
            "model": self.settings.text_model,
            "registered": entry is not None,
            "toolCalling": self.supports_tools(),
            "fallbackModel": self.settings.fallback_model or None,
            "promptVersion": model_registry.PROMPT_VERSION,
            "calls": self.calls,
            "totalCostUsd": round(self.total_cost_usd, 6),
        }

    # ---------- chat ----------

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        allow_fallback: bool = True,
    ) -> ChatResult:
        if not self.is_live():
            raise ModelUnavailable("OPENROUTER_KEY_REF no configurada")

        model_id = model or self.settings.text_model
        body: dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "temperature": self.settings.temperature if temperature is None else temperature,
            "max_tokens": max_tokens or self.settings.max_tokens,
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"

        started = time.perf_counter()
        try:
            data = await self._post_json("/chat/completions", body)
        except ModelUnavailable:
            if allow_fallback and self.settings.fallback_model:
                return await self.chat(
                    messages,
                    tools=tools,
                    model=self.settings.fallback_model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    allow_fallback=False,
                )
            raise

        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message", {})
        usage = data.get("usage", {})
        prompt_tokens = int(usage.get("prompt_tokens", 0))
        completion_tokens = int(usage.get("completion_tokens", 0))
        cost = model_registry.estimate_cost_usd(model_id, prompt_tokens, completion_tokens)

        self.calls += 1
        self.total_cost_usd += cost

        return ChatResult(
            content=(message.get("content") or "").strip(),
            tool_calls=self._parse_tool_calls(message.get("tool_calls") or []),
            model=data.get("model", model_id),
            finish_reason=choice.get("finish_reason", ""),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=cost,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )

    @staticmethod
    def _parse_tool_calls(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Normaliza tool calls; los argumentos malformados se marcan, no explotan."""
        parsed: list[dict[str, Any]] = []
        for call in raw:
            function = call.get("function", {})
            arguments = function.get("arguments") or "{}"
            try:
                args = json.loads(arguments) if isinstance(arguments, str) else dict(arguments)
                malformed = False
            except (ValueError, TypeError):
                args, malformed = {}, True
            parsed.append(
                {
                    "id": call.get("id") or f"call_{len(parsed)}",
                    "name": function.get("name", ""),
                    "arguments": args,
                    "malformed": malformed,
                }
            )
        return parsed

    # ---------- audio ----------

    async def stt(self, audio: bytes, *, filename: str = "audio.m4a") -> dict[str, Any]:
        if not self.is_live():
            raise ModelUnavailable("OPENROUTER_KEY_REF no configurada")
        if len(audio) > self.settings.max_audio_bytes:
            raise ValueError(
                f"Audio de {len(audio)} bytes supera el límite de {self.settings.max_audio_bytes}"
            )
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(
                    f"{self.settings.openrouter_base_url}/audio/transcriptions",
                    headers={"authorization": f"Bearer {self.settings.openrouter_key}"},
                    files={"file": (filename, audio, "application/octet-stream")},
                    data={"model": self.settings.stt_model, "language": "es"},
                )
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPError as exc:
            raise ModelUnavailable(f"STT no disponible: {exc}") from exc
        return {
            "text": payload.get("text", ""),
            "language": payload.get("language", "es"),
            "model": self.settings.stt_model,
        }

    async def tts(self, text: str, *, voice: str | None = None) -> dict[str, Any]:
        if not self.is_live():
            raise ModelUnavailable("OPENROUTER_KEY_REF no configurada")
        clipped = text[: self.settings.max_tts_chars]
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(
                    f"{self.settings.openrouter_base_url}/audio/speech",
                    headers={"authorization": f"Bearer {self.settings.openrouter_key}"},
                    json={
                        "model": self.settings.tts_model,
                        "voice": voice or self.settings.tts_voice,
                        "input": clipped,
                        "response_format": "mp3",
                    },
                )
                response.raise_for_status()
                audio = response.content
        except httpx.HTTPError as exc:
            raise ModelUnavailable(f"TTS no disponible: {exc}") from exc
        return {
            "audioBase64": base64.b64encode(audio).decode(),
            "voice": voice or self.settings.tts_voice,
            "model": self.settings.tts_model,
            "truncated": len(text) > len(clipped),
        }

    # ---------- transporte ----------

    async def _post_json(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "authorization": f"Bearer {self.settings.openrouter_key}",
            "content-type": "application/json",
            "http-referer": self.settings.public_base_url,
            "x-title": "NetPay Plane Agent",
        }
        try:
            async with httpx.AsyncClient(timeout=self.settings.turn_budget_seconds) as client:
                response = await client.post(
                    f"{self.settings.openrouter_base_url}{path}", json=body, headers=headers
                )
                response.raise_for_status()
                return response.json()
        except httpx.HTTPError as exc:
            raise ModelUnavailable(f"OpenRouter no disponible: {exc}") from exc


_GATEWAY: ModelGateway | None = None


def get_gateway() -> ModelGateway:
    global _GATEWAY
    if _GATEWAY is None:
        _GATEWAY = ModelGateway()
    return _GATEWAY
