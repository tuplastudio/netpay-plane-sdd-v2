"""Herramientas comerciales del agente v2 (LangChain tools).

Reglas que se mantienen del v1 y no se negocian:
  - El tenant y los scopes vienen del contexto de la invocación, nunca del
    texto del cliente ni del modelo.
  - El modelo no arma URLs ni importes: los recibe del backend.
  - Cada herramienta que muta devuelve un `Command` que actualiza el estado,
    así el "hilo" (carrito, cotización, pedido) queda en el checkpoint y no
    depende de que el modelo lo recuerde.
"""

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from langchain.tools import ToolRuntime, tool
from langgraph.types import Command
from langchain_core.messages import ToolMessage

from .commerce import CommerceClient, CommerceError, CommerceUnavailable
from .state import CartLine, CustomerFacts, TurnContext

_TOOL_SCOPES: dict[str, str] = {
    "buscar_productos": "catalog.read",
    "agregar_al_carrito": "catalog.read",
    "quitar_del_carrito": "catalog.read",
    "calcular_total": "quotes.read",
    "emitir_cotizacion": "quotes.write",
    "convertir_en_pedido": "orders.write",
    "generar_enlace_pago": "orders.write",
    "estado_del_pedido": "orders.read",
    "recordar_cliente": "chat.write",
    "historial_del_cliente": "customers.read",
    "detalle_de_cotizacion": "quotes.read",
    "escalar_a_humano": "chat.write",
}


def format_quantity(value: Any) -> str:
    """commerce-api exige la cantidad como 'NN.NNN' (quote.dto.ts QUANTITY_RE)."""
    try:
        quantity = Decimal(str(value).replace(",", "."))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"Cantidad inválida: {value!r}") from exc
    if quantity <= 0:
        raise ValueError("La cantidad debe ser mayor que cero")
    return str(quantity.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))


def _ctx(runtime: ToolRuntime) -> TurnContext:
    return dict(runtime.context or {})  # type: ignore[arg-type,return-value]


def _require_scope(runtime: ToolRuntime, tool_name: str):
    needed = _TOOL_SCOPES.get(tool_name)
    if not needed:
        return None
    scopes = set(_ctx(runtime).get("scopes") or [])
    if needed in scopes:
        return None
    return f"Sin permiso: esta operación requiere el scope {needed}."


def _client() -> CommerceClient:
    return CommerceClient()


def _fail(message: str) -> str:
    return f"ERROR: {message}"


async def _safe(coro):
    """Los errores del backend vuelven como texto para que el modelo reaccione,
    en vez de tumbar el turno."""
    try:
        return await coro, None
    except CommerceUnavailable as exc:
        return None, f"la API comercial no está disponible ({exc})"
    except CommerceError as exc:
        return None, f"{exc.code}: {exc.message}"
    except (ValueError, KeyError, TypeError) as exc:
        return None, str(exc)


# ---------------------------------------------------------------- catálogo


@tool
async def buscar_productos(consulta: str, runtime: ToolRuntime) -> str:
    """Busca productos en el catálogo real del negocio.

    Devuelve variantes con su variantId, SKU, título, precio de lista y
    existencia. Úsala antes de cotizar cualquier cosa: los variantId de aquí
    son los únicos válidos.
    """
    if denied := _require_scope(runtime, "buscar_productos"):
        return _fail(denied)
    variants, error = await _safe(_client().search_products(None, limit=100))
    if error:
        return _fail(error)

    needle = (consulta or "").lower().strip()
    words = [w for w in needle.split() if len(w) > 2]

    def score(v: dict[str, Any]) -> float:
        haystack = f"{v['productTitle']} {v['title']} {v['sku']}".lower()
        if needle and needle in haystack:
            return 100.0
        return float(sum(1 for w in words if w in haystack))

    ranked = sorted(variants or [], key=score, reverse=True)
    hits = [v for v in ranked if score(v) > 0][:8] or ranked[:8]
    if not hits:
        return "Sin resultados en el catálogo para esa búsqueda."

    lines = [
        f"{v['variantId']} | {v['sku']} | {v['productTitle']} — {v['title']} | "
        f"${v['price']} | existencia: "
        + ("sin control" if v["stock"] is None else str(int(v["stock"])))
        for v in hits
    ]
    return "Resultados (variantId | SKU | producto | precio | existencia):\n" + "\n".join(lines)


@tool
async def agregar_al_carrito(
    variantId: str,
    cantidad: str,
    runtime: ToolRuntime,
) -> Command:
    """Agrega o actualiza una línea del carrito de esta conversación.

    Usa el variantId exacto que devolvió buscar_productos. Si la variante ya
    estaba en el carrito, se reemplaza su cantidad.
    """
    if denied := _require_scope(runtime, "agregar_al_carrito"):
        return _tool_reply(runtime, _fail(denied))

    try:
        quantity = format_quantity(cantidad)
    except ValueError as exc:
        return _tool_reply(runtime, _fail(str(exc)))

    variants, error = await _safe(_client().search_products(None, limit=100))
    if error:
        return _tool_reply(runtime, _fail(error))
    variant = next((v for v in (variants or []) if v["variantId"] == variantId), None)
    if variant is None:
        return _tool_reply(
            runtime,
            _fail(
                f"El variantId '{variantId}' no existe. Llama a buscar_productos y usa "
                "uno de los variantId que te devuelva. Esto NO significa que esté agotado."
            ),
        )

    cart: list[CartLine] = list(runtime.state.get("cart") or [])
    line: CartLine = {
        "variantId": variantId,
        "sku": variant["sku"],
        "title": variant["title"],
        "quantity": quantity,
        "unitPrice": variant["price"],
    }
    cart = [c for c in cart if c["variantId"] != variantId] + [line]
    detail = "; ".join(f"{c['quantity']} x {c['title']}" for c in cart)
    return _tool_reply(
        runtime,
        f"Carrito actualizado: {detail}",
        update={"cart": cart, "stage": "ARMANDO_CARRITO"},
    )


@tool
async def quitar_del_carrito(variantId: str, runtime: ToolRuntime) -> Command:
    """Quita una línea del carrito por variantId."""
    cart: list[CartLine] = list(runtime.state.get("cart") or [])
    remaining = [c for c in cart if c["variantId"] != variantId]
    if len(remaining) == len(cart):
        return _tool_reply(runtime, "Esa variante no estaba en el carrito.")
    detail = "; ".join(f"{c['quantity']} x {c['title']}" for c in remaining) or "vacío"
    return _tool_reply(runtime, f"Listo. Carrito: {detail}", update={"cart": remaining})


# ---------------------------------------------------------------- precios


def _cart_signature(cart: list[CartLine]) -> str:
    """Huella del carrito: sirve para no reemitir la misma cotización."""
    return "|".join(sorted(f"{c['variantId']}:{c['quantity']}" for c in cart))


def _lines_payload(cart: list[CartLine]) -> list[dict[str, Any]]:
    return [{"variantId": c["variantId"], "quantity": format_quantity(c["quantity"])} for c in cart]


@tool
async def calcular_total(runtime: ToolRuntime, deliveryMode: str = "PICKUP") -> Command:
    """Calcula el total exacto del carrito con impuestos y envío.

    Es la ÚNICA fuente de importes: nunca sumes tú. No crea la cotización.
    """
    if denied := _require_scope(runtime, "calcular_total"):
        return _tool_reply(runtime, _fail(denied))
    cart: list[CartLine] = list(runtime.state.get("cart") or [])
    if not cart:
        return _tool_reply(runtime, _fail("El carrito está vacío: agrega productos primero."))

    totals, error = await _safe(
        _client().price_preview(_lines_payload(cart), delivery_mode=deliveryMode)
    )
    if error:
        return _tool_reply(runtime, _fail(error))

    body = (totals or {}).get("totals", totals or {})
    detail = "; ".join(f"{c['quantity']} x {c['title']}" for c in cart)
    text = (
        f"Total para {detail}: subtotal ${body.get('subtotal')}, IVA ${body.get('tax')}, "
        f"envío ${body.get('shipping')} → TOTAL ${body.get('total')}"
    )
    return _tool_reply(runtime, text, update={"last_totals": totals, "stage": "COTIZADO"})


# ---------------------------------------------------------------- cotización


@tool
async def emitir_cotizacion(runtime: ToolRuntime, notas: str = "") -> Command:
    """Crea y emite la cotización con el carrito actual, y devuelve su enlace.

    Requiere confirmación explícita del cliente en el mensaje actual. Usa el
    nombre y correo que ya tengas en memoria; no los vuelvas a pedir si ya
    están.
    """
    if denied := _require_scope(runtime, "emitir_cotizacion"):
        return _tool_reply(runtime, _fail(denied))
    cart: list[CartLine] = list(runtime.state.get("cart") or [])
    if not cart:
        return _tool_reply(runtime, _fail("No hay carrito que cotizar."))

    # Reemitir la misma cotización crea folios duplicados y confunde al
    # cliente: si ya hay una para este mismo carrito, se reutiliza.
    if runtime.state.get("quote_id") and runtime.state.get("quote_signature") == _cart_signature(cart):
        return _tool_reply(
            runtime,
            f"Ya existe la cotización {runtime.state['quote_id']} para este carrito: "
            f"{runtime.state.get('quote_link')}. Compártela en vez de emitir otra. "
            "Si el cliente quiere pagar, usa convertir_en_pedido.",
        )

    ctx = _ctx(runtime)
    customer: CustomerFacts = dict(runtime.state.get("customer") or {})
    client = _client()

    created, error = await _safe(
        client.ensure_customer(
            full_name=customer.get("name") or ctx.get("customer_name") or "Cliente de WhatsApp",
            phone=customer.get("phone") or ctx.get("customer_phone"),
            email=customer.get("email") or ctx.get("customer_email"),
        )
    )
    if error:
        return _tool_reply(runtime, _fail(error))

    quote, error = await _safe(
        client.create_quote(
            customer_id=created["id"],
            lines=_lines_payload(cart),
            notes=notas or None,
            issue=True,
        )
    )
    if error:
        return _tool_reply(runtime, _fail(error))

    share, share_error = await _safe(client.share_quote(quote["id"]))
    link = (share or {}).get("url") if not share_error else None

    return _tool_reply(
        runtime,
        f"Cotización {quote['id']} emitida por ${quote.get('total')}. "
        f"Enlace para verla: {link or 'no disponible'}",
        update={
            "quote_id": quote["id"],
            "quote_link": link,
            "quote_signature": _cart_signature(cart),
            "customer": {**customer, "customerId": created["id"]},
            "stage": "COTIZACION_EMITIDA",
        },
    )


@tool
async def detalle_de_cotizacion(quoteId: str, runtime: ToolRuntime) -> str:
    """Líneas, estado, total y vigencia de una cotización por folio."""
    if denied := _require_scope(runtime, "detalle_de_cotizacion"):
        return _fail(denied)
    quote, error = await _safe(_client().get_quote(quoteId))
    if error:
        return _fail(error)
    lines = "; ".join(
        f"{l.get('quantity')} x {l.get('title')} (${l.get('unitPrice')})"
        for l in (quote or {}).get("lines", [])
    )
    return (
        f"Cotización {quote.get('id')}: estado {quote.get('status')}, total ${quote.get('total')}, "
        f"vence {quote.get('expiresAt')}. Líneas: {lines or 'sin líneas'}"
    )


# ---------------------------------------------------------------- pedido y pago


@tool
async def convertir_en_pedido(runtime: ToolRuntime) -> Command:
    """Convierte la cotización vigente en pedido. Solo con confirmación explícita."""
    if denied := _require_scope(runtime, "convertir_en_pedido"):
        return _tool_reply(runtime, _fail(denied))
    quote_id = runtime.state.get("quote_id")
    if not quote_id:
        return _tool_reply(runtime, _fail("No hay cotización emitida; emítela primero."))

    order, error = await _safe(_client().order_from_quote(quote_id))
    if error:
        return _tool_reply(runtime, _fail(error))
    return _tool_reply(
        runtime,
        f"Pedido {order['id']} creado (estado {order.get('status')}, total ${order.get('total')}).",
        update={"order_id": order["id"]},
    )


@tool
async def generar_enlace_pago(runtime: ToolRuntime, deliveryMode: str = "PICKUP") -> Command:
    """Genera el enlace de pago del pedido vigente. El backend arma la URL."""
    if denied := _require_scope(runtime, "generar_enlace_pago"):
        return _tool_reply(runtime, _fail(denied))
    order_id = runtime.state.get("order_id")
    if not order_id:
        return _tool_reply(
            runtime, _fail("No hay pedido: usa convertir_en_pedido antes de cobrar.")
        )
    cart: list[CartLine] = list(runtime.state.get("cart") or [])
    if not cart:
        return _tool_reply(runtime, _fail("El carrito está vacío; no sé qué cobrar."))

    checkout, error = await _safe(
        _client().start_checkout(
            order_id, lines=_lines_payload(cart), delivery_mode=deliveryMode
        )
    )
    if error:
        return _tool_reply(runtime, _fail(error))
    link = (checkout or {}).get("checkoutUrl")
    if not link:
        return _tool_reply(runtime, _fail("El backend no devolvió enlace de pago."))
    return _tool_reply(
        runtime,
        f"Enlace de pago listo: {link}",
        update={"checkout_link": link, "stage": "PAGO_ENVIADO"},
    )


@tool
async def estado_del_pedido(runtime: ToolRuntime, orderId: str = "") -> str:
    """Estado real del pedido y de su pago.

    Úsala siempre que el cliente diga que ya pagó: no confíes en su palabra.
    """
    if denied := _require_scope(runtime, "estado_del_pedido"):
        return _fail(denied)
    target = orderId or runtime.state.get("order_id")
    if not target:
        return _fail("No tengo número de pedido; pídeselo al cliente.")
    order, error = await _safe(_client().get_order(target))
    if error:
        return _fail(error)
    return (
        f"Pedido {order.get('id')}: estado {order.get('status')}, total ${order.get('total')}, "
        f"pagado={'sí' if order.get('paidAt') else 'no'}."
    )


# ---------------------------------------------------------------- cliente


@tool
async def recordar_cliente(
    runtime: ToolRuntime,
    nombre: str = "",
    correo: str = "",
    telefono: str = "",
) -> Command:
    """Guarda el nombre, correo o teléfono que el cliente acaba de decir.

    Llámala en cuanto aparezca el dato. A partir de ahí no lo vuelvas a pedir.
    """
    facts: CustomerFacts = {}
    if nombre.strip():
        facts["name"] = nombre.strip()[:120]
    if correo.strip() and "@" in correo:
        facts["email"] = correo.strip()[:120]
    if telefono.strip():
        facts["phone"] = telefono.strip()[:40]
    if not facts:
        return _tool_reply(runtime, _fail("No recibí ningún dato válido que guardar."))
    return _tool_reply(
        runtime,
        "Guardado: " + ", ".join(f"{k}={v}" for k, v in facts.items()),
        update={"customer": facts},
    )


@tool
async def historial_del_cliente(runtime: ToolRuntime) -> str:
    """Cotizaciones y pedidos anteriores del cliente de esta conversación.

    Úsala cuando pregunte por "mi cotización", "lo que pedí la otra vez" o
    quiera repetir una compra.
    """
    if denied := _require_scope(runtime, "historial_del_cliente"):
        return _fail(denied)
    customer: CustomerFacts = dict(runtime.state.get("customer") or {})
    ctx = _ctx(runtime)
    needle = (
        customer.get("phone")
        or ctx.get("customer_phone")
        or customer.get("email")
        or customer.get("name")
    )
    if not needle:
        return "Todavía no sé quién es el cliente: pide su teléfono o correo."

    client = _client()
    found, error = await _safe(client.lookup_customer(needle))
    if error:
        return _fail(error)
    if not found:
        return "No hay cliente registrado con esos datos todavía."

    history, error = await _safe(client.customer_history(found["id"]))
    if error:
        return _fail(error)
    quotes = (history or {}).get("quotes", [])[:5]
    orders = (history or {}).get("orders", [])[:5]
    if not quotes and not orders:
        return f"{found.get('fullName')} no tiene cotizaciones ni pedidos previos."

    parts = [f"Cliente: {found.get('fullName')} ({found.get('email') or 'sin correo'})"]
    for q in quotes:
        parts.append(f"  cotización {str(q['id'])[:8]} — ${q['total']} — {q['status']} — {q['createdAt']}")
    for o in orders:
        parts.append(f"  pedido {str(o['id'])[:8]} — ${o['total']} — {o['status']} — {o['createdAt']}")
    return "\n".join(parts)


@tool
async def escalar_a_humano(motivo: str, resumen: str, runtime: ToolRuntime) -> Command:
    """Pasa la conversación a una persona del equipo.

    Motivos: CLIENTE_LO_PIDE, FUERA_DE_CONOCIMIENTO, QUEJA, PRECIO_ESPECIAL,
    CREDITO, ERROR_TECNICO.
    """
    return _tool_reply(
        runtime,
        "Conversación marcada para que la tome una persona del equipo.",
        update={"handoff": True, "handoff_reason": motivo, "stage": "HUMANO"},
    )


# ---------------------------------------------------------------- utilidades


def _tool_reply(runtime: ToolRuntime, text: str, *, update=None) -> Command:
    """Respuesta de herramienta + actualización de estado en un solo Command."""
    payload: dict[str, Any] = {
        "messages": [ToolMessage(content=text, tool_call_id=runtime.tool_call_id)]
    }
    if update:
        payload.update(update)
    return Command(update=payload)


SALES_TOOLS = [
    buscar_productos,
    agregar_al_carrito,
    quitar_del_carrito,
    calcular_total,
    emitir_cotizacion,
    detalle_de_cotizacion,
    convertir_en_pedido,
    generar_enlace_pago,
    estado_del_pedido,
    recordar_cliente,
    historial_del_cliente,
    escalar_a_humano,
]
