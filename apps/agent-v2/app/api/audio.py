"""Notas de voz (STT) y voz sintética (TTS)."""

from __future__ import annotations

import base64
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..audio import AudioTooLarge, AudioUnavailable, synthesize, transcribe

router = APIRouter(tags=["audio"])


class SttRequest(BaseModel):
    audioBase64: str
    filename: str = "nota.ogg"


class TtsRequest(BaseModel):
    text: str
    voice: str | None = None


@router.post("/audio/stt")
async def audio_stt(req: SttRequest) -> dict[str, Any]:
    """Nota de voz -> texto. Lo llama commerce-api con el binario que baja de
    Evolution y el micrófono del chat web."""
    try:
        audio = base64.b64decode(req.audioBase64)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="audioBase64 inválido") from exc
    try:
        return await transcribe(audio, filename=req.filename)
    except AudioTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except AudioUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/audio/tts")
async def audio_tts(req: TtsRequest) -> dict[str, Any]:
    try:
        return await synthesize(req.text, voice=req.voice)
    except AudioUnavailable as exc:
        # Degradación explícita: el canal manda el texto y ya.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
