"""Herramientas comerciales del agente v2 (LangChain tools).

Reglas que se mantienen del v1 y no se negocian:
  - El tenant y los scopes vienen del contexto de la invocación, nunca del
    texto del cliente ni del modelo.
  - El modelo no arma URLs ni importes: los recibe del backend.
  - Cada herramienta que muta devuelve un `Command` que actualiza el estado,
    así el "hilo" (carrito, cotización, pedido) queda en el checkpoint y no
    depende de que el modelo lo recuerde.

Varios carritos a la vez
-------------------------
Todas las tools de carrito/cotización/pedido reciben `carritoId` opcional.
Vacío (el caso normal, un solo pedido) resuelve al carrito ACTIVO —el último
que tocó una herramienta— así que una conversación de un solo pedido nunca
necesita pasar IDs. Cuando el cliente lleva más de un pedido a la vez, el
modelo ve todos en `<memoria_conversacion>` (ver `state.working_memory_block`)
con su `[carritoId]` y puede pasarlo explícito para operar sobre uno sin
tocar los demás.
"""

import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from langchain.tools import ToolRuntime, tool
from langgraph.types import Command
from langchain_core.messages import ToolMessage

from .commerce import CommerceClient, CommerceError, CommerceUnavailable
from .config import get_settings
from .security import clamp_text, require_scope, sanitize_error_message
from .state import CartLine, CartRecord, CustomerFacts, TurnContext, open_carts

DEFAULT_CART_ID = "1"
_CART_ID_INVALID_RE = re.compile(r"[^a-z0-9-]+")


def format_quantity(value: Any) -> str:
    """commerce-api exige la cantidad como 'NN.NNN' (quote.dto.ts QUANTITY_RE)."""
    try:
        quantity = Decimal(str(value).replace(",", "."))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"Cantidad inválida: {value!r}") from exc
    if quantity <= 0:
        raise ValueError("La cantidad debe ser mayor que cero")
    max_quantity = get_settings().max_quantity
    if quantity > max_quantity:
        raise ValueError(f"La cantidad máxima por línea es {max_quantity}")
    return str(quantity.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))


def _ctx(runtime: ToolRuntime) -> TurnContext:
    return dict(runtime.context or {})  # type: ignore[arg-type,return-value]


def _require_scope(runtime: ToolRuntime, tool_name: str):
    """El tenant y los scopes SIEMPRE vienen de `runtime.context` (armado en
    main.py desde la request HTTP autenticada), nunca de un argumento de la
    tool ni de algo que el modelo decida: así el cliente no puede alterarlos
    metiéndolos en el texto del chat."""
    return require_scope(_ctx(runtime).get("scopes"), tool_name)


def _client(runtime: ToolRuntime) -> CommerceClient:
    return CommerceClient(tenant_id=_ctx(runtime).get("tenant_id", ""))


def _fail(message: str) -> str:
    return f"ERROR: {message}"


async def _safe(coro):
    """Los errores del backend vuelven como texto para que el modelo reaccione,
    en vez de tumbar el turno. Se sanean antes de exponerse: un error de
    conexión o de negocio no debe filtrar URLs internas, ids ajenos ni
    credenciales (ver security.sanitize_error_message)."""
    try:
        return await coro, None
    except CommerceUnavailable:
        return None, "la API comercial no está disponible en este momento"
    except CommerceError as exc:
        return None, sanitize_error_message(f"{exc.code}: {exc.message}")
    except (ValueError, KeyError, TypeError) as exc:
        return None, sanitize_error_message(str(exc))


# ---------------------------------------------------------------- carritos


def _sanitize_cart_id(value: str) -> str:
    text = clamp_text(value, 40, collapse_newlines=True).strip().lower().replace(" ", "-")
    return _CART_ID_INVALID_RE.sub("", text)[:40]


def _resolve_cart_id(runtime: ToolRuntime, carrito_id: str) -> str:
    """A qué carrito resuelve `carritoId=""`: el activo, o el único que haya
    abierto, o `DEFAULT_CART_ID` para el primer carrito de la conversación.
    Un `carritoId` explícito siempre gana (aunque el carrito aún no exista:
    eso es "abrir un carrito nuevo con ese nombre")."""
    explicit = _sanitize_cart_id(carrito_id)
    if explicit:
        return explicit
    carts: dict[str, CartRecord] = runtime.state.get("carts") or {}
    active = runtime.state.get("active_cart_id")
    if active and active in carts:
        return active
    visible = open_carts(carts)
    if len(visible) == 1:
        return next(iter(visible))
    return DEFAULT_CART_ID


def _cart_record(runtime: ToolRuntime, cart_id: str) -> CartRecord:
    carts: dict[str, CartRecord] = runtime.state.get("carts") or {}
    return dict(carts.get(cart_id) or {})  # type: ignore[return-value]


def _cart_ref(cart_id: str, total_open: int) -> str:
    """Sufijo para las respuestas de tool: solo nombra el carrito si hay más
    de uno abierto — en el caso normal (un pedido) no hace falta el ruido."""
    return f" [carrito {cart_id}]" if total_open > 1 else ""


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
    # `consulta` es texto libre del cliente: se acota y se limpia antes de
    # usarlo, aunque aquí solo se compare en memoria (nunca se manda tal
    # cual al backend ni al modelo).
    consulta = clamp_text(consulta, get_settings().max_tool_arg_chars, collapse_newlines=True)
    variants, error = await _safe(_client(runtime).search_products(None, limit=100))
    if error:
        return _fail(error)

    needle = consulta.lower()
    words = [w for w in needle.split() if len(w) > 2]

    def score(v: dict[str, Any]) -> float:
        tags = v.get("tags") or []
        synonyms = v.get("synonyms") or []
        haystack = (
            f"{v['productTitle']} {v['title']} {v['sku']} "
            f"{' '.join(tags)} {' '.join(synonyms)}"
        ).lower()
        # Sinónimo curado a mano (ej. "cubeta grande" -> AGLOSTONE 19L): pesa
        # más que un match de título porque alguien lo declaró a propósito
        # para que el bot lo encuentre.
        for synonym in synonyms:
            s = synonym.lower().strip()
            if s and (s == needle or s in needle or needle in s):
                return 150.0
        if needle and needle in haystack:
            return 100.0
        return float(sum(1 for w in words if w in haystack))

    ranked = sorted(variants or [], key=score, reverse=True)
    hits = [v for v in ranked if score(v) > 0][:8] or ranked[:8]
    if not hits:
        return "Sin resultados en el catálogo para esa búsqueda."

    # El título/SKU vienen del catálogo del negocio, no del cliente, pero
    # igual pueden traer texto que intente pasar por instrucción (producto
    # cargado con un título hostil): se limpia de Unicode invisible y de
    # saltos de línea antes de que el modelo lo lea como parte del turno.
    def clean(field: str) -> str:
        return clamp_text(field, 200, collapse_newlines=True)

    lines = [
        f"{v['variantId']} | {clean(v['sku'])} | {clean(v['productTitle'])} — {clean(v['title'])} | "
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
    carritoId: str = "",
) -> Command:
    """Agrega o actualiza una línea de UN carrito de esta conversación.

    Usa el variantId exacto que devolvió buscar_productos. Si la variante ya
    estaba en ese carrito, se reemplaza su cantidad.

    `carritoId`: déjalo vacío para seguir con el pedido en el que ya estás
    trabajando (el caso normal). Solo pásalo si el cliente está armando MÁS
    de un pedido a la vez y esto es claramente uno distinto del que ya tienes
    abierto — inventa un id corto y descriptivo (ej. "playeras", "regalo") y
    reutilízalo el resto de la conversación para ese mismo pedido. No abras
    un carrito nuevo solo porque el cliente agrega otro producto al MISMO
    pedido.
    """
    if denied := _require_scope(runtime, "agregar_al_carrito"):
        return _tool_reply(runtime, _fail(denied))

    try:
        quantity = format_quantity(cantidad)
    except ValueError as exc:
        return _tool_reply(runtime, _fail(str(exc)))

    variants, error = await _safe(_client(runtime).search_products(None, limit=100))
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

    cart_id = _resolve_cart_id(runtime, carritoId)
    record = _cart_record(runtime, cart_id)
    lines: list[CartLine] = list(record.get("lines") or [])
    is_new_line = not any(c["variantId"] == variantId for c in lines)
    max_lines = get_settings().max_cart_lines
    if is_new_line and len(lines) >= max_lines:
        return _tool_reply(
            runtime,
            _fail(
                f"El carrito ya tiene el máximo de {max_lines} productos distintos; "
                "cotiza esto primero o quita alguno antes de agregar otro."
            ),
        )

    line: CartLine = {
        "variantId": variantId,
        "sku": clamp_text(variant["sku"], 200, collapse_newlines=True),
        "title": clamp_text(variant["title"], 200, collapse_newlines=True),
        "quantity": quantity,
        "unitPrice": variant["price"],
    }
    # Cuántos carritos quedarán abiertos DESPUÉS de este agregado (este
    # carrito cuenta aunque todavía esté vacío, porque ya va a tener línea).
    existing_open = open_carts(runtime.state.get("carts"))
    total_open_after = len(set(existing_open) | {cart_id})
    # Solo la línea propia, no el carrito entero: las tool calls de un mismo
    # mensaje del modelo se ejecutan todas contra el mismo snapshot, así que
    # devolver el carrito completo borra lo que agregaron las otras. El
    # reducer `_merge_carts` en state.py hace la unión, por carrito.
    return _tool_reply(
        runtime,
        f"Agregado al carrito: {quantity} x {line['title']} (${variant['price']} c/u)"
        + _cart_ref(cart_id, total_open_after),
        update={
            "carts": {cart_id: {"cartId": cart_id, "lines": [line], "stage": "ARMANDO_CARRITO"}},
            "active_cart_id": cart_id,
        },
    )


@tool
async def quitar_del_carrito(variantId: str, runtime: ToolRuntime, carritoId: str = "") -> Command:
    """Quita una línea de UN carrito por variantId.

    `carritoId` vacío = el carrito activo (ver agregar_al_carrito).
    """
    if denied := _require_scope(runtime, "quitar_del_carrito"):
        return _tool_reply(runtime, _fail(denied))
    cart_id = _resolve_cart_id(runtime, carritoId)
    record = _cart_record(runtime, cart_id)
    lines: list[CartLine] = list(record.get("lines") or [])
    target = next((c for c in lines if c["variantId"] == variantId), None)
    if target is None:
        return _tool_reply(runtime, "Esa variante no estaba en ese carrito.")
    total_open = len(open_carts(runtime.state.get("carts")))
    # Cantidad "0" es la lápida que `_merge_lines` interpreta como borrado.
    return _tool_reply(
        runtime,
        f"Quitado del carrito: {target['title']}" + _cart_ref(cart_id, total_open),
        update={"carts": {cart_id: {"lines": [{**target, "quantity": "0"}]}}, "active_cart_id": cart_id},
    )


# ---------------------------------------------------------------- precios


def _cart_signature(lines: list[CartLine]) -> str:
    """Huella de un carrito: sirve para no reemitir la misma cotización."""
    return "|".join(sorted(f"{c['variantId']}:{c['quantity']}" for c in lines))


def _lines_payload(lines: list[CartLine]) -> list[dict[str, Any]]:
    return [{"variantId": c["variantId"], "quantity": format_quantity(c["quantity"])} for c in lines]


@tool
async def calcular_total(runtime: ToolRuntime, deliveryMode: str = "PICKUP", carritoId: str = "") -> Command:
    """Calcula el total exacto de UN carrito con impuestos y envío.

    Es la ÚNICA fuente de importes: nunca sumes tú. No crea la cotización.
    `carritoId` vacío = el carrito activo (ver agregar_al_carrito). Si el
    cliente lleva dos pedidos y pregunta "¿y el total de las playeras?",
    pasa ese carritoId explícito para no calcular el equivocado.
    """
    if denied := _require_scope(runtime, "calcular_total"):
        return _tool_reply(runtime, _fail(denied))
    cart_id = _resolve_cart_id(runtime, carritoId)
    record = _cart_record(runtime, cart_id)
    lines: list[CartLine] = list(record.get("lines") or [])
    if not lines:
        return _tool_reply(runtime, _fail("Ese carrito está vacío: agrega productos primero."))

    totals, error = await _safe(
        _client(runtime).price_preview(_lines_payload(lines), delivery_mode=deliveryMode)
    )
    if error:
        return _tool_reply(runtime, _fail(error))

    body = (totals or {}).get("totals", totals or {})
    detail = "; ".join(f"{c['quantity']} x {c['title']}" for c in lines)
    total_open = len(open_carts(runtime.state.get("carts"))) or 1
    text = (
        f"Total para {detail}: subtotal ${body.get('subtotal')}, IVA ${body.get('tax')}, "
        f"envío ${body.get('shipping')} → TOTAL ${body.get('total')}" + _cart_ref(cart_id, total_open)
    )
    return _tool_reply(
        runtime,
        text,
        update={"carts": {cart_id: {"lastTotals": totals, "stage": "COTIZADO"}}, "active_cart_id": cart_id},
    )


# ---------------------------------------------------------------- cotización


@tool
async def emitir_cotizacion(runtime: ToolRuntime, notas: str = "", carritoId: str = "") -> Command:
    """Crea y emite la cotización de UN carrito, y devuelve su enlace.

    Requiere confirmación explícita del cliente en el mensaje actual. Usa el
    nombre y correo que ya tengas en memoria; no los vuelvas a pedir si ya
    están. `carritoId` vacío = el carrito activo; pásalo explícito si el
    cliente confirma UNO de varios pedidos abiertos ("sí, la de las
    playeras") para no cotizar el que no tocaba. Cada carrito tiene su
    propia cotización: emitir la de uno nunca afecta a los demás.
    """
    if denied := _require_scope(runtime, "emitir_cotizacion"):
        return _tool_reply(runtime, _fail(denied))
    notas = clamp_text(notas, get_settings().max_tool_arg_chars)
    cart_id = _resolve_cart_id(runtime, carritoId)
    record = _cart_record(runtime, cart_id)
    lines: list[CartLine] = list(record.get("lines") or [])
    if not lines:
        return _tool_reply(runtime, _fail("No hay carrito que cotizar."))
    total_open = len(open_carts(runtime.state.get("carts"))) or 1
    ref = _cart_ref(cart_id, total_open)

    # Reemitir la misma cotización crea folios duplicados y confunde al
    # cliente: si ESTE carrito ya tiene una para las mismas líneas, se reutiliza.
    if record.get("quoteId") and record.get("quoteSignature") == _cart_signature(lines):
        return _tool_reply(
            runtime,
            f"Ya existe la cotización {record['quoteId']} para este carrito: "
            f"{record.get('quoteLink')}. Compártela en vez de emitir otra. "
            f"Si el cliente quiere pagar, usa convertir_en_pedido.{ref}",
        )

    ctx = _ctx(runtime)
    customer: CustomerFacts = dict(runtime.state.get("customer") or {})
    client = _client(runtime)

    # T-CRM-01: toda cotización necesita el nombre real del cliente para que
    # la base de clientes quede completa. No es negociable por configuración
    # de tenant: sin nombre, la herramienta se niega y pide al modelo que lo
    # consiga en el mensaje anterior de preguntar, en vez de emitir con el
    # placeholder "Cliente de WhatsApp" (eso es lo que dejaba la BD incompleta).
    full_name = (customer.get("name") or ctx.get("customer_name") or "").strip()
    if not full_name:
        return _tool_reply(
            runtime,
            _fail(
                "Aún no tienes el nombre del cliente. Pídeselo primero (¿A nombre de "
                "quién genero la cotización?) y vuelve a llamar a esta herramienta "
                "cuando lo tengas; no emitas la cotización sin él."
            ),
        )

    created, error = await _safe(
        client.ensure_customer(
            full_name=full_name,
            phone=customer.get("phone") or ctx.get("customer_phone"),
            email=customer.get("email") or ctx.get("customer_email"),
            conversation_id=ctx.get("conversation_id"),
        )
    )
    if error:
        return _tool_reply(runtime, _fail(error))

    quote, error = await _safe(
        client.create_quote(
            customer_id=created["id"],
            lines=_lines_payload(lines),
            notes=notas or None,
            issue=True,
        )
    )
    if error:
        return _tool_reply(runtime, _fail(error))

    share, share_error = await _safe(client.share_quote(quote["id"]))
    link = (share or {}).get("url") if not share_error else None

    # El negocio quiere que la cotización, el enlace de pago y el PDF salgan
    # juntos en el mismo mensaje: no esperar un "sí" aparte para cobrar. Cada
    # paso es best-effort y no tumba a los demás: si el pago o el PDF fallan,
    # la cotización ya emitida se comparte igual.
    order, order_error = await _safe(client.order_from_quote(quote["id"]))
    checkout_link: str | None = None
    if not order_error and order:
        checkout, checkout_error = await _safe(
            client.start_checkout(order["id"], lines=_lines_payload(lines), delivery_mode="PICKUP")
        )
        if not checkout_error and checkout:
            checkout_link = checkout.get("checkoutUrl")

    pdf_b64, pdf_error = await _safe(client.get_quote_pdf_base64(quote["id"]))
    attachment = (
        {
            "filename": f"cotizacion-{quote['id']}.pdf",
            "mimetype": "application/pdf",
            "base64": pdf_b64,
        }
        if not pdf_error and pdf_b64
        else None
    )

    lines_out = [f"Cotización {quote['id']} emitida por ${quote.get('total')}.{ref}"]
    lines_out.append(f"Enlace para verla: {link or 'no disponible'}")
    lines_out.append(f"Enlace de pago: {checkout_link or 'no disponible por ahora'}")
    lines_out.append("PDF adjunto." if attachment else "El PDF no se pudo adjuntar ahora.")

    return _tool_reply(
        runtime,
        "\n".join(lines_out),
        update={
            "carts": {
                cart_id: {
                    "quoteId": quote["id"],
                    "quoteLink": link,
                    "quoteSignature": _cart_signature(lines),
                    "orderId": order.get("id") if order else record.get("orderId"),
                    "checkoutLink": checkout_link or record.get("checkoutLink"),
                    "stage": "PAGO_ENVIADO" if checkout_link else "COTIZACION_EMITIDA",
                }
            },
            "active_cart_id": cart_id,
            "customer": {**customer, "customerId": created["id"]},
            "pending_attachment": attachment,
        },
    )


@tool
async def detalle_de_cotizacion(quoteId: str, runtime: ToolRuntime) -> str:
    """Líneas, estado, total y vigencia de una cotización por folio.

    Funciona para CUALQUIER cotización del cliente, esté o no entre los
    carritos abiertos de esta conversación (por ejemplo una de hace unos
    días, o una que otro carrito de esta misma charla ya emitió): consulta
    el folio real en el backend, no el estado local.
    """
    if denied := _require_scope(runtime, "detalle_de_cotizacion"):
        return _fail(denied)
    quote, error = await _safe(
        _client(runtime).get_quote(clamp_text(quoteId, 100, collapse_newlines=True))
    )
    if error:
        return _fail(error)
    lines = "; ".join(
        f"{l.get('quantity')} x {clamp_text(l.get('title') or '', 200, collapse_newlines=True)} "
        f"(${l.get('unitPrice')})"
        for l in (quote or {}).get("lines", [])
    )
    return (
        f"Cotización {quote.get('id')}: estado {quote.get('status')}, total ${quote.get('total')}, "
        f"vence {quote.get('expiresAt')}. Líneas: {lines or 'sin líneas'}"
    )


# ---------------------------------------------------------------- pedido y pago


def _resolve_order_id(runtime: ToolRuntime, order_id: str, cart_id: str) -> tuple[str, str]:
    """`orderId` explícito gana; si no, el del carrito resuelto por `cart_id`.

    Devuelve `(order_id, cart_id_del_pedido)` — el segundo puede diferir del
    `cart_id` pedido si `orderId` vino explícito y pertenece a otro carrito
    (se busca entre los carritos abiertos para poder anotar el resultado en
    el registro correcto).
    """
    clean = clamp_text(order_id, 100, collapse_newlines=True)
    if clean:
        carts: dict[str, CartRecord] = runtime.state.get("carts") or {}
        owner = next((cid for cid, rec in carts.items() if rec.get("orderId") == clean), cart_id)
        return clean, owner
    record = _cart_record(runtime, cart_id)
    return str(record.get("orderId") or ""), cart_id


@tool
async def convertir_en_pedido(runtime: ToolRuntime, carritoId: str = "") -> Command:
    """Convierte la cotización vigente de UN carrito en pedido.

    Solo con confirmación explícita. `carritoId` vacío = el carrito activo.
    """
    if denied := _require_scope(runtime, "convertir_en_pedido"):
        return _tool_reply(runtime, _fail(denied))
    cart_id = _resolve_cart_id(runtime, carritoId)
    record = _cart_record(runtime, cart_id)
    quote_id = record.get("quoteId")
    total_open = len(open_carts(runtime.state.get("carts"))) or 1
    ref = _cart_ref(cart_id, total_open)
    if not quote_id:
        return _tool_reply(runtime, _fail(f"No hay cotización emitida en ese carrito; emítela primero.{ref}"))
    if record.get("orderId"):
        # emitir_cotizacion ya arma el pedido y el enlace de pago para esta
        # cotización; llamar de nuevo crearía un segundo pedido duplicado.
        return _tool_reply(
            runtime,
            f"Ya hay un pedido para esta cotización: {record['orderId']}. "
            f"Enlace de pago: {record.get('checkoutLink') or 'usa generar_enlace_pago'}{ref}",
        )

    order, error = await _safe(_client(runtime).order_from_quote(quote_id))
    if error:
        return _tool_reply(runtime, _fail(error))
    return _tool_reply(
        runtime,
        f"Pedido {order['id']} creado (estado {order.get('status')}, total ${order.get('total')}).{ref}",
        update={"carts": {cart_id: {"orderId": order["id"]}}, "active_cart_id": cart_id},
    )


@tool
async def generar_enlace_pago(runtime: ToolRuntime, deliveryMode: str = "PICKUP", carritoId: str = "") -> Command:
    """Genera el enlace de pago del pedido vigente de UN carrito.

    El backend arma la URL. `carritoId` vacío = el carrito activo.
    """
    if denied := _require_scope(runtime, "generar_enlace_pago"):
        return _tool_reply(runtime, _fail(denied))
    cart_id = _resolve_cart_id(runtime, carritoId)
    record = _cart_record(runtime, cart_id)
    total_open = len(open_carts(runtime.state.get("carts"))) or 1
    ref = _cart_ref(cart_id, total_open)
    order_id = record.get("orderId")
    if not order_id:
        return _tool_reply(runtime, _fail(f"No hay pedido en ese carrito: usa convertir_en_pedido antes de cobrar.{ref}"))
    lines: list[CartLine] = list(record.get("lines") or [])
    if not lines:
        return _tool_reply(runtime, _fail(f"Ese carrito está vacío; no sé qué cobrar.{ref}"))

    checkout, error = await _safe(
        _client(runtime).start_checkout(order_id, lines=_lines_payload(lines), delivery_mode=deliveryMode)
    )
    if error:
        return _tool_reply(runtime, _fail(error))
    link = (checkout or {}).get("checkoutUrl")
    if not link:
        return _tool_reply(runtime, _fail("El backend no devolvió enlace de pago."))
    return _tool_reply(
        runtime,
        f"Enlace de pago listo: {link}{ref}",
        update={"carts": {cart_id: {"checkoutLink": link, "stage": "PAGO_ENVIADO"}}, "active_cart_id": cart_id},
    )


@tool
async def estado_del_pedido(runtime: ToolRuntime, orderId: str = "", carritoId: str = "") -> str:
    """Estado real del pedido y de su pago.

    Úsala siempre que el cliente diga que ya pagó: no confíes en su palabra.
    Si el cliente da el número de pedido, pásalo en `orderId` (funciona
    aunque no sea de un carrito abierto en esta conversación); si no, se usa
    el pedido del carrito activo (o de `carritoId` si lo indicas).
    """
    if denied := _require_scope(runtime, "estado_del_pedido"):
        return _fail(denied)
    cart_id = _resolve_cart_id(runtime, carritoId)
    target, _owner = _resolve_order_id(runtime, orderId, cart_id)
    if not target:
        return _fail("No tengo número de pedido; pídeselo al cliente o dime a cuál pedido te refieres.")
    order, error = await _safe(_client(runtime).get_order(target))
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

    Es UN solo cliente para toda la conversación, aunque lleve varios
    carritos: llama esto una vez y sirve para todos sus pedidos.
    """
    if denied := _require_scope(runtime, "recordar_cliente"):
        return _tool_reply(runtime, _fail(denied))
    # Estos campos se reinyectan en el prompt de CADA turno futuro (memoria
    # de la conversación): sin collapse_newlines, un "nombre" con saltos de
    # línea podría simular un mensaje de sistema o un turno falso en todas
    # las respuestas siguientes, no solo en esta.
    nombre = clamp_text(nombre, 120, collapse_newlines=True)
    correo = clamp_text(correo, 120, collapse_newlines=True)
    telefono = clamp_text(telefono, 40, collapse_newlines=True)
    facts: CustomerFacts = {}
    if nombre:
        facts["name"] = nombre
    if correo and "@" in correo:
        facts["email"] = correo
    if telefono:
        facts["phone"] = telefono
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

    client = _client(runtime)
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

    full_name = clamp_text(found.get("fullName") or "", 120, collapse_newlines=True)
    email = clamp_text(found.get("email") or "", 120, collapse_newlines=True)
    parts = [f"Cliente: {full_name} ({email or 'sin correo'})"]
    rfc = clamp_text(found.get("taxId") or "", 20, collapse_newlines=True)
    if rfc:
        legal_name = clamp_text(found.get("legalName") or "", 200, collapse_newlines=True)
        cp = clamp_text(found.get("fiscalPostalCode") or "", 10, collapse_newlines=True)
        cfdi = clamp_text(found.get("fiscalCfdiUse") or "", 10, collapse_newlines=True)
        parts.append(
            f"Datos fiscales guardados de una factura anterior: RFC {rfc}, "
            f"razón social {legal_name or 'sin dato'}, CP {cp or 'sin dato'}, "
            f"uso CFDI {cfdi or 'sin dato'}. Antes de reusarlos, confírmalos con el cliente."
        )
    for q in quotes:
        parts.append(f"  cotización {str(q['id'])[:8]} — ${q['total']} — {q['status']} — {q['createdAt']}")
    for o in orders:
        parts.append(f"  pedido {str(o['id'])[:8]} — ${o['total']} — {o['status']} — {o['createdAt']}")
    return "\n".join(parts)


@tool
async def solicitar_factura(
    orderId: str,
    rfc: str,
    razonSocial: str,
    codigoPostal: str,
    usoCfdi: str,
    runtime: ToolRuntime,
    constanciaUrl: str = "",
    carritoId: str = "",
) -> str:
    """Pide factura (CFDI) para un pedido ya identificado.

    SOLO llama esto después de que el cliente diga explícitamente que sí a
    TODOS estos datos exactos que le vas a leer de vuelta: RFC, razón social,
    código postal fiscal y uso de CFDI (ej. G03, P01). Si `historial_del_cliente`
    ya mostró datos fiscales guardados de una compra anterior, léeselos primero
    y pregunta si son los mismos antes de asumir nada — nunca los reuses en
    silencio. Si el cliente tiene su constancia de situación fiscal y te pasa
    un enlace o la sube por otro medio, pon esa URL en `constanciaUrl`; si no
    la tiene a la mano, déjalo vacío y avisa que puede mandarla después.

    Si el cliente lleva varios pedidos a la vez, pasa `orderId` (o
    `carritoId`) para facturar el que corresponde; nunca adivines cuál si
    hay más de uno y no lo dijo.

    No inventes ni corrijas el RFC o la razón social por tu cuenta: si algo
    suena raro, pregunta de nuevo en vez de adivinar.
    """
    if denied := _require_scope(runtime, "solicitar_factura"):
        return _fail(denied)
    cart_id = _resolve_cart_id(runtime, carritoId)
    order_id, _owner = _resolve_order_id(runtime, orderId, cart_id)
    if not order_id:
        return _fail("No tengo número de pedido; pídeselo al cliente o usa historial_del_cliente.")

    rfc_clean = clamp_text(rfc, 20, collapse_newlines=True).upper().strip()
    if not re.fullmatch(r"[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}", rfc_clean):
        return _fail("Ese RFC no tiene un formato válido; pídeselo de nuevo al cliente.")
    cfdi_clean = clamp_text(usoCfdi, 10, collapse_newlines=True).upper().strip()
    if not re.fullmatch(r"[A-Z]\d{2}", cfdi_clean):
        return _fail("Uso de CFDI inválido (ej. G03, P01); confírmalo con el cliente.")
    cp_clean = clamp_text(codigoPostal, 10, collapse_newlines=True).strip()
    if not re.fullmatch(r"\d{5}", cp_clean):
        return _fail("El código postal debe ser de 5 dígitos.")

    invoice, error = await _safe(
        _client(runtime).request_invoice(
            order_id,
            rfc=rfc_clean,
            legal_name=clamp_text(razonSocial, 200, collapse_newlines=True),
            postal_code=cp_clean,
            cfdi_use=cfdi_clean,
            constancia_url=clamp_text(constanciaUrl, 2000, collapse_newlines=True) or None,
        )
    )
    if error:
        return _fail(error)
    tiene_constancia = bool((invoice or {}).get("invoiceConstanciaUrl"))
    return (
        f"Factura solicitada para el pedido {order_id}. "
        f"RFC {rfc_clean}, razón social {razonSocial}, CP {cp_clean}, uso CFDI {cfdi_clean}. "
        + ("Constancia recibida." if tiene_constancia else "Falta la constancia de situación fiscal; pídesela cuando pueda mandarla.")
    )


@tool
async def escalar_a_humano(motivo: str, resumen: str, runtime: ToolRuntime) -> Command:
    """Pasa la conversación a una persona del equipo.

    Motivos: CLIENTE_LO_PIDE, FUERA_DE_CONOCIMIENTO, QUEJA, PRECIO_ESPECIAL,
    CREDITO, ERROR_TECNICO.
    """
    if denied := _require_scope(runtime, "escalar_a_humano"):
        return _tool_reply(runtime, _fail(denied))
    motivo = clamp_text(motivo, 80, collapse_newlines=True)
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
    solicitar_factura,
    escalar_a_humano,
]
