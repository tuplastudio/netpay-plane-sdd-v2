"""Clasificación de intención del turno.

Camino principal: un modelo pequeño (OpenRouter) devuelve JSON con la
intención y los slots que trae el mensaje (nombre, correo, cantidad,
opción elegida...). Temperatura 0, sin herramientas, pocos tokens: cuesta
una fracción de un turno con tool calling y entiende variantes que ningún
regex cubre ("me late la segunda", "cuánto me sale todo", "soy Carlos de
Culiacán").

Camino de respaldo: reglas léxicas (los regex que antes vivían en graph.py)
cuando no hay clave, el proveedor falla o el JSON viene roto. Así el agente
nunca se queda mudo, pero la calidad de intención ya no depende de una lista
de palabras.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from .config import Settings, get_settings
from .providers.model_gateway import ModelGateway, ModelUnavailable
from .state import AgentState
from .text import normalize, parse_quantity

INTENTS: tuple[str, ...] = (
    "GREETING",
    "THANKS",
    "OPTOUT",
    "HUMAN",
    "COMPLAINT",
    "CONFIRM",
    "DENY",
    "SELECT_OPTION",
    "PROVIDE_IDENTITY",
    "QUANTITY",
    "PRODUCT_QUERY",
    "CATALOG_BROWSE",
    "QUOTE_REQUEST",
    "PAY_REQUEST",
    "ORDER_STATUS",
    "HISTORY",
    "BUSINESS_QUESTION",
    "OTHER",
)


@dataclass
class IntentResult:
    intent: str = "OTHER"
    confidence: float = 0.0
    engine: str = "rules"  # "model" | "rules"
    cost_usd: float = 0.0
    # Slots extraídos del mensaje (todos opcionales).
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    quantity: str | None = None
    unit: str | None = None
    ordinal: int | None = None  # 1-based: "la segunda" -> 2
    product_query: str | None = None
    order_ref: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    def is_(self, *intents: str) -> bool:
        return self.intent in intents


# ---------------------------------------------------------------
# Respaldo léxico (antes en graph.py). Solo se usa sin modelo.
# ---------------------------------------------------------------

_GREETING = re.compile(r"\b(hola|holi|buenas|buenos dias|buenas tardes|buenas noches|que tal|hey|klk|ola)\b")
_THANKS = re.compile(r"\b(gracias|muchas gracias|te pasaste|excelente|perfecto)\b")
_HUMAN = re.compile(r"\b(humano|persona|asesor|ejecutivo|agente real|hablar con alguien|no me sirves|supervisor)\b")
_COMPLAINT = re.compile(r"\b(queja|reclamo|pesimo|malisimo|fraude|estafa|demanda|molesto|enojado)\b")
_CONFIRM = re.compile(r"^(si|sip|sí|claro|va|dale|ok|okay|de acuerdo|adelante|hagalo|hazlo|confirmo|correcto|asi es|sale)\b")
_DENY = re.compile(r"^(no|nel|nop|todavia no|aun no|espera|cancela)\b")
_QUOTE = re.compile(r"\b(cotiza|cotizacion|cotizar|presupuesto|cuanto (me )?(sale|queda|cuesta)|precio total|total)\b")
_PAY = re.compile(r"\b(pagar|pago|link de pago|liga de pago|checkout|tarjeta|comprar|lo llevo|lo quiero)\b")
_ORDER_STATUS = re.compile(r"\b(mi pedido|mi orden|donde va|rastreo|seguimiento|ya llego|estatus|estado del pedido|ya pague|ya pagué)\b")
_HISTORY = re.compile(r"\b(mi cotizacion|mis cotizaciones|cotizacion anterior|pedido anterior|pedidos anteriores|lo que pedi|la otra vez|historial|lo mismo de siempre)\b")
_BROWSE = re.compile(r"\b(que (tienen|venden|manejan)|catalogo|productos|lista de precios|que hay)\b")
_BUSINESS = re.compile(
    r"\b(envio|envios|enviar|entrega|entregan|paqueteria|"
    r"pagos|pagar con|transferencia|paypal|"
    r"factura|facturan|facturacion|cfdi|rfc|"
    r"horario|horarios|abren|cierran|"
    r"sucursal|sucursales|tienda fisica|direccion|donde estan|ubicacion|cedis|"
    r"devolucion|devoluciones|devolver|reembolso|garantia|cambio|"
    r"distribuidor|distribuir|mayoreo|revendedor|"
    r"quienes son|que es|de que esta hecho|ingredientes|azucar|calorias|nutrimental|"
    r"rinde|rendimiento|como se prepara|preparar|caduca|caducidad|"
    r"promocion|promociones|descuento|primera compra|"
    r"certificacion|sqf|contacto|telefono)\b"
)
_OPTOUT = re.compile(r"\b(no me escribas|baja|dar de baja|stop|deja de escribir)\b")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE = re.compile(r"\+?\d[\d\s-]{8,}\d")
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
_ORDINAL: dict[str, int] = {
    "1": 1, "primero": 1, "primera": 1, "uno": 1,
    "2": 2, "segundo": 2, "segunda": 2, "dos": 2,
    "3": 3, "tercero": 3, "tercera": 3, "tres": 3,
}


def classify_rules(text: str, state: AgentState) -> IntentResult:
    norm = normalize(text)
    stripped = norm.strip()
    result = IntentResult(engine="rules", confidence=0.5)

    email = _EMAIL.search(text)
    if email:
        result.email = email.group(0)
    order = _UUID.search(text)
    if order:
        result.order_ref = order.group(0)
    quantity, unit, _ = parse_quantity(text)
    result.quantity, result.unit = quantity, unit

    if _OPTOUT.search(norm):
        result.intent = "OPTOUT"
    elif _COMPLAINT.search(norm):
        result.intent = "COMPLAINT"
    elif _HUMAN.search(norm):
        result.intent = "HUMAN"
    elif "nombre" in state.pending_slots and not _CONFIRM.match(stripped):
        result.intent, result.name = "PROVIDE_IDENTITY", text.strip()[:120]
    elif state.candidates and _ordinal_of(stripped):
        result.intent, result.ordinal = "SELECT_OPTION", _ordinal_of(stripped)
    elif _HISTORY.search(norm):
        result.intent = "HISTORY"
    elif _ORDER_STATUS.search(norm):
        result.intent = "ORDER_STATUS"
    elif _CONFIRM.match(stripped):
        result.intent = "CONFIRM"
    elif _DENY.match(stripped):
        result.intent = "DENY"
    elif _PAY.search(norm):
        result.intent = "PAY_REQUEST"
    elif _QUOTE.search(norm):
        result.intent = "QUOTE_REQUEST"
    elif quantity and state.cart and "cantidad" in state.pending_slots:
        result.intent = "QUANTITY"
    elif _BUSINESS.search(norm):
        result.intent = "BUSINESS_QUESTION"
    elif _BROWSE.search(norm):
        result.intent = "CATALOG_BROWSE"
    elif email and len(norm.split()) <= 6:
        result.intent = "PROVIDE_IDENTITY"
    elif _GREETING.search(norm) and len(norm.split()) <= 4:
        result.intent = "GREETING"
    elif _THANKS.search(norm) and len(norm.split()) <= 4:
        result.intent = "THANKS"
    else:
        short = len(norm.split()) <= 12 and not norm.endswith("?")
        result.intent = "PRODUCT_QUERY" if (short or quantity) else "OTHER"
        result.product_query = text
    return result


def _ordinal_of(stripped: str) -> int | None:
    for key, index in _ORDINAL.items():
        if (
            stripped == key
            or stripped.startswith(f"{key} ")
            or stripped.startswith(f"el {key}")
            or stripped.startswith(f"la {key}")
            or stripped.startswith(f"opcion {key}")
        ):
            return index
    return None


# ---------------------------------------------------------------
# Clasificador con modelo
# ---------------------------------------------------------------

_SYSTEM = """Eres el clasificador de intención de un agente de ventas por WhatsApp (español de México).
Devuelves SOLO un objeto JSON, sin texto alrededor, con esta forma:
{"intent": <una de las etiquetas>, "confidence": 0..1,
 "name": str|null, "email": str|null, "phone": str|null,
 "quantity": str|null, "unit": str|null, "ordinal": int|null,
 "product_query": str|null, "order_ref": str|null}

Etiquetas:
GREETING saludo sin pedido · THANKS agradecimiento/cierre · OPTOUT no quiere mensajes
HUMAN pide persona/asesor · COMPLAINT queja/enojo · CONFIRM acepta lo propuesto ("sí", "va", "dale", "así está bien")
DENY rechaza/pospone · SELECT_OPTION elige una opción mostrada (ordinal 1-based o nombre)
PROVIDE_IDENTITY da su nombre/correo/teléfono · QUANTITY solo dice una cantidad
PRODUCT_QUERY pide/pregunta por un producto concreto (pon en product_query lo que busca)
CATALOG_BROWSE pregunta qué venden en general · QUOTE_REQUEST quiere cotización/total
PAY_REQUEST quiere pagar/comprar ya/link de pago · ORDER_STATUS pregunta por un pedido o dice que ya pagó
HISTORY pregunta por cotizaciones/pedidos anteriores o quiere repetir una compra
BUSINESS_QUESTION pregunta sobre el negocio (envíos, horarios, factura, pagos, garantía, ingredientes...)
OTHER nada de lo anterior

Reglas: si el mensaje trae producto Y cantidad, intent=PRODUCT_QUERY y llena quantity.
Si trae nombre/correo además de otra cosa, llena esos campos igual (el intent es lo principal).
quantity siempre como string numérico ("2", "0.5"). Nunca inventes datos que no estén en el mensaje."""


class IntentClassifier:
    def __init__(self, gateway: ModelGateway, settings: Settings | None = None) -> None:
        self.gateway = gateway
        self.settings = settings or get_settings()

    async def classify(
        self, text: str, state: AgentState, *, model: str | None = None
    ) -> IntentResult:
        if not self.gateway.is_live():
            return classify_rules(text, state)
        try:
            chat = await self.gateway.chat(
                [
                    {"role": "system", "content": _SYSTEM},
                    {"role": "user", "content": self._user_block(text, state)},
                ],
                model=model or self.settings.classifier_model or None,
                temperature=0.0,
                max_tokens=220,
            )
        except ModelUnavailable:
            return classify_rules(text, state)

        parsed = _parse_json(chat.content)
        if not parsed or parsed.get("intent") not in INTENTS:
            fallback = classify_rules(text, state)
            fallback.cost_usd = chat.cost_usd
            return fallback

        result = IntentResult(
            intent=str(parsed["intent"]),
            confidence=_float(parsed.get("confidence"), 0.8),
            engine="model",
            cost_usd=chat.cost_usd,
            name=_str(parsed.get("name")),
            email=_str(parsed.get("email")),
            phone=_str(parsed.get("phone")),
            quantity=_qty(parsed.get("quantity")),
            unit=_str(parsed.get("unit")),
            ordinal=_int(parsed.get("ordinal")),
            product_query=_str(parsed.get("product_query")),
            order_ref=_str(parsed.get("order_ref")),
            raw=parsed,
        )
        # Los slots que el modelo no llenó los completa el parser determinista
        # (más barato equivocarse hacia "no sé" que hacia un dato inventado).
        if result.quantity is None:
            qty, unit, _ = parse_quantity(text)
            result.quantity, result.unit = qty, result.unit or unit
        if result.order_ref is None:
            found = _UUID.search(text)
            result.order_ref = found.group(0) if found else None
        if result.email is None:
            found = _EMAIL.search(text)
            result.email = found.group(0) if found else None
        return result

    @staticmethod
    def _user_block(text: str, state: AgentState) -> str:
        context = [
            f"opciones_mostradas={len(state.candidates)}",
            f"carrito={len(state.cart)}",
            f"pendiente={','.join(state.pending_slots) or 'nada'}",
            f"cotizacion_vigente={'si' if state.quote_id else 'no'}",
            f"pedido={'si' if state.order_id else 'no'}",
        ]
        last_bot = next(
            (m["content"] for m in reversed(state.messages[:-1]) if m["role"] == "assistant"),
            "",
        )
        return (
            f"Contexto: {'; '.join(context)}\n"
            f"Último mensaje del agente: {last_bot[:200] or '(ninguno)'}\n"
            f"Mensaje del cliente: {text[:600]}"
        )


def _parse_json(content: str) -> dict[str, Any] | None:
    raw = (content or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.S)
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end < 0:
        return None
    try:
        data = json.loads(raw[start : end + 1])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:200] or None


def _qty(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", ".")
    return text if re.fullmatch(r"\d+(?:\.\d+)?", text) else None


def _int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _float(value: Any, default: float) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return default
