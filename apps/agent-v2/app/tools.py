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
from langchain_core.messages import ToolMessage
from langgraph.types import Command

from .agent_settings import (
    CHECKOUT_MODES,
    DEFAULT_CHECKOUT_MODE,
    DEFAULT_QUOTE_ONLY_CLOSING,
    get_agent_settings,
)
from .commerce import CommerceClient, CommerceError, CommerceUnavailable
from .config import get_settings
from .security import clamp_text, require_scope, sanitize_error_message
from .state import CartLine, CartRecord, CustomerFacts, TurnContext, open_carts
from .tenant_context import invalidate_tenant_caches, load_variants

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


def _parse_coord(value: str | float | int | None, *, low: float, high: float) -> float | None:
    """Convierte una coordenada que llega como texto del modelo a `float`.

    Los args de las tools son strings (vacío = "no lo dio"), así que aquí se
    tolera `""`, espacios y coma decimal ("19,43"). Fuera de rango o no
    numérico → `None`: una coordenada inválida se ignora en vez de romper
    la llamada, porque el CP/ciudad siguen pudiendo resolver la zona.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        num = float(value)
    else:
        text = str(value).strip().replace(",", ".")
        if not text:
            return None
        try:
            num = float(text)
        except ValueError:
            return None
    if num != num or not (low <= num <= high):  # NaN o fuera de rango
        return None
    return num


def _parse_point(lat: str | float | None, lng: str | float | None) -> tuple[float, float] | None:
    """`(lat, lng)` válidas en WGS84, o `None` si falta o sobra alguna."""
    la = _parse_coord(lat, low=-90.0, high=90.0)
    lo = _parse_coord(lng, low=-180.0, high=180.0)
    if la is None or lo is None:
        return None
    return la, lo


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


# ---------------------------------------------------------------- identidad del cliente
#
# Quién es "el cliente de esta conversación" lo decide SOLO el canal
# autenticado: `runtime.context["customer_phone"]` lo pone commerce-api desde
# `WhatsAppConversation.externalPhone` (el número que de verdad escribió), no
# el modelo ni el cliente. Lo que el cliente DICE ("mi teléfono es 55…", "mi
# correo es ana@…") es un dato sin verificar: sirve para completar su ficha,
# nunca para encontrar o leer la ficha de otra persona. Antes,
# `historial_del_cliente` buscaba con el teléfono que el cliente se había
# "recordado" y `GET /customers?q=` hace `contains`, así que "mi teléfono es
# 55" devolvía nombre, correo, RFC e historial de otro cliente del negocio.

_NOT_IN_CONVERSATION_QUOTE = "No encontré esa cotización en esta conversación."
_NOT_IN_CONVERSATION_ORDER = "No encontré ese pedido en esta conversación."


def normalize_phone(value: Any) -> str:
    """Solo dígitos, con el prefijo móvil mexicano viejo plegado.

    WhatsApp reporta los móviles de México como ``521`` + 10 dígitos y
    muchas fichas los guardan como ``52`` + 10: son el mismo número. Fuera
    de eso la comparación es exacta — nunca por sufijo ni por ``contains``.
    """
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) == 13 and digits.startswith("521"):
        digits = "52" + digits[3:]
    return digits


def same_phone(a: Any, b: Any) -> bool:
    """Igualdad exacta de teléfonos normalizados (mínimo 8 dígitos)."""
    na, nb = normalize_phone(a), normalize_phone(b)
    return len(na) >= 8 and na == nb


def _channel_phone(runtime: ToolRuntime) -> str:
    """Teléfono autenticado por el canal (WhatsApp), o "" (chat web)."""
    return str(_ctx(runtime).get("customer_phone") or "").strip()


def _customer_items(found: Any) -> list[dict[str, Any]]:
    items = found.get("items", found) if isinstance(found, dict) else found
    return [c for c in (items or []) if isinstance(c, dict)]


async def _customers_with_phone(client: CommerceClient, phone: str) -> list[dict[str, Any]]:
    """Clientes del tenant cuyo teléfono es EXACTAMENTE ``phone`` (normalizado).

    commerce-api solo ofrece ``GET /customers?q=`` (``contains``, sirve para
    el buscador del panel); se consulta con los últimos 10 dígitos y se
    filtra aquí por igualdad exacta. Un número parcial nunca encuentra nada.
    """
    target = normalize_phone(phone)
    if len(target) < 8:
        return []
    found = await client.find_customer(target[-10:])
    return [c for c in _customer_items(found) if normalize_phone(c.get("phone")) == target]


async def _customers_with_email(client: CommerceClient, email: str) -> list[dict[str, Any]]:
    """Clientes del tenant cuyo correo es EXACTAMENTE ``email`` (sin mayúsculas)."""
    wanted = (email or "").strip().lower()
    if "@" not in wanted:
        return []
    found = await client.find_customer(wanted)
    return [c for c in _customer_items(found) if str(c.get("email") or "").strip().lower() == wanted]


async def _channel_customer(client: CommerceClient, runtime: ToolRuntime) -> dict[str, Any] | None:
    """La ficha del cliente autenticado por el canal, o ``None``."""
    phone = _channel_phone(runtime)
    if not phone:
        return None
    matches = await _customers_with_phone(client, phone)
    return matches[0] if matches else None


async def _owned_by_conversation(
    client: CommerceClient, runtime: ToolRuntime, record: dict[str, Any], *, kind: str
) -> bool:
    """¿La cotización/pedido ``record`` es de ESTA conversación?

    Sí cuando su id ya está en ``state.carts`` (lo creó una tool de este
    hilo), cuando su cliente es el ``customerId`` que emitir_cotizacion
    resolvió en este hilo, o cuando el teléfono de su cliente es exactamente
    el del canal autenticado. Cualquier otro folio del tenant —aunque exista—
    se trata como inexistente.
    """
    record_id = str(record.get("id") or "")
    carts: dict[str, CartRecord] = runtime.state.get("carts") or {}
    field_name = "quoteId" if kind == "quote" else "orderId"
    if record_id and any(str(c.get(field_name) or "") == record_id for c in carts.values()):
        return True
    customer_id = str(record.get("customerId") or (record.get("customer") or {}).get("id") or "")
    known_id = str((runtime.state.get("customer") or {}).get("customerId") or "")
    if customer_id and known_id and customer_id == known_id:
        return True
    phone = _channel_phone(runtime)
    if not phone:
        return False
    if same_phone((record.get("customer") or {}).get("phone"), phone):
        return True
    if customer_id:
        channel_customer, error = await _safe(_channel_customer(client, runtime))
        if not error and channel_customer and str(channel_customer.get("id")) == customer_id:
            return True
    return False


def _is_not_found(error: str | None) -> bool:
    return bool(error) and ("NOT_FOUND" in error or "404" in error or "no accesible" in error.lower())


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
    # Caché de tenant (120 s, `tenant_context.load_variants`), igual que el
    # resto de las tools: antes pegaba directo a commerce-api en cada
    # llamada, duplicando lo que el prompt ya trae vía `load_catalog` — y
    # esta es justo la tool que el prompt manda usar en casi cada turno con
    # intención de compra.
    tenant_id = _ctx(runtime).get("tenant_id", "")
    variants, error = await _safe(
        load_variants(tenant_id, lambda: _client(runtime).search_products(None, limit=100))
    )
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
        # Sinónimo curado a mano por el negocio (ej. "cubeta grande" -> su presentación de 19 L): pesa
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


def _find_variant(variants: list[dict[str, Any]] | None, key: str) -> dict[str, Any] | None:
    """Variante por ``variantId`` exacto o, si no, por SKU exacto.

    gpt-4o-mini confunde con frecuencia el SKU con el variantId aunque la
    lista de buscar_productos traiga ambos; aceptar el SKU evita un ERROR y
    una segunda vuelta de herramientas por un dato que ya tenía.
    """
    wanted = (key or "").strip()
    if not wanted:
        return None
    for v in variants or []:
        if v.get("variantId") == wanted:
            return v
    for v in variants or []:
        if str(v.get("sku") or "").strip().lower() == wanted.lower():
            return v
    return None


@tool
async def agregar_al_carrito(
    variantId: str,
    cantidad: str,
    runtime: ToolRuntime,
    carritoId: str = "",
) -> Command:
    """Agrega o actualiza una línea de UN carrito de esta conversación.

    Usa el variantId exacto que devolvió buscar_productos (también acepta el
    SKU exacto de esa misma lista). Si la variante ya estaba en ese carrito,
    se reemplaza su cantidad.

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

    tenant_id = _ctx(runtime).get("tenant_id", "")
    client = _client(runtime)
    variants, error = await _safe(
        load_variants(tenant_id, lambda: client.search_products(None, limit=100))
    )
    if error:
        return _tool_reply(runtime, _fail(error))
    variant = _find_variant(variants, variantId)
    if variant is None:
        # Puede ser una variante recién publicada que la caché (120 s) aún no
        # ve: una relectura en vivo antes de decirle al modelo que no existe.
        invalidate_tenant_caches(tenant_id)
        variants, error = await _safe(
            load_variants(tenant_id, lambda: client.search_products(None, limit=100))
        )
        if error:
            return _tool_reply(runtime, _fail(error))
        variant = _find_variant(variants, variantId)
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

    variantId = variant["variantId"]
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


_DELIVERY_MODES = {"PICKUP", "LOCAL_DELIVERY"}

# Motivos con los que escalar_a_humano NO marca handoff (ver la tool).
_NO_HANDOFF_REASONS = {"ERROR_TECNICO", "ERROR", "TECNICO", "SISTEMA", "FALLO_TECNICO"}

# Mismo criterio que `CustomerService.isPlaceholderName` en commerce-api:
# un "nombre" así deja la ficha del cliente vacía aunque parezca llena.
_PLACEHOLDER_NAMES = {
    "cliente", "cliente de whatsapp", "cliente sin nombre", "cliente nuevo",
    "usuario", "user", "customer", "anonimo", "anónimo", "desconocido",
    "sin nombre", "n/a", "na", "none", "null", "ninguno", "no", "-", "?",
}


def is_placeholder_name(value: str) -> bool:
    """``True`` si el texto no es un nombre real de persona o negocio."""
    normalized = " ".join((value or "").strip().lower().split())
    if not normalized or normalized in _PLACEHOLDER_NAMES:
        return True
    if re.fullmatch(r"\+?\d[\d\s-]{5,}", normalized):
        return True  # un teléfono no es un nombre
    return len(normalized) < 2


def _pending_customer_facts(runtime: ToolRuntime) -> CustomerFacts:
    """Datos que ``recordar_cliente`` está guardando EN ESTE MISMO lote de tools.

    "Sí, emítela, soy Ana" hace que el modelo llame recordar_cliente y
    emitir_cotizacion en el mismo mensaje. Ambas se ejecutan contra el mismo
    snapshot del estado, así que la segunda todavía no ve el nombre que la
    primera acaba de guardar y se negaba a cotizar. Se rescatan los
    argumentos de esa llamada hermana del último AIMessage del hilo.
    """
    facts: CustomerFacts = {}
    messages = list(runtime.state.get("messages") or [])
    for message in reversed(messages):
        if message.__class__.__name__ == "AIMessage":
            for call in getattr(message, "tool_calls", None) or []:
                if call.get("name") != "recordar_cliente":
                    continue
                args = call.get("args") or {}
                name = clamp_text(str(args.get("nombre") or ""), 120, collapse_newlines=True)
                email = clamp_text(str(args.get("correo") or ""), 120, collapse_newlines=True)
                phone = clamp_text(str(args.get("telefono") or ""), 40, collapse_newlines=True)
                if name and not is_placeholder_name(name):
                    facts["name"] = name
                if email and "@" in email:
                    facts["email"] = email
                if phone and not _channel_phone(runtime):
                    # Con canal autenticado el teléfono ya es el del chat.
                    facts["phone"] = phone
            break
    return facts


def _checkout_mode(runtime: ToolRuntime) -> str:
    """Modo de cobro del tenant (`agent_settings.CHECKOUT_MODES`).

    Se lee del store en cada llamada (está cacheado en memoria) y nunca del
    modelo ni del cliente: que un negocio "solo cotiza" es política del
    admin. Sin tenant o sin ajustes → el default (`quote_and_pay`).
    """
    tenant_id = _ctx(runtime).get("tenant_id", "")
    if not tenant_id:
        return DEFAULT_CHECKOUT_MODE
    mode = str(get_agent_settings(tenant_id).checkout_mode or "").strip().lower()
    return mode if mode in CHECKOUT_MODES else DEFAULT_CHECKOUT_MODE


def _quote_only_closing(runtime: ToolRuntime) -> str:
    tenant_id = _ctx(runtime).get("tenant_id", "")
    if not tenant_id:
        return DEFAULT_QUOTE_ONLY_CLOSING
    return get_agent_settings(tenant_id).quote_only_closing()


_QUOTE_ONLY_DENIED = (
    "Este negocio está en modo SOLO COTIZACIÓN: no se generan enlaces de pago. "
    "Comparte la cotización y cierra con el mensaje de seguimiento configurado; "
    "no prometas ni menciones un enlace de pago."
)


def _delivery_mode(runtime: ToolRuntime, record: CartRecord, explicit: str = "") -> str:
    """Modo de entrega efectivo de un carrito.

    Prioridad: el que pasó el modelo en esta llamada → el que usó la última
    vez en calcular_total para ESE carrito → el por defecto del tenant →
    PICKUP. Así el enlace de pago que arma emitir_cotizacion cobra el mismo
    envío que el total que ya se le dijo al cliente.
    """
    candidate = (explicit or "").strip().upper()
    if candidate in _DELIVERY_MODES:
        return candidate
    remembered = str(record.get("deliveryMode") or "").strip().upper()
    if remembered in _DELIVERY_MODES:
        return remembered
    tenant_id = _ctx(runtime).get("tenant_id", "")
    if tenant_id:
        from .agent_settings import get_agent_settings

        default = str(get_agent_settings(tenant_id).default_delivery_mode or "").strip().upper()
        if default in _DELIVERY_MODES:
            return default
    return "PICKUP"


async def _quote_identifiers(
    client: CommerceClient, runtime: ToolRuntime, customer: CustomerFacts
) -> tuple[str | None, str | None]:
    """Teléfono y correo con los que ``emitir_cotizacion`` resuelve la ficha.

    ``POST /customers/resolve-channel`` busca una ficha EXISTENTE por
    teléfono o correo exacto y le cuelga la cotización (el PDF sale con el
    nombre y correo de esa ficha). Un dato que solo dijo el cliente no puede
    decidir eso:

    - Con canal autenticado, el teléfono es siempre el del canal; el correo
      dicho solo se manda si nadie lo tiene o lo tiene la ficha de ESE mismo
      teléfono (si no, la cotización caería en la ficha de otra persona).
    - Sin canal (chat web) nada está verificado: teléfono y correo solo se
      mandan si ninguna ficha existente los tiene; si alguna los tiene, la
      cotización se emite a una ficha nueva con solo el nombre.

    Si la consulta de verificación falla, el dato se descarta (falla
    cerrado): una cotización sin correo es mejor que una en la ficha ajena.
    """
    ctx = _ctx(runtime)
    channel_phone = _channel_phone(runtime)
    email = (customer.get("email") or ctx.get("customer_email") or "").strip() or None
    # Ficha que ESTA conversación ya creó/usó en una cotización anterior. Sale
    # de la respuesta del backend (nunca de lo que dice el cliente), así que
    # que ella tenga el dato no es "de otra persona": sin esto, en chat web la
    # segunda cotización salía sin teléfono ni correo y duplicaba la ficha.
    own_id = str(customer.get("customerId") or "")

    async def unclaimed(lookup, value: str | None) -> bool:
        if not value:
            return False
        holders, error = await _safe(lookup(client, value))
        if error:
            return False
        others = [h for h in holders or [] if not own_id or str(h.get("id") or "") != own_id]
        if channel_phone:
            return all(same_phone(h.get("phone"), channel_phone) for h in others)
        return not others

    if channel_phone:
        return channel_phone, (email if await unclaimed(_customers_with_email, email) else None)
    # Solo dígitos: el backend compara el teléfono literal, así que mandar el
    # formato tal cual lo tecleó el cliente ("55 1234 5678") podría pegarle a
    # una ficha guardada con ese mismo formato que la búsqueda de arriba no ve.
    phone = normalize_phone(customer.get("phone"))
    phone = phone if len(phone) >= 8 else None
    phone_ok = await unclaimed(_customers_with_phone, phone)
    email_ok = await unclaimed(_customers_with_email, email)
    return (phone if phone_ok else None), (email if email_ok else None)


def _cart_signature(lines: list[CartLine]) -> str:
    """Huella de un carrito: sirve para no reemitir la misma cotización."""
    return "|".join(sorted(f"{c['variantId']}:{c['quantity']}" for c in lines))


def _lines_payload(lines: list[CartLine]) -> list[dict[str, Any]]:
    return [{"variantId": c["variantId"], "quantity": format_quantity(c["quantity"])} for c in lines]


# ---------------------------------------------------------------- cálculo de uso


def _coerce_number(value: Any, field: str) -> float:
    """Coerce a number from LLM-supplied args; rejects NaN/inf."""
    try:
        number = float(str(value).strip().replace(",", "."))
    except (ValueError, TypeError) as exc:
        raise ValueError(f"{field} debe ser un número, recibí {value!r}") from exc
    if number != number or number in (float("inf"), float("-inf")):  # noqa: PLR0124 (NaN check)
        raise ValueError(f"{field} no puede ser NaN ni infinito")
    return number


def _round_up_coverage(
    unidades_objetivo: float, rendimiento_por_unidad: float
) -> tuple[int, float]:
    """`math.ceil(unidades / rendimiento)` y la cobertura efectiva.

    Redondeo hacia arriba porque el uso típico es "necesito cubrir X" — pasar
    por debajo deja al cliente corto. Si el cliente pidiera explícitamente
    "dame lo mínimo exacto", usa el `mode='exact'`.
    """
    import math

    return math.ceil(unidades_objetivo / rendimiento_por_unidad), (
        math.ceil(unidades_objetivo / rendimiento_por_unidad) * rendimiento_por_unidad
    )


@tool
async def calcular_unidades_para_cubrir(
    unidades_objetivo: str,
    rendimiento_por_unidad: str,
    unidad_objetivo: str,
    unidad_cobertura: str,
    variantId: str,
    runtime: ToolRuntime,
    mode: str = "cubrir",
) -> Command:
    """Calcula cuántas unidades del producto necesita el cliente para su uso.

    Única herramienta para cuentas de cantidad (rendimiento, cobertura,
    porciones, m²). Si la divides tú con un "40/25 = 1.6, te digo 2", te
    puedes equivocar; aquí la matemática es determinista.

    Args:
    - `variantId`: id de la variante (el que devolvió `buscar_productos`).
      Solo se usa para validar que existe; el cálculo no depende de él.
    - `unidades_objetivo`: total que el cliente quiere cubrir (ej. 40 si son
      40 personas, 100 si son 100 m²). Pasar como número o como texto.
    - `rendimiento_por_unidad`: cuánto cubre UNA unidad del producto (ej. 25
      porciones por envase, 8 m² por litro). Sale de <informacion_negocio>
      o de lo que dice el producto; NO lo inventes.
    - `unidad_objetivo` y `unidad_cobertura`: cómo se llaman las unidades
      ("personas" / "porciones", "m²" / "m² por litro"). Solo se usan para
      armar el texto; no afectan el cálculo.
    - `mode`: "cubrir" (default, redondea hacia arriba para garantizar
      cobertura) o "exact" (redondeo bancario — usar solo si el cliente
      pidió explícitamente "lo mínimo exacto" o "ni uno de más").

    Devuelve "Necesitas N unidades (cubren M {unidad_cobertura})". Si el
    rendimiento es 0 o falta, devuelve error: NUNCA devuelve una cifra
    inventada.
    """
    if denied := _require_scope(runtime, "calcular_unidades_para_cubrir"):
        return _tool_reply(runtime, _fail(denied))

    try:
        objetivo = _coerce_number(unidades_objetivo, "unidades_objetivo")
        rendimiento = _coerce_number(rendimiento_por_unidad, "rendimiento_por_unidad")
    except ValueError as exc:
        return _tool_reply(runtime, _fail(str(exc)))

    if rendimiento <= 0:
        return _tool_reply(
            runtime,
            _fail(
                "rendimiento_por_unidad debe ser > 0. Si el producto no tiene "
                "rendimiento declarado en <informacion_negocio> ni en el catálogo, "
                "NO calcules cantidad: di que no tienes el dato preciso."
            ),
        )
    if objetivo < 0:
        return _tool_reply(
            runtime, _fail("unidades_objetivo debe ser >= 0.")
        )
    if objetivo == 0:
        return _tool_reply(runtime, "Necesitas 0 unidades (objetivo 0).")

    # Validar que la variante existe en el catálogo: si no, no hay rendimiento
    # confiable para ella. Sin esto, el LLM podría pasar un rendimiento
    # "razonable" para una variante que no es la correcta.
    tenant_id = _ctx(runtime).get("tenant_id", "")
    client = _client(runtime)
    variants, error = await _safe(
        load_variants(tenant_id, lambda: client.search_products(None, limit=100))
    )
    if error:
        return _tool_reply(runtime, _fail(error))
    if not any(v.get("variantId") == variantId for v in (variants or [])):
        # Caché pudo quedar desfasada: una relectura antes de fallar.
        invalidate_tenant_caches(tenant_id)
        variants, error = await _safe(
            load_variants(tenant_id, lambda: client.search_products(None, limit=100))
        )
        if error:
            return _tool_reply(runtime, _fail(error))
    variant_exists = any(v.get("variantId") == variantId for v in (variants or []))
    if not variant_exists:
        return _tool_reply(
            runtime,
            _fail(
                f"El variantId '{variantId}' no existe. Llama a buscar_productos "
                "primero y pasa uno de los variantId que te devolvió. No calcules "
                "cantidad sobre una variante inventada."
            ),
        )

    import math

    if mode == "exact":
        unidades = round(objetivo / rendimiento)
    else:
        unidades = math.ceil(objetivo / rendimiento)
    cobertura = unidades * rendimiento

    objetivo_label = (
        f"{int(objetivo)}" if objetivo == int(objetivo) else f"{objetivo:g}"
    )
    cobertura_label = (
        f"{int(cobertura)}" if cobertura == int(cobertura) else f"{cobertura:g}"
    )
    unidad_obj = clamp_text(unidad_objetivo, 40, collapse_newlines=True) or "unidades"
    unidad_cob = clamp_text(unidad_cobertura, 40, collapse_newlines=True) or "unidades"
    text = (
        f"Necesitas {unidades} unidades para cubrir {objetivo_label} {unidad_obj} "
        f"({cobertura_label} {unidad_cob})."
    )
    return _tool_reply(runtime, text)


@tool
async def calcular_total(
    runtime: ToolRuntime,
    deliveryMode: str = "",
    carritoId: str = "",
    postalCode: str = "",
    city: str = "",
    state: str = "",
    lat: str = "",
    lng: str = "",
) -> Command:
    """Calcula el total exacto de UN carrito con impuestos y envío.

    Es la ÚNICA fuente de importes: nunca sumes tú. No crea la cotización.
    `deliveryMode`: PICKUP (recoge en tienda) o LOCAL_DELIVERY (envío a
    domicilio); vacío = el que ya usaste para ese carrito o el por defecto del
    negocio. Si el cliente pide envío, pásalo explícito. `carritoId` vacío =
    el carrito activo (ver agregar_al_carrito). Si el cliente lleva dos
    pedidos y pregunta "¿y el total de las playeras?", pasa ese carritoId
    explícito para no calcular el equivocado.

    Para `LOCAL_DELIVERY`, si el cliente ya dio dirección pasa `postalCode`,
    `city`, `state`. El backend resuelve la zona que el admin configuró y
    sobreescribe el envío. Sin dirección, se cae al `shippingFlat` del
    tenant (genérico).
    """
    """Calcula el total exacto de UN carrito con impuestos y envío.

    Es la ÚNICA fuente de importes: nunca sumes tú. No crea la cotización.
    `deliveryMode`: PICKUP (recoge en tienda) o LOCAL_DELIVERY (envío a
    domicilio); vacío = el que ya usaste para ese carrito o el por defecto del
    negocio. Si el cliente pide envío, pásalo explícito. `carritoId` vacío =
    el carrito activo (ver agregar_al_carrito). Si el cliente lleva dos
    pedidos y pregunta "¿y el total de las playeras?", pasa ese carritoId
    explícito para no calcular el equivocado.
    """
    if denied := _require_scope(runtime, "calcular_total"):
        return _tool_reply(runtime, _fail(denied))
    cart_id = _resolve_cart_id(runtime, carritoId)
    record = _cart_record(runtime, cart_id)
    lines: list[CartLine] = list(record.get("lines") or [])
    if not lines:
        return _tool_reply(runtime, _fail("Ese carrito está vacío: agrega productos primero."))

    mode = _delivery_mode(runtime, record, deliveryMode)
    # Si el cliente ya dio dirección con `recordar_direccion_entrega` y no
    # estamos recibiendo argumentos explícitos, usamos la guardada.
    # La dirección NO se auto-hereda al `cotizar_cotizacion` porque ese
    # paso no la necesita; solo calcular_total la usa para resolver la
    # zona del admin.
    saved = (runtime.state.get("delivery_address") or {}) if hasattr(runtime, "state") else {}
    pc = postalCode or saved.get("postalCode") or ""
    c = city or saved.get("city") or ""
    s = state or saved.get("state") or ""
    # Ubicación (T-SHIP-07): explícita en los args o la guardada con
    # `recordar_direccion_entrega`. Solo se manda si vienen lat Y lng.
    point = _parse_point(lat, lng) or _parse_point(saved.get("lat"), saved.get("lng"))
    point_kwargs: dict[str, float] = {"lat": point[0], "lng": point[1]} if point else {}
    client = _client(runtime)
    totals, error = await _safe(
        client.price_preview(
            _lines_payload(lines),
            delivery_mode=mode,
            postal_code=pc or None,
            city=c or None,
            state=s or None,
            **point_kwargs,
        )
    )
    if error:
        return _tool_reply(runtime, _fail(error))

    body = (totals or {}).get("totals", totals or {})
    zone = (totals or {}).get("shippingZone") or {}
    detail = "; ".join(f"{c['quantity']} x {c['title']}" for c in lines)
    total_open = len(open_carts(runtime.state.get("carts"))) or 1
    zone_note = ""
    if mode == "LOCAL_DELIVERY":
        if zone.get("name"):
            zone_note = f" (zona: {zone['name']})"
        elif zone.get("fallback"):
            zone_note = " (envío estándar, el admin no configuró zona para esta dirección)"
    text = (
        f"Total para {detail}: subtotal ${body.get('subtotal')}, IVA ${body.get('tax')}, "
        f"envío ${body.get('shipping')}{zone_note} → TOTAL ${body.get('total')}" + _cart_ref(cart_id, total_open)
    )
    return _tool_reply(
        runtime,
        text,
        update={
            "carts": {cart_id: {"lastTotals": totals, "deliveryMode": mode, "stage": "COTIZADO"}},
            "active_cart_id": cart_id,
        },
    )


_MATCHED_BY_LABEL: dict[str, str] = {
    "polygon": "por la ubicación, dentro del área dibujada por el negocio",
    "postalCode": "por código postal",
    "city": "por ciudad y estado",
    "catchAll": "zona general para direcciones sin zona específica",
}


@tool
async def validar_zona_de_envio(
    postalCode: str = "",
    city: str = "",
    state: str = "",
    lat: str = "",
    lng: str = "",
    runtime: ToolRuntime = None,  # type: ignore[assignment]
) -> Command:
    """Confirma cuánto costaría el envío a la dirección o ubicación del cliente.

    Úsala cuando el cliente confirma una dirección a domicilio ANTES de
    pasarle el total: si el admin configuró zonas (polígono en el mapa, CP,
    ciudad, estado), esta herramienta devuelve el precio exacto de su zona.
    Si no hay zona que coincida, devuelve `fallback: true` con el
    `shippingFlat` genérico: avisale al cliente que el envío es estándar (no
    específico de su zona).

    Si el cliente compartió su ubicación de WhatsApp (verás en el mensaje
    "[el cliente compartió su ubicación: LAT, LNG]"), pasa esas coordenadas
    en `lat` y `lng` TAL CUAL, sin pedirle nada más: el backend revisa
    primero las zonas dibujadas en el mapa. Solo si la respuesta dice que la
    ubicación no cayó en ninguna zona pide el CP / ciudad / estado.

    Si el cliente aún NO dio dirección ni ubicación (solo dijo "es a
    domicilio"), no llames esto: primero pídele CP / ciudad / estado.

    Args:
    - `postalCode`: 4-5 dígitos (MX: 5; CR/ES: 4-5). Vacío = no lo dio.
    - `city`: nombre de la ciudad ("Guadalajara", "Querétaro", ...).
    - `state`: estado/departamento ("JAL", "QRO", "CDMX", ...).
    - `lat` / `lng`: coordenadas de la ubicación compartida ("19.4326",
      "-99.1332"). Van juntas; vacías = no compartió ubicación.

    Devuelve "Zona {nombre}: ${precio} (criterio)." o "Sin zona configurada
    para esa dirección: se cobrará el envío estándar (${precio})."
    """
    if denied := _require_scope(runtime, "validar_zona_de_envio"):
        return _tool_reply(runtime, _fail(denied))
    point = _parse_point(lat, lng)
    if not (postalCode or city or state or point):
        return _tool_reply(
            runtime,
            _fail(
                "Necesito al menos CP, ciudad, estado o la ubicación (lat/lng) "
                "para resolver la zona. Pídeselo al cliente."
            ),
        )
    lookup_kwargs: dict[str, Any] = {
        "postal_code": postalCode or None,
        "city": city or None,
        "state": state or None,
    }
    if point:
        lookup_kwargs["lat"], lookup_kwargs["lng"] = point
    zone, error = await _safe(_client(runtime).lookup_delivery_zone(**lookup_kwargs))
    if error:
        return _tool_reply(runtime, _fail(error))
    price = (zone or {}).get("price", "0.00")
    name = (zone or {}).get("zoneName")
    fallback = bool((zone or {}).get("fallback"))
    matched_by = str((zone or {}).get("matchedBy") or "")
    if name:
        how = _MATCHED_BY_LABEL.get(matched_by)
        text = f"Zona de envío: {name} → ${price}" + (f" ({how})." if how else ".")
        if point and matched_by and matched_by != "polygon" and not (postalCode or city or state):
            # Hubo ubicación pero ningún polígono la contiene: la zona salió
            # por otro criterio (solo puede ser catch-all sin CP/ciudad).
            text += " La ubicación no cayó en ninguna zona dibujada en el mapa."
    elif fallback:
        text = (
            f"Sin zona configurada para esa dirección: se cobrará el envío "
            f"estándar (${price})."
        )
        if point and not (postalCode or city or state):
            text += (
                " La ubicación compartida no cae en ninguna zona del mapa; "
                "pídele el CP / ciudad / estado por si hay zona por CP."
            )
    else:
        text = f"Envío a esa dirección: ${price}."
    return _tool_reply(runtime, text)


@tool
async def recordar_direccion_entrega(
    postalCode: str = "",
    city: str = "",
    state: str = "",
    line1: str = "",
    line2: str = "",
    notes: str = "",
    lat: str = "",
    lng: str = "",
    runtime: ToolRuntime = None,  # type: ignore[assignment]
) -> Command:
    """Guarda la dirección de entrega del cliente para este hilo.

    Llama esto cuando el cliente confirma su dirección de envío
    (después de pedirle CP / ciudad / estado). La dirección queda
    persistida en el checkpoint de LangGraph: el bot la reutiliza en
    turnos siguientes si el cliente cierra y vuelve, y `calcular_total`
    con `LOCAL_DELIVERY` la lee automáticamente para cobrar el envío
    correcto.

    `line1` y `line2` son opcionales (calle + número, colonia,
    referencias). El CP (4-5 dígitos) es obligatorio SALVO que pases la
    ubicación compartida por el cliente en `lat`/`lng` (las coordenadas
    del mensaje "[el cliente compartió su ubicación: LAT, LNG]"): con
    ubicación, el negocio puede resolver la zona por el área dibujada en
    el mapa aunque no haya CP. Si tienes ambos, pasa ambos.
    """
    if denied := _require_scope(runtime, "recordar_direccion_entrega"):
        return _tool_reply(runtime, _fail(denied))
    cp = postalCode.strip()
    # T-SHIP-07: la ubicación compartida (lat/lng) también vale como
    # dirección de entrega cuando el negocio tiene zonas dibujadas en el
    # mapa. Con ubicación válida el CP puede faltar; sin ubicación, el CP
    # sigue siendo obligatorio y de 4-5 dígitos.
    point = _parse_point(lat, lng)
    if cp and not (4 <= len(cp) <= 5 and cp.isdigit()):
        return _tool_reply(
            runtime,
            _fail(
                "postalCode debe ser 4-5 dígitos. Pídele al cliente que lo confirme."
            ),
        )
    if not cp and not point:
        return _tool_reply(
            runtime,
            _fail(
                "Necesito el CP (4-5 dígitos) o la ubicación compartida (lat y lng) "
                "para guardar la dirección. Pídeselo al cliente."
            ),
        )
    address: dict[str, Any] = {
        "postalCode": cp,
        "city": clamp_text(city, 80, collapse_newlines=True),
        "state": clamp_text(state, 80, collapse_newlines=True),
        "line1": clamp_text(line1, 200, collapse_newlines=True),
        "line2": clamp_text(line2, 200, collapse_newlines=True),
        "notes": clamp_text(notes, 200, collapse_newlines=True),
        "savedAt": "now",
    }
    # Limpia vacíos para no guardar strings vacíos en el checkpoint.
    address = {k: v for k, v in address.items() if v}
    if point:
        address["lat"], address["lng"] = point
    summary_parts = [cp] if cp else []
    if city.strip():
        summary_parts.append(city.strip())
    if state.strip():
        summary_parts.append(state.strip())
    if point:
        summary_parts.append(f"ubicación {point[0]:.5f}, {point[1]:.5f}")
    return _tool_reply(
        runtime,
        f"Dirección guardada: {', '.join(summary_parts)}. "
        "La usaré para calcular el envío y la cotizaré en el PDF.",
        update={"delivery_address": address},
    )


@tool
async def limpiar_direccion_entrega(runtime: ToolRuntime) -> Command:
    """Borra la dirección guardada (T-SHIP-04).

    Úsala cuando el cliente rectifica una dirección anterior: "perdón,
    era para otro domicilio" / "cambié a esta otra". Sin esto, los
    totales de envío a domicilio seguirían usando la vieja.
    """
    if denied := _require_scope(runtime, "limpiar_direccion_entrega"):
        return _tool_reply(runtime, _fail(denied))
    return _tool_reply(
        runtime,
        "Dirección olvidada. Pídele la nueva al cliente cuando cotices a domicilio.",
        update={"delivery_address": None},
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
    quote_only = _checkout_mode(runtime) == "quote_only"
    if record.get("quoteId") and record.get("quoteSignature") == _cart_signature(lines):
        if quote_only:
            payment_hint = f"Sin enlace de pago (solo cotización). Cierra con: {_quote_only_closing(runtime)}"
        elif record.get("checkoutLink"):
            payment_hint = f"Su enlace de pago: {record['checkoutLink']}."
        else:
            payment_hint = "Si el cliente quiere pagar, usa generar_enlace_pago."
        return _tool_reply(
            runtime,
            f"Ya existe la cotización {record['quoteId']} para este carrito: "
            f"{record.get('quoteLink')}. Compártela en vez de emitir otra. "
            + payment_hint
            + ref,
        )

    ctx = _ctx(runtime)
    customer: CustomerFacts = {**(runtime.state.get("customer") or {}), **_pending_customer_facts(runtime)}
    client = _client(runtime)

    # T-CRM-01: toda cotización necesita el nombre real del cliente para que
    # la base de clientes quede completa. No es negociable por configuración
    # de tenant: sin nombre, la herramienta se niega y pide al modelo que lo
    # consiga en el mensaje anterior de preguntar, en vez de emitir con el
    # placeholder "Cliente de WhatsApp" (eso es lo que dejaba la BD incompleta).
    full_name = (customer.get("name") or ctx.get("customer_name") or "").strip()
    if is_placeholder_name(full_name):
        return _tool_reply(
            runtime,
            _fail(
                "Aún no tienes el nombre del cliente. Pídeselo primero (¿A nombre de "
                "quién genero la cotización?) y vuelve a llamar a esta herramienta "
                "cuando lo tengas; no emitas la cotización sin él."
            ),
        )

    phone, email = await _quote_identifiers(client, runtime, customer)
    created, error = await _safe(
        client.ensure_customer(
            full_name=full_name,
            phone=phone,
            email=email,
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
    #
    # En `quote_only` no se crea pedido ni checkout: la cotización es el
    # final del flujo del bot y el pago se acuerda fuera del chat. Así el
    # enlace público de la cotización tampoco trae un checkout abierto.
    order: dict[str, Any] | None = None
    checkout_link: str | None = None
    if not quote_only:
        order, order_error = await _safe(client.order_from_quote(quote["id"]))
        if not order_error and order:
            checkout, checkout_error = await _safe(
                client.start_checkout(
                    order["id"], lines=_lines_payload(lines), delivery_mode=_delivery_mode(runtime, record)
                )
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
    if quote_only:
        lines_out.append(
            "Sin enlace de pago (modo solo cotización): no lo prometas ni lo menciones. "
            f"Cierra con este mensaje, con tus palabras: {_quote_only_closing(runtime)}"
        )
    else:
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

    Funciona para las cotizaciones de ESTE cliente, estén o no entre los
    carritos abiertos de esta conversación (por ejemplo una de hace unos
    días por el mismo WhatsApp): consulta el folio real en el backend. Un
    folio de otro cliente responde como si no existiera.
    """
    if denied := _require_scope(runtime, "detalle_de_cotizacion"):
        return _fail(denied)
    client = _client(runtime)
    quote, error = await _safe(client.get_quote(clamp_text(quoteId, 100, collapse_newlines=True)))
    if _is_not_found(error):
        return _NOT_IN_CONVERSATION_QUOTE
    if error:
        return _fail(error)
    if not quote or not await _owned_by_conversation(client, runtime, quote, kind="quote"):
        return _NOT_IN_CONVERSATION_QUOTE
    lines = "; ".join(
        f"{line.get('quantity')} x {clamp_text(line.get('title') or '', 200, collapse_newlines=True)} "
        f"(${line.get('unitPrice')})"
        for line in (quote or {}).get("lines", [])
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
        payment_hint = (
            "Sin enlace de pago (solo cotización)."
            if _checkout_mode(runtime) == "quote_only"
            else f"Enlace de pago: {record.get('checkoutLink') or 'usa generar_enlace_pago'}"
        )
        return _tool_reply(
            runtime,
            f"Ya hay un pedido para esta cotización: {record['orderId']}. {payment_hint}{ref}",
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
async def generar_enlace_pago(runtime: ToolRuntime, deliveryMode: str = "", carritoId: str = "") -> Command:
    """Genera el enlace de pago del pedido vigente de UN carrito.

    El backend arma la URL. `deliveryMode` vacío = el mismo que usaste en
    calcular_total para ese carrito (o el por defecto del negocio).
    `carritoId` vacío = el carrito activo.
    """
    if denied := _require_scope(runtime, "generar_enlace_pago"):
        return _tool_reply(runtime, _fail(denied))
    # Política del admin, no del modelo: en `quote_only` esta herramienta
    # no existe en la práctica. Se niega antes de tocar el backend para que
    # nunca quede un checkout abierto que el enlace público pudiera mostrar.
    if _checkout_mode(runtime) == "quote_only":
        return _tool_reply(
            runtime,
            _fail(f"{_QUOTE_ONLY_DENIED} Mensaje de seguimiento: {_quote_only_closing(runtime)}"),
        )
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

    mode = _delivery_mode(runtime, record, deliveryMode)
    checkout, error = await _safe(
        _client(runtime).start_checkout(order_id, lines=_lines_payload(lines), delivery_mode=mode)
    )
    if error:
        return _tool_reply(runtime, _fail(error))
    link = (checkout or {}).get("checkoutUrl")
    if not link:
        return _tool_reply(runtime, _fail("El backend no devolvió enlace de pago."))
    return _tool_reply(
        runtime,
        f"Enlace de pago listo: {link}{ref}",
        update={
            "carts": {cart_id: {"checkoutLink": link, "deliveryMode": mode, "stage": "PAGO_ENVIADO"}},
            "active_cart_id": cart_id,
        },
    )


@tool
async def estado_del_pedido(runtime: ToolRuntime, orderId: str = "", carritoId: str = "") -> str:
    """Estado real del pedido y de su pago.

    Úsala siempre que el cliente diga que ya pagó: no confíes en su palabra.
    Si el cliente da el número de pedido, pásalo en `orderId` (funciona
    para pedidos de ESTE cliente aunque no sean de un carrito abierto en
    esta conversación); si no, se usa el pedido del carrito activo (o de
    `carritoId` si lo indicas). Un pedido de otro cliente responde como si
    no existiera.
    """
    if denied := _require_scope(runtime, "estado_del_pedido"):
        return _fail(denied)
    cart_id = _resolve_cart_id(runtime, carritoId)
    target, _owner = _resolve_order_id(runtime, orderId, cart_id)
    if not target:
        return _fail("No tengo número de pedido; pídeselo al cliente o dime a cuál pedido te refieres.")
    client = _client(runtime)
    order, error = await _safe(client.get_order(target))
    if _is_not_found(error):
        return _NOT_IN_CONVERSATION_ORDER
    if error:
        return _fail(error)
    if not order or not await _owned_by_conversation(client, runtime, order, kind="order"):
        return _NOT_IN_CONVERSATION_ORDER
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
    if nombre and is_placeholder_name(nombre):
        return _tool_reply(
            runtime,
            _fail(
                f"'{nombre}' no es un nombre real; no lo guardo. Pídele al cliente su "
                "nombre y vuelve a llamar recordar_cliente cuando lo diga."
            ),
        )
    if nombre:
        facts["name"] = nombre
    if correo and "@" in correo:
        facts["email"] = correo
    note = ""
    channel_phone = _channel_phone(runtime)
    if telefono and channel_phone:
        # En WhatsApp el teléfono del cliente es el del chat, autenticado por
        # el canal: lo que diga el cliente no lo reemplaza (si no, "mi
        # teléfono es 55…" apuntaría las búsquedas a la ficha de otra persona).
        facts["phone"] = channel_phone
        if not same_phone(telefono, channel_phone):
            note = (
                " (el teléfono de este cliente es el de este chat; no lo cambio. Si da "
                "otro número de contacto, anótalo solo como referencia en la conversación)"
            )
    elif telefono:
        facts["phone"] = telefono
    if not facts:
        return _tool_reply(runtime, _fail("No recibí ningún dato válido que guardar."))
    return _tool_reply(
        runtime,
        "Guardado: " + ", ".join(f"{k}={v}" for k, v in facts.items()) + note,
        update={"customer": facts},
    )


@tool
async def historial_del_cliente(runtime: ToolRuntime) -> str:
    """Cotizaciones y pedidos anteriores del cliente de esta conversación.

    Úsala cuando pregunte por "mi cotización", "lo que pedí la otra vez" o
    quiera repetir una compra. Solo funciona por WhatsApp: busca por el
    número desde el que escribe el cliente (nunca por un teléfono, correo o
    nombre que diga en el chat).
    """
    if denied := _require_scope(runtime, "historial_del_cliente"):
        return _fail(denied)
    # Única llave: el teléfono autenticado por el canal (runtime.context).
    # Nunca `state.customer` (lo escribe recordar_cliente con lo que dice el
    # cliente) ni correo/nombre: con eso cualquiera leía la ficha de otro.
    if not _channel_phone(runtime):
        return (
            "No puedo consultar compras anteriores en este canal: el historial solo se "
            "consulta por el WhatsApp del propio cliente. No pidas teléfono ni correo para "
            "buscarlo; si necesita algo de un pedido anterior, ofrécele pasar con una "
            "persona del equipo (escalar_a_humano)."
        )

    client = _client(runtime)
    found, error = await _safe(_channel_customer(client, runtime))
    if error:
        return _fail(error)
    if not found:
        return "No hay compras anteriores registradas con el número de este chat."

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
        vence = f", vence {q['expiresAt']}" if q.get("expiresAt") else ""
        parts.append(
            f"  cotización {str(q['id'])[:8]} — ${q['total']} — {q['status']} — creada {q['createdAt']}{vence}"
        )
    for o in orders:
        parts.append(f"  pedido {str(o['id'])[:8]} — ${o['total']} — {o['status']} — creado {o['createdAt']}")
    return "\n".join(parts)


@tool
async def solicitar_factura(
    orderId: str,
    usoCfdi: str,
    runtime: ToolRuntime,
    rfc: str = "",
    razonSocial: str = "",
    codigoPostal: str = "",
    constanciaUrl: str = "",
    carritoId: str = "",
) -> str:
    """Pide factura (CFDI) para un pedido ya identificado.

    Dos caminos para los datos fiscales (RFC, razón social, código postal,
    régimen) — NUNCA los inventes por tu cuenta:

    1. **Constancia (preferido).** Si el cliente tiene su constancia de
       situación fiscal y te pasa un enlace público a ella (o la subió por
       el link de pago y te comparte esa URL), ponla en `constanciaUrl` y
       deja `rfc`/`razonSocial`/`codigoPostal` vacíos — el backend la lee y
       llena esos datos solo. Dile al cliente que puede subirla en el link
       de pago si no tiene un enlace a la mano; es más rápido que dictarlos.
    2. **Dictado.** Si no la tiene, pide los 4 datos y SOLO llama esto
       después de que el cliente confirme explícitamente que sí a lo que le
       leíste de vuelta. Si `historial_del_cliente` ya mostró datos fiscales
       guardados de una compra anterior, léeselos primero y pregunta si son
       los mismos — nunca los reuses en silencio.

    `usoCfdi` (ej. G03, P01) SIEMPRE hay que pedirlo: ningún documento lo
    trae, lo decide el cliente en cada compra.

    Si el cliente lleva varios pedidos a la vez, pasa `orderId` (o
    `carritoId`) para facturar el que corresponde; nunca adivines cuál si
    hay más de uno y no lo dijo.

    La respuesta puede traer un aviso de que la constancia no se pudo leer
    del todo (`parseWarnings`) — si pasa, pide al cliente los datos que
    falten a mano en vez de dejarlos vacíos.
    """
    if denied := _require_scope(runtime, "solicitar_factura"):
        return _fail(denied)
    cart_id = _resolve_cart_id(runtime, carritoId)
    order_id, _owner = _resolve_order_id(runtime, orderId, cart_id)
    if not order_id:
        return _fail("No tengo número de pedido; pídeselo al cliente o usa historial_del_cliente.")

    cfdi_clean = clamp_text(usoCfdi, 10, collapse_newlines=True).upper().strip()
    if not re.fullmatch(r"[A-Z]\d{2}", cfdi_clean):
        return _fail("Uso de CFDI inválido (ej. G03, P01); confírmalo con el cliente.")
    constancia_clean = clamp_text(constanciaUrl, 2000, collapse_newlines=True).strip()

    rfc_clean = clamp_text(rfc, 20, collapse_newlines=True).upper().strip()
    if rfc_clean and not re.fullmatch(r"[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}", rfc_clean):
        return _fail("Ese RFC no tiene un formato válido; pídeselo de nuevo al cliente.")
    cp_clean = clamp_text(codigoPostal, 10, collapse_newlines=True).strip()
    if cp_clean and not re.fullmatch(r"\d{5}", cp_clean):
        return _fail("El código postal debe ser de 5 dígitos.")
    razon_clean = clamp_text(razonSocial, 200, collapse_newlines=True).strip()
    if not constancia_clean and not (rfc_clean and razon_clean and cp_clean):
        return _fail(
            "Faltan datos fiscales: pide RFC, razón social y código postal, o la constancia de situación fiscal."
        )

    # Mismo criterio que estado_del_pedido: no se factura (ni se escribe el
    # RFC) sobre el pedido de otro cliente del negocio.
    client = _client(runtime)
    order, error = await _safe(client.get_order(order_id))
    if _is_not_found(error) or (
        not error and (not order or not await _owned_by_conversation(client, runtime, order, kind="order"))
    ):
        return _NOT_IN_CONVERSATION_ORDER
    if error:
        return _fail(error)

    invoice, error = await _safe(
        client.request_invoice(
            order_id,
            cfdi_use=cfdi_clean,
            rfc=rfc_clean or None,
            legal_name=razon_clean or None,
            postal_code=cp_clean or None,
            constancia_url=constancia_clean or None,
        )
    )
    if error:
        return _fail(error)
    invoice = invoice or {}
    # Los 3 datos que de verdad importan salen de lo que el backend GUARDÓ
    # (invoiceRfc/...), no de lo que este turno mandó: con constancia,
    # `rfc_clean`/`razon_clean`/`cp_clean` locales pueden venir vacíos.
    saved_rfc = invoice.get("invoiceRfc") or rfc_clean or "?"
    saved_razon = invoice.get("invoiceLegalName") or razon_clean or "?"
    saved_cp = invoice.get("invoicePostalCode") or cp_clean or "?"
    tiene_constancia = bool(invoice.get("invoiceConstanciaUrl"))
    warnings = invoice.get("parseWarnings") or []
    aviso = ""
    if warnings:
        # No fatal — la solicitud SÍ se guardó (si no, hubiera regresado
        # error arriba); esto es solo lo que la constancia no trajo.
        aviso = " La constancia no trajo todo: " + "; ".join(warnings) + "."
    return (
        f"Factura solicitada para el pedido {order_id}. "
        f"RFC {saved_rfc}, razón social {saved_razon}, CP {saved_cp}, uso CFDI {cfdi_clean}."
        + (" Constancia recibida." if tiene_constancia else " Sin constancia adjunta.")
        + aviso
    )


@tool
async def escalar_a_humano(motivo: str, runtime: ToolRuntime, resumen: str = "") -> Command:
    """Pasa la conversación a una persona del equipo.

    Motivos: CLIENTE_LO_PIDE, FUERA_DE_CONOCIMIENTO, QUEJA, PRECIO_ESPECIAL,
    CREDITO, ERROR_TECNICO. `resumen`: una línea con lo que el cliente
    necesita, para quien tome la conversación.
    """
    if denied := _require_scope(runtime, "escalar_a_humano"):
        return _tool_reply(runtime, _fail(denied))
    motivo = clamp_text(motivo, 80, collapse_newlines=True).strip().upper() or "CLIENTE_LO_PIDE"
    if motivo in _NO_HANDOFF_REASONS:
        # Un error de herramienta no es motivo para dejar al cliente en manos
        # de una persona: el bot debe reintentar y seguir vendiendo. Solo el
        # cliente (queja, pedir humano) o una condición comercial que el bot
        # no negocia (crédito, precio especial) justifican el handoff.
        return _tool_reply(
            runtime,
            _fail(
                "No escales por un error técnico. Dile al cliente en una línea que "
                "en un momento se lo reintentas y sigue atendiendo; vuelve a "
                "llamar la herramienta que falló en el siguiente mensaje."
            ),
        )
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
    calcular_unidades_para_cubrir,
    validar_zona_de_envio,
    recordar_direccion_entrega,
    limpiar_direccion_entrega,
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
