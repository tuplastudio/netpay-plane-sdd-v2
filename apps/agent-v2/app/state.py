"""Estado del agente v2.

El problema del v1 era que el "hilo" vivía solo en el historial de mensajes:
cuando el historial se recortaba, el agente perdía qué llevaba el cliente en
el carrito, qué cotización tenía abierta y quién era. Aquí esos hechos viven
en campos propios del estado, se persisten en el checkpoint de LangGraph y se
vuelven a inyectar en el prompt en cada turno, sobrevivan o no los mensajes.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, NotRequired, TypedDict

from deepagents import DeepAgentState


class CartLine(TypedDict):
    variantId: str
    sku: str
    title: str
    quantity: str
    unitPrice: NotRequired[str | None]


class CustomerFacts(TypedDict, total=False):
    customerId: str | None
    name: str | None
    email: str | None
    phone: str | None
    notes: str | None


def _merge_customer(
    left: CustomerFacts | None, right: CustomerFacts | None
) -> CustomerFacts:
    """Los datos del cliente se acumulan: un turno que solo trae el correo no
    debe borrar el nombre que se capturó tres turnos antes."""
    merged: CustomerFacts = dict(left or {})  # type: ignore[assignment]
    for key, value in (right or {}).items():
        if value not in (None, ""):
            merged[key] = value  # type: ignore[literal-required]
    return merged


def _merge_cart(left: list[CartLine] | None, right: list[CartLine] | None) -> list[CartLine]:
    """Une líneas por `variantId`; cantidad "0" borra la línea.

    NO puede ser un reemplazo. LangGraph ejecuta todas las tool calls de un
    mismo mensaje del modelo contra el MISMO snapshot del estado y recién
    después funde los `Command`: con reemplazo, dos `agregar_al_carrito` en un
    turno ("2 de mango y 3 gorras") calculaban ambos sobre el carrito vacío y
    el segundo pisaba al primero. El agente decía haber agregado los dos y
    cobraba uno. Por eso las herramientas mandan solo su línea (un delta) y la
    unión pasa aquí, donde sí se ven todas.
    """
    if right is None:
        return left or []
    merged: dict[str, CartLine] = {line["variantId"]: line for line in (left or [])}
    for line in right:
        if str(line.get("quantity", "")).strip() in {"0", "0.000", ""}:
            merged.pop(line["variantId"], None)
        else:
            merged[line["variantId"]] = line
    return list(merged.values())


def _last(left: Any, right: Any) -> Any:
    return right if right is not None else left


class SalesState(DeepAgentState):
    """DeepAgentState (messages + todos + filesystem) más la memoria comercial."""

    customer: Annotated[CustomerFacts, _merge_customer]
    cart: Annotated[list[CartLine], _merge_cart]
    quote_id: Annotated[str | None, _last]
    quote_link: Annotated[str | None, _last]
    quote_signature: Annotated[str | None, _last]
    order_id: Annotated[str | None, _last]
    checkout_link: Annotated[str | None, _last]
    last_totals: Annotated[dict[str, Any] | None, _last]
    handoff: Annotated[bool, _last]
    handoff_reason: Annotated[str | None, _last]
    stage: Annotated[
        Literal[
            "DESCUBRIMIENTO",
            "ARMANDO_CARRITO",
            "COTIZADO",
            "COTIZACION_EMITIDA",
            "PAGO_ENVIADO",
            "CERRADO",
            "HUMANO",
        ]
        | None,
        _last,
    ]


class TurnContext(TypedDict, total=False):
    """Contexto por invocación: nunca sale del texto del cliente."""

    tenant_id: str
    conversation_id: str
    channel: str
    scopes: list[str]
    customer_phone: str | None
    customer_name: str | None
    customer_email: str | None


def cart_summary(cart: list[CartLine] | None) -> str:
    if not cart:
        return "vacío"
    return "; ".join(
        f"{line['quantity']} x {line.get('title') or line['variantId']} ({line.get('sku', '')})"
        for line in cart
    )


def working_memory_block(state: dict[str, Any]) -> str:
    """Bloque que se inyecta en cada turno: el hilo comercial explícito."""
    customer: CustomerFacts = state.get("customer") or {}
    lines = [f"Etapa: {state.get('stage') or 'DESCUBRIMIENTO'}"]

    who = [
        f"nombre={customer.get('name')}" if customer.get("name") else None,
        f"correo={customer.get('email')}" if customer.get("email") else None,
        f"teléfono={customer.get('phone')}" if customer.get("phone") else None,
    ]
    known = ", ".join(p for p in who if p)
    lines.append(f"Cliente: {known or 'sin identificar todavía'}")
    lines.append(f"Carrito: {cart_summary(state.get('cart'))}")

    totals = state.get("last_totals") or {}
    if totals:
        body = totals.get("totals", totals)
        lines.append(f"Último total calculado: ${body.get('total')} (subtotal ${body.get('subtotal')})")
    if state.get("quote_id"):
        lines.append(f"Cotización emitida: {state['quote_id']} — {state.get('quote_link') or 'sin enlace'}")
    if state.get("order_id"):
        lines.append(f"Pedido: {state['order_id']}")
    if state.get("checkout_link"):
        lines.append(f"Enlace de pago ya enviado: {state['checkout_link']}")
    return "\n".join(lines)
