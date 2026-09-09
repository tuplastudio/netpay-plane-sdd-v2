"""Juicio por LLM, opcional (`--judge`).

Las aserciones de `runner.py` son todas baratas: comparan estado estructurado
y patrones de texto, sin gastar una llamada extra. Esto complementa esas
aserciones con algo que un regex no puede ver bien — si la conversación
"se siente" continua y no repetitiva —, a costa de una llamada adicional por
conversación marcada con `judge=True` en el dataset (no por turno).

Nunca es el modo por defecto: `run_suite(judge=True)` es opt-in, y solo se
aplica a los casos que el dataset marcó explícitamente como candidatos a
juicio (las conversaciones multi-turno, que es donde un regex es más débil).
"""

from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.messages import HumanMessage

from ..agent import build_model
from ..config import Settings

_RUBRIC = """\
Eres un evaluador de calidad de conversaciones de venta por WhatsApp en español de México.
Te doy la transcripción completa de una conversación entre un cliente y un vendedor (agente de IA).
Califica de 1 (mal) a 5 (excelente) estos aspectos, SOLO sobre el AGENTE:

- continuidad: ¿usa lo que el cliente ya dijo en turnos anteriores, sin pedirlo de nuevo?
- naturalidad: ¿sueña a persona real del equipo, no a bot leyendo un guion?
- orientado_a_cerrar: ¿cada respuesta acerca la venta un paso, sin quedarse solo informando?
- sin_redundancia: ¿evita repetir preguntas o datos que ya se habían resuelto?

Responde SOLO con un JSON de una línea, sin texto alrededor, con esta forma exacta:
{"continuidad": N, "naturalidad": N, "orientado_a_cerrar": N, "sin_redundancia": N, "comentario": "una frase corta"}
"""

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _format_transcript(transcript: list[dict[str, str]]) -> str:
    return "\n".join(f"{turn['role']}: {turn['text']}" for turn in transcript)


async def judge_conversation(transcript: list[dict[str, str]], settings: Settings) -> dict[str, Any]:
    if not transcript:
        return {"error": "transcripción vacía"}

    model = build_model(settings)
    prompt = f"{_RUBRIC}\n\nTRANSCRIPCIÓN:\n{_format_transcript(transcript)}"
    try:
        response = await model.ainvoke([HumanMessage(content=prompt)])
    except Exception as exc:  # noqa: BLE001 - el juicio es opcional, no debe tumbar la corrida
        return {"error": f"el juez falló: {exc}"}

    text = response.content if isinstance(response.content, str) else str(response.content)
    match = _JSON_RE.search(text)
    if not match:
        return {"error": "el juez no devolvió JSON", "raw": text[:500]}
    try:
        scores = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {"error": "el JSON del juez no parseó", "raw": text[:500]}

    usage = getattr(response, "usage_metadata", None) or {}
    scores["_usage"] = {
        "input_tokens": usage.get("input_tokens", 0),
        "output_tokens": usage.get("output_tokens", 0),
    }
    return scores
