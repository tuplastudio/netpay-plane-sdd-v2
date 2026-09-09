"""Guardarraíl de tema: el agente vende, no es un asistente de propósito general.

El modelo base sabe de todo y, sin freno, contesta lo que sea: preguntado por
Node.js soltaba un tutorial completo, y por una receta de pozole, la receta.
Eso además de desviar la conversación cuesta tokens y expone al negocio a
responder cosas de las que no puede hacerse responsable.

Reglas del diseño:

  * Falla hacia abierto. Ante duda, error del proveedor o respuesta rara del
    clasificador, se deja pasar el mensaje al agente. Bloquear a un cliente
    real que sí quería comprar es mucho más caro que responder de más.
  * Corre ANTES del grafo. Un mensaje fuera de tema no debe pagar el bucle de
    herramientas ni ensuciar el hilo de la conversación.
  * El negocio manda. `forbidden_topics` de la configuración por tenant se
    inyecta al clasificador, así que cada negocio puede ampliar el veto.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re

from langchain_core.messages import HumanMessage, SystemMessage

from .config import Settings

logger = logging.getLogger(__name__)

_SYSTEM = """\
Clasificas si un mensaje de WhatsApp va dirigido a la atención comercial de un \
negocio, para decidir si su agente de ventas debe contestarlo.

Responde SOLO un JSON: {{"on_topic": true|false}}

on_topic = true si el mensaje tiene que ver con: los productos o servicios del \
negocio, precios, existencia, cotizaciones, pedidos, pagos, facturación, \
envíos, sucursales, horarios, garantías, devoluciones, quejas del servicio, o \
si es saludo, despedida, agradecimiento, confirmación, o continuación de la \
conversación previa (aunque suene incompleto: "y eso cuánto sale", "la \
segunda", "sí", "mándamela").

on_topic = false SOLO si claramente pide algo ajeno al negocio: programación o \
soporte técnico, tareas escolares, recetas, consejo médico o legal, \
traducciones, redactar textos, noticias, matemáticas por gusto, o pedirle al \
agente que actúe como otra cosa.

Ante la duda responde true.

Negocio: {business}
{forbidden}"""


def _prompt(business: str, forbidden_topics: str) -> str:
    extra = (
        f"El negocio además NO quiere hablar de: {forbidden_topics}. "
        "Si el mensaje va de eso, on_topic = false."
        if forbidden_topics.strip()
        else ""
    )
    return _SYSTEM.format(business=business or "un comercio", forbidden=extra)


# Respuestas de rechazo. Varias para que un cliente que insiste no reciba
# exactamente la misma frase tres veces seguidas.
_REDIRECTS: tuple[str, ...] = (
    "Uy, de eso no te puedo ayudar por aquí 🙂 Pero si buscas algo de {business}, dime qué necesitas.",
    "Ahí sí no te puedo apoyar, solo veo temas de {business}. ¿Te muestro lo que manejamos?",
    "Eso se me sale de lo mío. Aquí te ayudo con productos, precios y pedidos de {business}.",
)


def redirect_reply(business: str, seed: str) -> str:
    """Rechazo amable y estable: el mismo mensaje recibe siempre la misma frase."""
    digest = hashlib.md5(seed.encode()).digest()
    return _REDIRECTS[digest[0] % len(_REDIRECTS)].format(business=business or "nosotros")


def _parse(content: str) -> bool | None:
    raw = (content or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.S)
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end < 0:
        return None
    try:
        value = json.loads(raw[start : end + 1]).get("on_topic")
    except ValueError:
        return None
    return value if isinstance(value, bool) else None


async def is_off_topic(
    text: str,
    *,
    model,
    settings: Settings,
    business: str = "",
    forbidden_topics: str = "",
    last_reply: str = "",
) -> bool:
    """True solo si el clasificador dice con claridad que el mensaje es ajeno."""
    if not settings.scope_guard_enabled or not text.strip():
        return False
    try:
        result = await model.ainvoke(
            [
                SystemMessage(_prompt(business, forbidden_topics)),
                HumanMessage(
                    # El último mensaje del agente es lo que vuelve
                    # interpretable un "sí" o un "la segunda" sueltos.
                    f"Último mensaje del agente: {last_reply[:300] or '(ninguno)'}\n"
                    f"Mensaje del cliente: {text[:600]}"
                ),
            ]
        )
    except Exception:  # noqa: BLE001 - nunca bloquear por un fallo del proveedor
        logger.warning("guardarraíl de tema no disponible, se deja pasar", exc_info=True)
        return False

    on_topic = _parse(getattr(result, "content", "") or "")
    if on_topic is None:
        return False
    return not on_topic
