"""Audio del agente v2: transcripción (STT) y voz (TTS).

Lo consume commerce-api para las notas de voz de WhatsApp
(`whatsapp.controller.ts` llama `/audio/stt` con el binario que descarga de
Evolution) y el micrófono del chat web.

OpenRouter expone los endpoints de audio con el mismo protocolo de OpenAI, así
que basta con httpx: no hace falta el SDK.
"""

from __future__ import annotations

import base64

import httpx

from .config import Settings, get_settings


class AudioUnavailable(RuntimeError):
    """El proveedor no respondió o falta configuración."""


class AudioTooLarge(ValueError):
    """El audio excede el tope configurado."""


async def transcribe(
    audio: bytes, *, filename: str = "nota.ogg", settings: Settings | None = None
) -> dict[str, str]:
    """Audio -> texto en español.

    El idioma va fijo a "es": el negocio atiende en español de México y dejarlo
    en autodetección hacía que notas cortas o con ruido se transcribieran como
    si fueran otro idioma.
    """
    settings = settings or get_settings()
    if not settings.llm_live:
        raise AudioUnavailable("OPENROUTER_KEY_REF no configurada")
    if len(audio) > settings.max_audio_bytes:
        raise AudioTooLarge(
            f"El audio pesa {len(audio)} bytes y el tope es {settings.max_audio_bytes}"
        )
    try:
        async with httpx.AsyncClient(timeout=settings.audio_timeout_seconds) as client:
            response = await client.post(
                f"{settings.openrouter_base_url}/audio/transcriptions",
                headers={"authorization": f"Bearer {settings.openrouter_key}"},
                files={"file": (filename, audio, "application/octet-stream")},
                data={"model": settings.stt_model, "language": "es"},
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        # El detalle del proveedor puede traer la URL y la clave en el mensaje.
        raise AudioUnavailable("el servicio de transcripción no respondió") from exc
    return {
        "text": payload.get("text", ""),
        "language": payload.get("language", "es"),
        "model": settings.stt_model,
    }


async def synthesize(
    text: str, *, voice: str | None = None, settings: Settings | None = None
) -> dict[str, object]:
    """Texto -> mp3 en base64."""
    settings = settings or get_settings()
    if not settings.llm_live:
        raise AudioUnavailable("OPENROUTER_KEY_REF no configurada")
    clipped = text[: settings.max_tts_chars]
    chosen = voice or settings.tts_voice
    try:
        async with httpx.AsyncClient(timeout=settings.audio_timeout_seconds) as client:
            response = await client.post(
                f"{settings.openrouter_base_url}/audio/speech",
                headers={"authorization": f"Bearer {settings.openrouter_key}"},
                json={
                    "model": settings.tts_model,
                    "voice": chosen,
                    "input": clipped,
                    "response_format": "mp3",
                },
            )
            response.raise_for_status()
            audio = response.content
    except httpx.HTTPError as exc:
        raise AudioUnavailable("el servicio de voz no respondió") from exc
    return {
        "audioBase64": base64.b64encode(audio).decode(),
        "voice": chosen,
        "model": settings.tts_model,
        # El canal debe poder avisar que el mensaje se cortó, en vez de mandar
        # media frase sin explicación.
        "truncated": len(text) > len(clipped),
    }
