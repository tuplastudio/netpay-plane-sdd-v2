"""Estado del agente v2.

El problema del v1 era que el "hilo" vivía solo en el historial de mensajes:
cuando el historial se recortaba, el agente perdía qué llevaba el cliente en
el carrito, qué cotización tenía abierta y quién era. Aquí esos hechos viven
en campos propios del estado, se persisten en el checkpoint de LangGraph y se
vuelven a inyectar en el prompt en cada turno, sobrevivan o no los mensajes.

Múltiples carritos/cotizaciones a la vez
-----------------------------------------
Un cliente real no siempre lleva un solo pedido: puede estar cotizando
"playeras para el equipo" y a la vez "el regalo para mi jefe" como cosas
separadas, o pedir cambios en dos cotizaciones ya emitidas en la misma
conversación. Por eso el carrito NO es un campo único: es un diccionario
``carts`` de ``carritoId -> CartRecord``, cada uno con su propio carrito,
total, cotización, pedido y enlace de pago.

``active_cart_id`` es el último carrito que tocó una herramienta: las tools
que reciben `carritoId=""` (el caso normal, de un solo pedido) resuelven a
ese carrito activo, así que una conversación de un solo pedido se comporta
exactamente igual que antes — el modelo nunca necesita pensar en IDs de
carrito a menos que el cliente de verdad esté llevando más de uno.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, NotRequired, TypedDict

from deepagents import DeepAgentState

CartStage = Literal[
    "ARMANDO_CARRITO",
    "COTIZADO",
    "COTIZACION_EMITIDA",
    "PAGO_ENVIADO",
]

# Orden de "qué tan avanzado" llegó un carrito; se usa para resumir el
# episodio y para decidir el `stage` global cuando hay varios carritos.
_STAGE_RANK: dict[str, int] = {
    "ARMANDO_CARRITO": 1,
    "COTIZADO": 2,
    "COTIZACION_EMITIDA": 3,
    "PAGO_ENVIADO": 4,
}


class CartLine(TypedDict):
    variantId: str
    sku: str
    title: str
    quantity: str
    unitPrice: NotRequired[str | None]


class CartRecord(TypedDict, total=False):
    """Un pedido/cotización independiente dentro de la conversación."""

    cartId: str
    lines: list[CartLine]
    lastTotals: dict[str, Any] | None
    deliveryMode: str | None
    quoteId: str | None
    quoteLink: str | None
    quoteSignature: str | None
    orderId: str | None
    checkoutLink: str | None
    stage: CartStage


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


def _merge_lines(left: list[CartLine] | None, right: list[CartLine] | None) -> list[CartLine]:
    """Une líneas de UN carrito por `variantId`; cantidad "0" borra la línea.

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


def _merge_cart_record(left: CartRecord | None, right: CartRecord) -> CartRecord:
    """Funde el delta de UN carrito sobre su registro previo.

    `lines` usa la unión de deltas de `_merge_lines`; el resto de los campos
    ("último valor gana") solo se sobreescribe si el delta trae la llave —
    así una tool que solo actualiza `lastTotals` no borra `quoteId`.
    """
    merged: CartRecord = dict(left or {})  # type: ignore[assignment]
    if "lines" in right:
        merged["lines"] = _merge_lines(merged.get("lines"), right.get("lines"))
    for key, value in right.items():
        if key == "lines":
            continue
        merged[key] = value  # type: ignore[literal-required]
    return merged


def _merge_carts(
    left: dict[str, CartRecord] | None, right: dict[str, CartRecord] | None
) -> dict[str, CartRecord]:
    """Funde deltas de varios carritos a la vez (varias tools en un turno,
    cada una sobre SU carrito, se ejecutan contra el mismo snapshot y se
    funden aquí — mismo motivo que `_merge_lines`)."""
    merged: dict[str, CartRecord] = {cart_id: dict(record) for cart_id, record in (left or {}).items()}  # type: ignore[misc]
    for cart_id, delta in (right or {}).items():
        merged[cart_id] = _merge_cart_record(merged.get(cart_id), delta)
    return merged


def _last(left: Any, right: Any) -> Any:
    return right if right is not None else left


def _replace(_left: Any, right: Any) -> Any:
    """A diferencia de `_last`, un `None` explícito SÍ limpia el campo.

    Se usa para `pending_attachment`: el adjunto de este turno no debe
    reaparecer en el siguiente si nadie generó uno nuevo.
    """
    return right


class SalesState(DeepAgentState):
    """DeepAgentState (messages + todos + filesystem) más la memoria comercial."""

    customer: Annotated[CustomerFacts, _merge_customer]
    carts: Annotated[dict[str, CartRecord], _merge_carts]
    # Último carrito que tocó una herramienta: a qué carrito resuelven las
    # tools cuando el modelo no pasa `carritoId` explícito (ver tools.py).
    active_cart_id: Annotated[str | None, _last]
    # Dirección de entrega del cliente para ESTE hilo: la guarda
    # `recordar_direccion_entrega` (T-SHIP-04) y la usa `calcular_total`
    # automáticamente al cotizar `LOCAL_DELIVERY`. Vacío = el cliente aún no
    # dio CP / ciudad / estado; el bot lo pide antes de cotizar.
    delivery_address: Annotated[dict[str, Any] | None, _replace]
    # Adjunto (PDF) de ESTE turno; `main.py` lo limpia después de mandarlo.
    pending_attachment: Annotated[dict[str, Any] | None, _replace]
    handoff: Annotated[bool, _last]
    handoff_reason: Annotated[str | None, _last]
    # Fallos técnicos seguidos en este hilo (timeout, proveedor caído). Lo
    # lleva `pipeline/failures.py`: un fallo aislado contesta suave y sigue;
    # varios seguidos sí pasan a handoff. Un turno que sale bien lo regresa
    # a 0.
    failure_streak: Annotated[int, _last]
    # Estado grueso de la conversación (no de un carrito en particular):
    # HUMANO/CERRADO, o el del carrito más avanzado mientras no haya handoff.
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
    # Bloque `<memoria_cliente>` ya renderizado para ESTE número: lo resuelve
    # el pipeline una vez por turno (`memory/profile.py`) y lo lee
    # `agent.sales_prompt`, que corre en cada llamada al modelo.
    customer_memory: str


def cart_summary(lines: list[CartLine] | None) -> str:
    if not lines:
        return "vacío"
    return "; ".join(
        f"{line['quantity']} x {line.get('title') or line['variantId']} ({line.get('sku', '')})"
        for line in lines
    )


def open_carts(carts: dict[str, CartRecord] | None) -> dict[str, CartRecord]:
    """Carritos con algo que mostrar: con líneas o con una cotización ya
    emitida. Filtra los registros fantasma (creados y nunca usados)."""
    return {
        cart_id: record
        for cart_id, record in (carts or {}).items()
        if record.get("lines") or record.get("quoteId")
    }


def primary_cart(values: dict[str, Any]) -> tuple[str, CartRecord]:
    """El carrito que llenan los campos singulares de compatibilidad de la
    API (`cart`, `totals`, `quote`, `checkout`): el activo si tiene algo que
    mostrar, si no el más avanzado, si no vacío."""
    carts: dict[str, CartRecord] = values.get("carts") or {}
    active = values.get("active_cart_id")
    visible = open_carts(carts)
    if active and active in visible:
        return active, visible[active]
    if visible:
        cart_id = max(
            visible,
            key=lambda cid: len(visible[cid].get("lines") or []) + bool(visible[cid].get("quoteId")),
        )
        return cart_id, visible[cart_id]
    return "", {}


def overall_stage(carts: dict[str, CartRecord] | None) -> str:
    """El `stage` grueso de la conversación: el del carrito más avanzado."""
    visible = open_carts(carts)
    if not visible:
        return "DESCUBRIMIENTO"
    best = max(visible.values(), key=lambda r: _STAGE_RANK.get(str(r.get("stage")), 0))
    return str(best.get("stage") or "ARMANDO_CARRITO")


def _cart_line_text(cart_id: str, record: CartRecord) -> str:
    parts = [f"[{cart_id}] carrito: {cart_summary(record.get('lines'))}"]
    totals = record.get("lastTotals") or {}
    if totals:
        body = totals.get("totals", totals)
        parts.append(f"total ${body.get('total')}")
    if record.get("quoteId"):
        parts.append(f"cotización {record['quoteId']} ({record.get('quoteLink') or 'sin enlace'})")
    if record.get("orderId"):
        parts.append(f"pedido {record['orderId']}")
    if record.get("checkoutLink"):
        parts.append(f"pago enviado: {record['checkoutLink']}")
    return " — ".join(parts)


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

    visible = open_carts(state.get("carts"))
    active_id = state.get("active_cart_id")
    if not visible:
        lines.append("Carritos abiertos: ninguno todavía.")
    elif len(visible) == 1:
        # Caso normal (un solo pedido): sin ceremonia de IDs.
        cart_id, record = next(iter(visible.items()))
        lines.append(_cart_line_text(cart_id, record))
    else:
        lines.append(
            f"Carritos abiertos a la vez ({len(visible)}) — son pedidos DISTINTOS, no los "
            "mezcles; usa el identificador entre [corchetes] cuando el cliente se refiera a "
            "uno de ellos ('el de las playeras', 'la primera cotización')."
        )
        for cart_id, record in visible.items():
            marker = " ← el que se tocó más recientemente" if cart_id == active_id else ""
            lines.append("  " + _cart_line_text(cart_id, record) + marker)

    return "\n".join(lines)
