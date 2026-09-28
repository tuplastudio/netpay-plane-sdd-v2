"""Feature flags e hiperparámetros dinámicos en tiempo real (Flagsmith).

`config.py` resuelve una sola vez al arrancar el proceso (env vars,
cacheado con `@lru_cache`) y `agent_settings.py` resuelve por tenant desde
el panel (JSON en disco, editable en caliente). Este módulo agrega una
TERCERA capa, por encima de la primera: un valor que operación puede
cambiar para TODOS los tenants sin redeploy y sin tocar el panel de cada
negocio — apagar un guard que está dando falsos positivos, o ajustar la
temperatura por defecto, mientras se investiga algo, sin esperar al
siguiente deploy. Un tenant que fijó su propio valor en el panel sigue
ganando (ver `agent.py`): esta capa solo llena el hueco entre "nadie tocó
nada" (env) y "el negocio sí lo configuró" (panel).

Usa Flagsmith (https://flagsmith.com, self-hosteable) en modo de evaluación
LOCAL: el SDK descarga el "environment document" completo una vez y lo
refresca en un hilo de fondo cada `FLAGSMITH_POLL_SECONDS` (default 30s) —
cada `get_bool`/`get_float` de este módulo es una lectura en memoria, nunca
una llamada de red dentro de un turno. Apagado de fábrica
(`FLAGSMITH_ENVIRONMENT_KEY` vacío): todos los `get_*` devuelven el default
que reciben sin intentar importar el SDK — el agente se comporta
exactamente igual que sin este módulo. Si la librería falta, la llave es
inválida, o Flagsmith está caído, degrada al default (fail-open) — mismo
principio del resto de las capas: una falla de configuración remota nunca
debe tumbar ni retrasar un turno.

Solo cubre un puñado de nombres de flag, a propósito (ver los `get_*` en
`guards/scope.py`, `pipeline/turn.py`, `guards/pii.py`, `agent.py`): los que
tiene sentido tocar en caliente. No es un mecanismo general para mover
cualquier valor de `config.py` — los presupuestos de tiempo que
`Settings.__post_init__` valida entre sí (el orden de los tres timeouts por
tipo de turno, por ejemplo) siguen siendo solo de env: no deben poder
romperse desde un flag remoto mal puesto.
"""

from __future__ import annotations

import logging
from typing import Any

from .config import get_settings

_logger = logging.getLogger(__name__)

# Cacheados a nivel de proceso, igual que el resto de las integraciones
# opcionales (`guards/pii.py`, `observability.py`, `guards/nemo_rails.py`).
_client: Any = None
_broken = False


def _get_client() -> Any:
    global _client, _broken
    if _client is not None or _broken:
        return _client
    settings = get_settings()
    if not settings.remote_config_enabled:
        return None
    try:
        from flagsmith import Flagsmith

        _client = Flagsmith(
            environment_key=settings.flagsmith_environment_key,
            api_url=settings.flagsmith_api_url or None,
            enable_local_evaluation=True,
            environment_refresh_interval_seconds=settings.flagsmith_poll_seconds,
        )
    except Exception:  # noqa: BLE001 - SDK ausente o llave inválida no debe tumbar el turno
        _logger.warning("Flagsmith no disponible; se sigue con la configuración local", exc_info=True)
        _broken = True
        _client = None
    return _client


def _environment_flags() -> Any:
    client = _get_client()
    if client is None:
        return None
    try:
        return client.get_environment_flags()
    except Exception:  # noqa: BLE001 - una lectura fallida no debe perder el turno
        _logger.warning("Flagsmith falló obteniendo flags; se usa la configuración local", exc_info=True)
        return None


def get_bool(name: str, default: bool) -> bool:
    """Feature flag booleano remoto, o `default` si está apagado/roto/ausente."""
    flags = _environment_flags()
    if flags is None:
        return default
    try:
        return bool(flags.is_feature_enabled(name))
    except Exception:  # noqa: BLE001 - un flag mal configurado en Flagsmith no debe bloquear
        return default


def get_float(name: str, default: float) -> float:
    """Hiperparámetro numérico remoto (habilitado Y con valor), o `default`."""
    flags = _environment_flags()
    if flags is None:
        return default
    try:
        if not flags.is_feature_enabled(name):
            return default
        value = flags.get_feature_value(name)
        return default if value is None else float(value)
    except Exception:  # noqa: BLE001
        return default
