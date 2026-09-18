"""Easy Sell (Tupla) — agente v2 (FastAPI + LangGraph + deepagents).

Mantiene el mismo contrato HTTP que el agente v1 (`POST /chat`), así que
commerce-api puede apuntarle con solo cambiar `AGENT_URL`, sin tocar el
puente de WhatsApp.

Este módulo es solo cableado: carga el `.env`, arranca/apaga el `Runtime`
(checkpointer, grafo, pipeline) y monta los routers de `api/`. La lógica de
un turno vive en `pipeline/turn.py`; el estado de proceso en `runtime.py`.
"""

from __future__ import annotations

import contextlib
import logging
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Carga `.env` del monorepo (un nivel arriba de apps/) **antes** de leer
# cualquier setting: `get_settings()` cachea, así que esto tiene que ocurrir
# al importar el módulo, no después. Las vars ya presentes en el entorno
# (p. ej. `OPENROUTER_KEY_REF` inyectadas por el process manager) NO se
# pisan — `override=False` es el default de `load_dotenv`.
_ROOT_ENV = Path(__file__).resolve().parents[1] / ".env"
if _ROOT_ENV.exists():
    load_dotenv(_ROOT_ENV, override=False)

from .api import ROUTERS  # noqa: E402
from .api.deps import require_internal_key  # noqa: E402
from .api.health import VERSION  # noqa: E402
from .guards import install_log_redaction  # noqa: E402
from .knowledge import DEFAULT_TENANT_ID, load_knowledge  # noqa: E402
from .runtime import runtime  # noqa: E402
from .tenant_context import warm_catalog  # noqa: E402

settings = runtime.settings
log = logging.getLogger("agent-v2")

__all__ = ["app", "runtime", "settings"]


async def _warmup() -> None:
    """Best-effort: si algo falla aquí el servicio arranca igual, solo pagará
    el costo en el primer turno."""
    try:
        load_knowledge(DEFAULT_TENANT_ID)
        await warm_catalog()
    except Exception:  # noqa: BLE001
        log.warning("no se pudo precalentar el agente", exc_info=True)


@contextlib.asynccontextmanager
async def _lifespan(_: FastAPI):
    # Si `start()` falla (p. ej. no se puede abrir el sqlite del checkpoint),
    # se deja que la excepción suba: uvicorn debe morir en vez de quedar
    # "arriba" respondiendo 503 a todo para siempre sin que nadie lo note.
    # Los ids de conversación llevan el teléfono del cliente y los mensajes
    # pueden traer correos: ningún log del proceso debe escribirlos en claro.
    install_log_redaction()
    await runtime.start()
    # El primer turno tras arrancar tardaba ~28s (catálogo sin cachear,
    # conocimiento sin leer, cliente del modelo sin inicializar) y el puente
    # de commerce-api aborta a los 30s. Precalentar deja ese turno en el
    # rango normal de 3-5s.
    await _warmup()
    try:
        yield
    finally:
        await runtime.stop()


app = FastAPI(
    title="Easy Sell Agent v2",
    version=VERSION,
    description="Agente comercial sobre LangGraph con memoria persistente por conversación.",
    dependencies=[Depends(require_internal_key)],
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.public_base_url, "http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "X-Internal-Key"],
)

for _router in ROUTERS:
    app.include_router(_router)
