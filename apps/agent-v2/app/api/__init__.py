"""Capa HTTP (FastAPI) del agente v2, un router por área.

`main.py` los monta todos bajo la misma dependencia de autenticación
(`X-Internal-Key`). Ningún router contiene lógica de negocio: validan la
request, llaman al pipeline/los módulos de dominio y traducen sus errores a
HTTP. Así `main.py` queda como cableado y `POST /chat` se lee completo en
`pipeline/turn.py`.
"""

from fastapi import APIRouter

from . import audio, chat, conversations, health, knowledge, learning, memory, prompts, settings

ROUTERS: tuple[APIRouter, ...] = (
    health.router,
    chat.router,
    conversations.router,
    prompts.router,
    settings.router,
    knowledge.router,
    learning.router,
    memory.router,
    audio.router,
)

__all__ = ["ROUTERS"]
