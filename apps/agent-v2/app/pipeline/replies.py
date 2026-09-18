"""Qué texto recibe el cliente: extracción, respaldo y sugerencias.

- `message_text`: el contenido de un `AIMessage` puede ser un `str` o una
  lista de bloques (`[{"type": "text", "text": ...}]`, como devuelven los
  modelos de Anthropic vía OpenRouter). Antes solo se aceptaba `str`, así
  que un tenant con `anthropic/*` recibía respuestas vacías.
- `final_reply`: el último mensaje del asistente DE ESTE TURNO (después del
  último mensaje del cliente). Buscar "el último AIMessage del hilo" a secas
  devolvía la respuesta del turno anterior cuando el modelo terminaba sin
  texto, y el cliente recibía dos veces lo mismo.
- `fallback_reply`: si aun así no hay texto (el modelo cerró con una tool
  call y nada más), se contesta algo determinista y útil según el estado, en
  vez de un mensaje vacío que el puente de WhatsApp descarta en silencio.
- `suggestions`: chips del chat web según la etapa del pedido.
"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage, HumanMessage

from ..state import CartRecord, open_carts, primary_cart


def message_text(message: Any) -> str:
    """Texto plano de un mensaje de LangChain, venga como `str` o como bloques."""
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") in (None, "text"):
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(p.strip() for p in parts if p and p.strip()).strip()
    return ""


def final_reply(messages: list[Any]) -> tuple[str, AIMessage | None]:
    """Último `AIMessage` con texto posterior al último `HumanMessage`.

    Devuelve `("", None)` si el turno no produjo texto: el caller decide el
    respaldo. Un resumen de compactación también es `HumanMessage`, pero
    siempre queda ANTES del mensaje real del cliente, así que no estorba.
    """
    for message in reversed(messages or []):
        if isinstance(message, HumanMessage):
            break
        if isinstance(message, AIMessage):
            text = message_text(message)
            if text:
                return text, message
    return "", None


def last_assistant_reply(messages: list[Any]) -> str:
    """El último mensaje del agente del hilo completo (para el guardarraíl de
    tema: hace interpretable un "sí" o "la segunda" sueltos)."""
    for message in reversed(messages or []):
        if isinstance(message, AIMessage):
            text = message_text(message)
            if text:
                return text
    return ""


def fallback_reply(values: dict[str, Any]) -> str:
    """Respuesta determinista cuando el modelo no dejó texto.

    Prioriza lo que el cliente estaba esperando (enlace de pago, cotización)
    y nunca inventa importes ni URLs: solo usa lo que ya está en el estado,
    que a su vez salió de una herramienta.
    """
    if values.get("handoff"):
        return "Ya le avisé a una persona del equipo para que te atienda en un momento."
    _cart_id, record = primary_cart(values)
    if record.get("checkoutLink"):
        return f"Te dejo el enlace para pagar: {record['checkoutLink']}"
    if record.get("quoteId") and record.get("quoteLink"):
        return f"Aquí tienes tu cotización: {record['quoteLink']}"
    if record.get("lines"):
        return "Ya quedó anotado en tu pedido. ¿Te doy el total o agregamos algo más?"
    return "Perdón, se me cruzó el mensaje. ¿Me repites qué necesitas?"


def suggestions(values: dict[str, Any]) -> list[str]:
    """Chips de respuesta rápida del chat web según la etapa más avanzada."""
    if values.get("handoff"):
        return []
    carts: dict[str, CartRecord] = values.get("carts") or {}
    visible = list(open_carts(carts).values())
    if any(c.get("checkoutLink") for c in visible):
        return ["Ya pagué", "¿Cuándo llega mi pedido?", "Quiero factura"]
    if any(c.get("quoteId") for c in visible):
        return ["Sí, quiero pagar", "Cambiar cantidad", "Tengo una duda"]
    if visible:
        return ["¿Cuánto sale en total?", "Agregar otro producto", "Emitir cotización"]
    return ["¿Qué venden?", "Quiero cotizar", "¿Hacen envíos?"]
