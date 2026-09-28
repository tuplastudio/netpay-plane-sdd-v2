"""Asistente para crear el bot a partir de una descripción en español.

Dos endpoints:

* `POST /setup/draft` recibe la descripción libre del negocio y devuelve un
  borrador con dos piezas:
    - `negocio_md`: archivo Markdown con frontmatter (negocio, agente, tono,
      horario, cobertura, etc.) y secciones de conocimiento (qué venden,
      envíos, devoluciones, contacto, FAQ).
    - `agent_settings`: parche para `AgentSettings` con los campos seguros de
      extraer (identidad, tono, saludo, reglas extra, temas prohibidos,
      palabras de handoff, estilo de venta).
  El borrador NO se persiste: el dueño lo revisa y decide si lo aplica.

* `POST /setup/apply` recibe el mismo borrador (posiblemente editado por la
  persona) y lo aplica: guarda el `.md` en `tenants/<id>/uploads/` y hace PUT
  a `AgentSettings`. Luego invalida la caché de conocimiento para que el
  siguiente turno del agente ya use el nuevo perfil.

El LLM es uno barato por defecto (`openai/gpt-4o-mini`) — el prompt es
estructurado (system + few-shot) y la salida es JSON corto. Sin OpenRouter key
configurada, los endpoints devuelven 503 con mensaje claro (igual que el resto
del agente: nunca falla hacia falso éxito).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from ..agent import _TenantModelCache
from ..agent_settings import (
    SALES_STYLES,
    get_settings_store,
)
from ..config import Settings
from ..knowledge import (
    reload_knowledge,
    save_uploaded_doc,
)
from ..runtime import runtime

logger = logging.getLogger(__name__)

# `gpt-4o-mini` es el mismo modelo barato que ya usa el filtro de respuestas
# (`moderation.py`) — prompt estructurado, salida corta, baja temperatura.
_DEFAULT_MODEL = "openai/gpt-4o-mini"
_TIMEOUT_SECONDS = 30.0
_MAX_TOKENS = 2000
# Lo que cabe en el input: la descripción del dueño rara vez pasa de 2 KB, pero
# el system prompt ya pesa. Si alguien pega la historia de su empresa, este
# límite acota el costo por generación.
_MAX_DESCRIPTION_CHARS = 4000

# Nombre reservado del .md generado por el wizard. Va en `uploads/`, igual que
# cualquier documento subido a mano: el panel lo lista y lo puede borrar.
_GENERATED_FILENAME = "negocio.generado.md"

_SYSTEM_PROMPT = """\
Eres un asistente que ayuda al dueño de un negocio a configurar su bot de \
ventas. El dueño te da una descripción libre en español de su negocio \
(giro, horarios, políticas, etc.) y tú devuelves un borrador ESTRUCTURADO \
con dos piezas:

1. `negocio_md`: archivo Markdown con frontmatter YAML y secciones. Es la \
base de conocimiento que el bot va a leer. Tono profesional, datos del \
dueño tal cual los dio, sin inventar datos que no estén en la descripción \
(precios, fechas, RFC, direcciones exactas → dejar vacío o genérico).
2. `agent_settings`: objeto con los campos configurables del bot.

REGLAS DURAS:
- NO inventes datos que el dueño no mencionó. Si no dijo horario, deja \
`horario: ""` y una sección de FAQ que diga "consultar horarios".
- Si algo es ambiguo (p. ej. "a veces hago envíos"), interprétalo como \
política pero NO como dato duro (no asumas zonas ni costos).
- `forbidden_topics` solo si el dueño lo dijo explícitamente; vacío si no.
- `handoff_keywords` son palabras que el dueño quiere que escalen a humano \
(quejas, reclamo, devolución, factura, asesor, humano...). Vacío si no las \
dio explícitamente.
- `sales_style`:
    - "cerrador" si vende algo con cierre rápido (comida, recargas, \
productos de impulso, ticket bajo) o si el dueño dijo que empuja la venta.
    - "consultivo" si vende algo donde hay que entender la necesidad \
(pinturas, refacciones, mayoreo, productos técnicos).
    - "informativo" si el dueño dijo que solo resuelve dudas o si es un \
negocio de soporte.
- El tono (`tone`) debe ser una frase corta en español, sin comillas. Si \
el dueño no lo dijo, usa el que mejor encaje con su giro (cercano para \
comercio, profesional para servicios).
- `emoji` true si el giro es informal (comida, retail, moda), false si es \
formal (legal, salud, financiero). Default null si no hay señales claras.
- El Markdown debe tener entre 3 y 8 secciones. Cada sección con \
encabezado `##` y 2-6 oraciones. NO repetir el nombre del negocio en cada \
sección: ya está en el frontmatter y en el `#` principal.
- La primera línea del cuerpo SIEMPRE es `# <nombre del negocio>`.
- NO incluyas líneas `> interno:` — el frontmatter ya carga los datos \
públicos al bot. Si el dueño dio contexto "para el equipo", redáctalo como \
sección normal pero indicando claramente que es solo para uso interno.
- NO uses placeholders tipo "<TU_NEGOCIO>" — escribe el nombre real.
- Devuelve SOLO el JSON, sin markdown fuera, sin explicaciones.
"""

_JSON_SCHEMA_HINT = """\
Esquema del JSON a devolver (claves exactas):

{
  "summary": "frase corta de lo que entendiste del negocio (1 línea)",
  "negocio_md": "---\\nnegocio: ...\\nagente: ...\\n...\\n---\\n\\n# Nombre\\n\\n## ...",
  "agent_settings": {
    "agent_name": "string o ''",
    "business_name": "string o ''",
    "tone": "string o ''",
    "greeting": "string o ''",
    "emoji": true | false | null,
    "sales_style": "cerrador" | "consultivo" | "informativo",
    "extra_rules": "string o '' (una regla por renglón)",
    "forbidden_topics": "string o '' (separadas por coma)",
    "handoff_keywords": ["palabras", "en", "minúsculas"]
  }
}
"""

_FEW_SHOT_USER = """\
Descripción del dueño:

"Soy María. Tengo una papelería llamada 'La pluma de oro' en Guadalajara. \
Abrimos de lunes a sábado de 8am a 7pm. Vendemos papelería, copias, \
impresiones, regalos. Hacemos envíos a todo México. Aceptamos efectivo, \
transferencia y tarjeta. No hacemos facturas. Si alguien se queja, me \
pasan con el dueño (yo). Quiero que el bot suene amable, tutea, usa \
emojis con moderación. El bot debe empujar a comprar: si preguntan por \
algo, sugiere dos o tres productos parecidos."

Devuelve SOLO el JSON.
"""

_FEW_SHOT_ASSISTANT = """\
{
  "summary": "Papelería en GDL con envíos a todo México, sin facturación, escalación directa a la dueña.",
  "negocio_md": "---\\nnegocio: La pluma de oro\\nagente: María\\ntono: amable, cercano, tuteo mexicano\\nidioma: es-MX\\nmoneda: MXN\\nhorario: Lunes a sábado de 8:00 a 19:00\\ncobertura: Guadalajara (tienda) y todo México (envíos)\\ntelefono: ''\\nsaludo: ¡Hola! Soy María, de La pluma de oro 🖊️ ¿En qué te ayudo?\\n---\\n\\n# La pluma de oro\\n\\n## Quiénes somos\\n\\nPapelería en Guadalajara con atención al público de lunes a sábado. Ofrecemos papelería escolar y de oficina, servicio de copias e impresiones, y una sección de regalos.\\n\\n## Qué vendemos\\n\\n- Papelería escolar y de oficina (cuadernos, plumas, lápices, carpetas).\\n- Copias e impresiones blanco/negro y color.\\n- Artículos de regalo.\\n\\n## Envíos\\n\\nHacemos envíos a todo México. El costo y el plazo se calculan al cotizar, según destino y volumen.\\n\\n## Formas de pago\\n\\nEfectivo, transferencia y tarjeta.\\n\\n## Facturación\\n\\nNo emitimos facturas.\\n\\n## Cuando el cliente pide hablar con una persona\\n\\nSi alguien quiere hablar con el dueño, la conversación se transfiere de inmediato.\\n",
  "agent_settings": {
    "agent_name": "María",
    "business_name": "La pluma de oro",
    "tone": "amable, cercano, tuteo mexicano, usa emojis con moderación",
    "greeting": "¡Hola! Soy María, de La pluma de oro 🖊️ ¿En qué te ayudo?",
    "emoji": true,
    "sales_style": "cerrador",
    "extra_rules": "Sugiere dos o tres productos parecidos cuando el cliente pregunta por uno.\\nSi preguntan por precios, da el del catálogo y empuja al siguiente paso de compra.\\nSi dicen que quieren factura, di que no se emiten y ofrece pasar con la dueña.",
    "forbidden_topics": "",
    "handoff_keywords": ["queja", "reclamo", "devolución", "dueña", "dueño", "humano", "asesor"]
  }
}
"""

_SALES_STYLE_SET = set(SALES_STYLES)

_HANDBOOK_TRUTHFULNESS = (
    "Si la descripción del dueño menciona algo que no puedes verificar (precios concretos, "
    "horarios exactos, RFC, direcciones), NO lo inventes: déjalo vacío en el frontmatter "
    "y menciónalo como 'consultar' en la sección correspondiente del .md."
)


def _model_cache() -> _TenantModelCache:
    """Comparte el cache del filtro/moderación para no reconstruir ChatOpenAI.

    `agent._TenantModelCache` no es parte del contrato público pero ya está
    reutilizado por `moderation.py`; usarlo aquí evita una segunda instancia.
    """
    return _TenantModelCache(runtime.settings)


def _parse_draft(content: str) -> dict[str, Any] | None:
    """Saca el JSON del contenido. Falla hacia None: el caller decide."""
    raw = (content or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.DOTALL)
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end < 0:
        return None
    try:
        payload = json.loads(raw[start : end + 1])
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def _validate_draft(payload: dict[str, Any]) -> dict[str, Any]:
    """Recorta/normaliza el JSON del LLM al esquema que el front espera.

    Lo que viene del modelo es "casi JSON": puede tener campos extra, tipos
    raros, valores fuera de dominio. Mejor recortar aquí que tirar el draft
    entero: el dueño lo va a revisar en el wizard antes de aplicar.
    """
    negocio_md = str(payload.get("negocio_md") or "").strip()
    if not negocio_md:
        raise HTTPException(status_code=422, detail="El borrador no incluye negocio.md")
    if len(negocio_md) > 80_000:
        raise HTTPException(status_code=422, detail="El .md generado excede el límite (80 KB)")

    settings_payload = payload.get("agent_settings")
    if not isinstance(settings_payload, dict):
        settings_payload = {}

    def _opt_str(value: Any, limit: int) -> str:
        text = str(value or "").strip()
        return text[:limit]

    sales_style = str(settings_payload.get("sales_style") or "").strip().lower()
    if sales_style not in _SALES_STYLE_SET:
        sales_style = "cerrador"

    emoji_raw = settings_payload.get("emoji")
    if isinstance(emoji_raw, bool):
        emoji: bool | None = emoji_raw
    else:
        emoji = None

    handoff_raw = settings_payload.get("handoff_keywords") or []
    if isinstance(handoff_raw, str):
        handoff_list = [w.strip().lower()[:60] for w in re.split(r"[,\n]", handoff_raw) if w.strip()]
    elif isinstance(handoff_raw, list):
        handoff_list = [str(w).strip().lower()[:60] for w in handoff_raw if str(w).strip()]
    else:
        handoff_list = []
    handoff_list = handoff_list[:30]

    return {
        "summary": _opt_str(payload.get("summary"), 240),
        "negocio_md": negocio_md,
        "agent_settings": {
            "agent_name": _opt_str(settings_payload.get("agent_name"), 60),
            "business_name": _opt_str(settings_payload.get("business_name"), 120),
            "tone": _opt_str(settings_payload.get("tone"), 300),
            "greeting": _opt_str(settings_payload.get("greeting"), 300),
            "emoji": emoji,
            "sales_style": sales_style,
            "extra_rules": _opt_str(settings_payload.get("extra_rules"), 4000),
            "forbidden_topics": _opt_str(settings_payload.get("forbidden_topics"), 2000),
            "handoff_keywords": handoff_list,
        },
    }


router = APIRouter(tags=["configuracion"])


class DraftRequest(BaseModel):
    description: str = Field(min_length=20, max_length=_MAX_DESCRIPTION_CHARS)
    # Si el dueño ya tiene un bot configurado y solo quiere regenerar el .md,
    # puede mandar lo que ya tenía para que el LLM lo refine en vez de empezar
    # de cero. Opcional.
    existing_draft: dict[str, Any] | None = None


class DraftResponse(BaseModel):
    summary: str
    negocio_md: str
    agent_settings: dict[str, Any]


@router.post("/setup/draft", response_model=DraftResponse)
async def setup_draft(
    req: DraftRequest, tenantId: str = Query(...)
) -> DraftResponse:
    """Genera un borrador de `negocio.md` + `AgentSettings` desde una descripción.

    No escribe nada en disco: el dueño revisa el borrador en el panel y, si
    le gusta, lo manda aplicar a `POST /setup/apply`.
    """
    settings: Settings = runtime.settings
    if not settings.openrouter_key:
        raise HTTPException(
            status_code=503,
            detail="No hay OpenRouter key configurada en el servicio; el generador no puede funcionar.",
        )

    model_id = _DEFAULT_MODEL
    description = req.description.strip()
    if len(description) < 20:
        raise HTTPException(status_code=422, detail="La descripción es demasiado corta (mínimo 20 caracteres)")

    user_text = f"Descripción del dueño:\n\n{description}"
    if req.existing_draft:
        # El dueño quiere refinar: el LLM parte de lo que ya había.
        user_text += (
            "\n\nBorrador actual (puedes mejorarlo, corregirlo o simplificarlo):\n"
            + json.dumps(req.existing_draft, ensure_ascii=False)
        )

    messages = [
        SystemMessage(_SYSTEM_PROMPT + "\n" + _JSON_SCHEMA_HINT + "\n" + _HANDBOOK_TRUTHFULNESS),
        HumanMessage(_FEW_SHOT_USER),
        # AIMessage es la respuesta esperada del few-shot: el modelo solo
        # tiene que seguir el patrón. NO es lo que verá el dueño, es solo la
        # continuación de la conversación para enseñarle el formato.
        AIMessage(_FEW_SHOT_ASSISTANT),
        HumanMessage(user_text),
    ]

    started = time.monotonic()
    try:
        model = await _model_cache().get(model_id, 0.2, _MAX_TOKENS, settings.openrouter_key)
        response = await asyncio.wait_for(
            model.ainvoke(messages),
            timeout=_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        logger.warning("tenant %s: setup/draft timeout tras %.1fs", tenantId, _TIMEOUT_SECONDS)
        raise HTTPException(status_code=504, detail="El modelo tardó demasiado; intenta con una descripción más corta") from exc
    except Exception as exc:
        logger.warning("tenant %s: setup/draft falló con %r", tenantId, model_id, exc_info=True)
        raise HTTPException(status_code=502, detail="El modelo no pudo generar el borrador") from exc

    latency_ms = int((time.monotonic() - started) * 1000)
    parsed = _parse_draft(getattr(response, "content", "") or "")
    if parsed is None:
        logger.warning(
            "tenant %s: setup/draft devolvió JSON ilegible (lat=%dms)",
            tenantId, latency_ms,
        )
        raise HTTPException(
            status_code=502,
            detail="El modelo no devolvió un JSON válido. Vuelve a intentarlo.",
        )
    return DraftResponse(**_validate_draft(parsed))


class ApplyRequest(BaseModel):
    summary: str = ""
    negocio_md: str = Field(min_length=1, max_length=80_000)
    agent_settings: dict[str, Any]


@router.post("/setup/apply")
async def setup_apply(
    req: ApplyRequest, tenantId: str = Query(...)
) -> dict[str, Any]:
    """Aplica un borrador (posiblemente editado por el dueño) al tenant.

    Pasos:
      1. Guarda el `.md` en `tenants/<id>/uploads/negocio.generado.md`.
      2. Hace `update` del `AgentSettings` con el patch.
      3. Recarga la caché de conocimiento del tenant.
    """
    settings = req.agent_settings or {}
    # Filtra el patch a las claves que `sanitize` realmente entiende y que
    # además NO son de canal/operación (no tocamos el filtro de respuestas,
    # el autocierre ni la key de OpenRouter desde aquí).
    safe_keys = {
        "agent_name", "business_name", "tone", "greeting", "emoji",
        "sales_style", "extra_rules", "forbidden_topics", "handoff_keywords",
    }
    patch = {k: v for k, v in settings.items() if k in safe_keys}

    # 1. Guardar el .md. `save_uploaded_doc` ya sanea el nombre y valida el
    # tamaño/encoding; el dueño no puede salirse del directorio del tenant.
    try:
        doc_id = save_uploaded_doc(
            tenantId, _GENERATED_FILENAME, req.negocio_md.encode("utf-8")
        )
    except Exception as exc:
        logger.warning("tenant %s: setup/apply no pudo guardar .md: %r", tenantId, exc)
        raise HTTPException(status_code=400, detail=f"No se pudo guardar el archivo: {exc}") from exc

    # 2. Actualizar ajustes. `update` aplica `sanitize` (recortes, defaults)
    # y persiste a disco. Si el patch está vacío, igual pasa — el dueño
    # podría querer solo regenerar el .md.
    if patch:
        get_settings_store().update(tenantId, patch)

    # 3. Invalidar la caché de conocimiento: el siguiente turno del agente
    # ya debe leer el nuevo perfil.
    chars = len(reload_knowledge(tenantId))

    return {
        "applied": True,
        "docId": doc_id,
        "knowledgeChars": chars,
        "settingsKeys": sorted(patch.keys()),
        "summary": req.summary,
    }
