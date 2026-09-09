"""Tool gateway del agente (T-AIA-04).

Reglas duras:
  - Allowlist cerrada: lo que no está declarado aquí no se ejecuta.
  - Cada tool exige un scope; el principal viene de la API key de servicio,
    nunca del modelo ni del mensaje del cliente.
  - El modelo jamás construye URLs ni importes: recibe `linkRef` y totales
    calculados por el backend.
  - Los comandos con efecto llevan `commandId`; repetirlo no duplica.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from .commerce import CommerceClient, CommerceError, CommerceUnavailable
from .knowledge import KnowledgeBase
from .matching import CatalogVariant, decide
from .text import format_quantity as _format_quantity


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    scope: str
    parameters: dict[str, Any]
    mutating: bool = False

    def to_openai_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


def _obj(props: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": props,
        "required": required or [],
        "additionalProperties": False,
    }


TOOLS: dict[str, ToolSpec] = {
    "answer_business_question": ToolSpec(
        name="answer_business_question",
        description=(
            "Consulta la base de conocimiento del negocio (horarios, envíos, pagos, "
            "garantías, facturación, políticas). Úsala SIEMPRE antes de responder "
            "cualquier pregunta sobre cómo trabaja el negocio."
        ),
        scope="chat.read",
        parameters=_obj(
            {"question": {"type": "string", "description": "Pregunta del cliente, tal cual"}},
            ["question"],
        ),
    ),
    "search_products": ToolSpec(
        name="search_products",
        description=(
            "Busca variantes en el catálogo del negocio y devuelve candidatos con "
            "evidencia, precio de lista y existencia. Nunca inventes productos."
        ),
        scope="catalog.read",
        parameters=_obj(
            {
                "query": {"type": "string", "description": "Lo que pide el cliente"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20},
            },
            ["query"],
        ),
    ),
    "get_variant": ToolSpec(
        name="get_variant",
        description="Detalle de una variante por id, con precio de lista vigente.",
        scope="catalog.read",
        parameters=_obj({"variantId": {"type": "string"}}, ["variantId"]),
    ),
    "availability": ToolSpec(
        name="availability",
        description="Existencia de una variante para una cantidad. No reserva stock.",
        scope="catalog.read",
        parameters=_obj(
            {"variantId": {"type": "string"}, "quantity": {"type": "string"}},
            ["variantId", "quantity"],
        ),
    ),
    "calculate_quote": ToolSpec(
        name="calculate_quote",
        description=(
            "Calculadora oficial: totaliza líneas con impuestos, descuentos y envío. "
            "Es la ÚNICA fuente de importes. No crea la cotización."
        ),
        scope="quotes.read",
        parameters=_obj(
            {
                "lines": {
                    "type": "array",
                    "items": _obj(
                        {
                            "variantId": {"type": "string"},
                            "quantity": {"type": "string"},
                            "discountPct": {"type": "number"},
                        },
                        ["variantId", "quantity"],
                    ),
                },
                "deliveryMode": {"type": "string", "enum": ["PICKUP", "LOCAL_DELIVERY"]},
            },
            ["lines"],
        ),
    ),
    "create_and_issue_quote": ToolSpec(
        name="create_and_issue_quote",
        description=(
            "Crea y emite la cotización con las líneas ya confirmadas por el cliente. "
            "Devuelve folio, total y enlace público. Requiere confirmación explícita."
        ),
        scope="quotes.write",
        parameters=_obj(
            {
                "lines": {
                    "type": "array",
                    "items": _obj(
                        {
                            "variantId": {"type": "string"},
                            "quantity": {"type": "string"},
                            "discountPct": {"type": "number"},
                        },
                        ["variantId", "quantity"],
                    ),
                },
                "customerName": {"type": "string"},
                "customerPhone": {"type": "string"},
                "customerEmail": {"type": "string"},
                "notes": {"type": "string"},
            },
            ["lines", "customerName"],
        ),
        mutating=True,
    ),
    "accept_quote": ToolSpec(
        name="accept_quote",
        description=(
            "Convierte una cotización aceptada en pedido. Solo con confirmación "
            "explícita del cliente en el mensaje actual."
        ),
        scope="orders.write",
        parameters=_obj({"quoteId": {"type": "string"}}, ["quoteId"]),
        mutating=True,
    ),
    "get_checkout_link": ToolSpec(
        name="get_checkout_link",
        description=(
            "Genera el enlace de pago del pedido. El backend arma la URL. "
            "Si conoces las líneas, pásalas en `lines`; si no, el gateway las "
            "deriva del carrito/quote en estado."
        ),
        scope="orders.write",
        parameters=_obj(
            {
                "orderId": {"type": "string"},
                "deliveryMode": {"type": "string", "enum": ["PICKUP", "LOCAL_DELIVERY"]},
                "lines": {
                    "type": "array",
                    "items": _obj(
                        {
                            "variantId": {"type": "string"},
                            "quantity": {"type": "string"},
                        },
                        ["variantId", "quantity"],
                    ),
                },
            },
            ["orderId"],
        ),
        mutating=True,
    ),
    "get_order_status": ToolSpec(
        name="get_order_status",
        description=(
            "Estado real del pedido y de su pago. Úsala siempre que el cliente diga "
            "que ya pagó o pregunte por su pedido; no confíes en su afirmación."
        ),
        scope="orders.read",
        parameters=_obj({"orderId": {"type": "string"}}, ["orderId"]),
    ),
    "request_human": ToolSpec(
        name="request_human",
        description="Transfiere la conversación a una persona del equipo.",
        scope="chat.write",
        parameters=_obj(
            {
                "reason": {
                    "type": "string",
                    "enum": [
                        "CLIENTE_LO_PIDE",
                        "FUERA_DE_CONOCIMIENTO",
                        "QUEJA",
                        "PRECIO_ESPECIAL",
                        "CREDITO",
                        "ERROR_TECNICO",
                    ],
                },
                "summary": {"type": "string"},
            },
            ["reason", "summary"],
        ),
        mutating=True,
    ),
}


@dataclass
class ToolCallRecord:
    name: str
    args: dict[str, Any]
    ok: bool
    result: dict[str, Any]
    latency_ms: int
    command_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "tool": self.name,
            "args": self.args,
            "ok": self.ok,
            "result": self.result,
            "latencyMs": self.latency_ms,
            "commandId": self.command_id,
        }


class ToolGateway:
    """Ejecuta tools con scopes, presupuesto e idempotencia por comando."""

    def __init__(
        self,
        *,
        scopes: set[str],
        commerce: CommerceClient,
        knowledge: KnowledgeBase,
        catalog_cache: list[CatalogVariant] | None = None,
        max_steps: int = 8,
        command_log: dict[str, dict[str, Any]] | None = None,
        state: Any | None = None,
    ) -> None:
        self.state = state
        self.scopes = scopes
        self.commerce = commerce
        self.knowledge = knowledge
        self.catalog_cache: list[CatalogVariant] = catalog_cache or []
        self._catalog_snapshots: list[list[CatalogVariant]] = []
        if catalog_cache:
            self._catalog_snapshots.append(list(catalog_cache))
        self.max_steps = max_steps
        self.steps_used = 0
        self.command_log = command_log if command_log is not None else {}
        self.calls: list[ToolCallRecord] = []

    # ---------- control de acceso ----------

    def available(self) -> list[ToolSpec]:
        return [spec for spec in TOOLS.values() if spec.scope in self.scopes]

    def can_call(self, name: str) -> bool:
        spec = TOOLS.get(name)
        return bool(spec and spec.scope in self.scopes)

    def schemas(self) -> list[dict[str, Any]]:
        return [spec.to_openai_schema() for spec in self.available()]

    # ---------- despacho ----------

    async def dispatch(
        self, name: str, args: dict[str, Any], *, command_id: str | None = None
    ) -> dict[str, Any]:
        started = time.perf_counter()
        spec = TOOLS.get(name)
        if spec is None:
            return self._record(name, args, False, {"error": "TOOL_NOT_ALLOWED",
                                                    "message": f"Tool no permitida: {name}"}, started)
        if not self.can_call(name):
            return self._record(name, args, False, {"error": "FORBIDDEN",
                                                    "message": f"Falta scope {spec.scope}"}, started)
        if self.steps_used >= self.max_steps:
            return self._record(name, args, False, {"error": "BUDGET_EXHAUSTED",
                                                    "message": "Presupuesto de herramientas agotado"}, started)

        # Idempotencia: un commandId repetido devuelve el resultado anterior.
        if spec.mutating and command_id and command_id in self.command_log:
            cached = self.command_log[command_id]
            return self._record(name, args, True, {**cached, "replayed": True}, started, command_id)

        self.steps_used += 1
        handler = self._handlers().get(name)
        assert handler is not None, f"handler faltante para {name}"
        try:
            result = await handler(args)
            ok = True
        except CommerceUnavailable as exc:
            result, ok = {"error": "COMMERCE_OFFLINE", "message": str(exc)}, False
        except CommerceError as exc:
            result, ok = {"error": exc.code, "message": exc.message}, False
        except (KeyError, ValueError, TypeError) as exc:
            result, ok = {"error": "BAD_ARGS", "message": str(exc)}, False

        if ok and spec.mutating and command_id:
            self.command_log[command_id] = result
        return self._record(name, args, ok, result, started, command_id)

    def _record(
        self,
        name: str,
        args: dict[str, Any],
        ok: bool,
        result: dict[str, Any],
        started: float,
        command_id: str | None = None,
    ) -> dict[str, Any]:
        record = ToolCallRecord(
            name=name,
            args=args,
            ok=ok,
            result=result,
            latency_ms=int((time.perf_counter() - started) * 1000),
            command_id=command_id,
        )
        self.calls.append(record)
        return result

    # ---------- implementaciones ----------

    def _handlers(self) -> dict[str, Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]]:
        return {
            "answer_business_question": self._answer_business_question,
            "search_products": self._search_products,
            "get_variant": self._get_variant,
            "availability": self._availability,
            "calculate_quote": self._calculate_quote,
            "create_and_issue_quote": self._create_and_issue_quote,
            "accept_quote": self._accept_quote,
            "get_checkout_link": self._get_checkout_link,
            "get_order_status": self._get_order_status,
            "request_human": self._request_human,
        }

    async def _answer_business_question(self, args: dict[str, Any]) -> dict[str, Any]:
        question = str(args["question"])
        hits = self.knowledge.search(question, top_k=4)
        return {
            "found": bool(hits),
            "sections": [h.to_dict() for h in hits],
            "profile": self.knowledge.profile.to_dict(),
        }

    async def _load_catalog(self, query: str | None = None) -> list[CatalogVariant]:
        if self.commerce.live:
            # El matching real (trigrama + léxico + sinónimos) vive en matching.py.
            # El backend solo hace `contains` por substring, así que frases
            # largas ("dame el original 500") devuelven 0 y bloquean la
            # búsqueda. Pedimos el catálogo completo y decidimos del lado del
            # agente, que es el que sabe explicar.
            variants = await self.commerce.search_products(None, limit=50)
            if variants:
                self.catalog_cache = variants
                self._catalog_snapshots.append(list(variants))
            return variants
        return self.catalog_cache

    async def _search_products(self, args: dict[str, Any]) -> dict[str, Any]:
        query = str(args["query"])
        catalog = await self._load_catalog(query)
        decision = decide(query, catalog, top_k=int(args.get("limit", 3) or 3))
        payload = decision.to_dict()
        payload["catalogSize"] = len(catalog)
        payload["source"] = "backend" if self.commerce.live else "payload"
        return payload

    def _find_cached(self, variant_id: str) -> CatalogVariant | None:
        return next((v for v in self.catalog_cache if v.id == variant_id), None)

    async def _get_variant(self, args: dict[str, Any]) -> dict[str, Any]:
        variant_id = str(args["variantId"])
        cached = self._find_cached(variant_id)
        if cached is None and self.commerce.live:
            await self._load_catalog()
            cached = self._find_cached(variant_id)
        if cached is None:
            return {"found": False, "variantId": variant_id}
        return {"found": True, "variant": cached.to_dict()}

    async def _availability(self, args: dict[str, Any]) -> dict[str, Any]:
        variant_id = str(args["variantId"])
        quantity = float(str(args["quantity"]).replace(",", "."))
        detail = await self._get_variant({"variantId": variant_id})
        if not detail.get("found"):
            return {"mode": "UNKNOWN", "available": None, "variantId": variant_id}
        stock = detail["variant"].get("stock")
        if stock is None:
            return {"mode": "UNTRACKED", "available": None, "sufficient": True}
        return {
            "mode": "TRACKED",
            "available": stock,
            "requested": quantity,
            "sufficient": stock >= quantity,
            "asOf": time.time(),
        }

    @staticmethod
    def _clean_lines(raw: Any) -> list[dict[str, Any]]:
        lines: list[dict[str, Any]] = []
        for item in raw or []:
            line = {
                "variantId": str(item["variantId"]),
                "quantity": _format_quantity(item["quantity"]),
            }
            if item.get("discountPct") is not None:
                line["discountPct"] = float(item["discountPct"])
            lines.append(line)
        if not lines:
            raise ValueError("Se requiere al menos una línea")
        return lines

    def _resolve_variant(self, variant_id: str) -> CatalogVariant | None:
        """Busca la variante en caché o recarga el catálogo si hace falta."""
        for variant in self.catalog_cache:
            if variant.id == variant_id:
                return variant
        for candidate in self._catalog_snapshots:
            for variant in candidate:
                if variant.id == variant_id:
                    return variant
        return None

    def _validate_lines(self, lines: list[dict[str, Any]]) -> None:
        """Falla rápido si el modelo inventó un variantId. El LLM reintenta con
        el id real que viene de search_products, en vez de recibir un 500 del
        backend."""
        for line in lines:
            if not self._resolve_variant(line["variantId"]):
                available = ", ".join(
                    f"{v.sku} ({v.id})" for v in self.catalog_cache[:5]
                ) or "catálogo vacío"
                raise ValueError(
                    f"variantId '{line['variantId']}' no existe en el catálogo. "
                    f"Usa uno de los variantId que devolvió search_products: {available}"
                )

    async def _calculate_quote(self, args: dict[str, Any]) -> dict[str, Any]:
        lines = self._clean_lines(args.get("lines"))
        self._validate_lines(lines)
        totals = await self.commerce.price_preview(lines, delivery_mode=args.get("deliveryMode"))
        return {"calculated": True, **(totals or {})}

    async def _create_and_issue_quote(self, args: dict[str, Any]) -> dict[str, Any]:
        lines = self._clean_lines(args.get("lines"))
        self._validate_lines(lines)
        customer = await self.commerce.ensure_customer(
            full_name=str(args.get("customerName") or "Cliente de WhatsApp"),
            phone=args.get("customerPhone"),
            email=args.get("customerEmail"),
        )
        quote = await self.commerce.create_quote(
            customer_id=customer["id"],
            lines=lines,
            notes=args.get("notes"),
            issue=True,
        )
        share = await self.commerce.share_quote(quote["id"])
        return {
            "quoteId": quote["id"],
            "status": quote.get("status"),
            "total": str(quote.get("total")),
            "subtotal": str(quote.get("subtotal")),
            "tax": str(quote.get("tax")),
            "shipping": str(quote.get("shipping")),
            "expiresAt": quote.get("expiresAt"),
            "linkRef": share["url"],
            "customerId": customer["id"],
        }

    async def _accept_quote(self, args: dict[str, Any]) -> dict[str, Any]:
        order = await self.commerce.order_from_quote(str(args["quoteId"]))
        return {
            "orderId": order["id"],
            "status": order.get("status"),
            "total": str(order.get("total")),
        }

    def _state_lines(self) -> list[dict[str, Any]]:
        """Líneas del carrito en estado. El Order no persiste líneas en el
        backend hoy, así que el gateway las recupera del carrito local."""
        state = self.state
        if state is None:
            return []
        cart = getattr(state, "cart", None) or []
        return [
            {"variantId": line.variant_id, "quantity": _format_quantity(line.quantity)}
            for line in cart
            if getattr(line, "variant_id", None)
        ]

    async def _get_checkout_link(self, args: dict[str, Any]) -> dict[str, Any]:
        order = await self.commerce.get_order(str(args["orderId"]))
        raw_lines = args.get("lines")
        if isinstance(raw_lines, list) and raw_lines:
            lines = self._clean_lines(raw_lines)
        else:
            lines = [
                {"variantId": line["variantId"], "quantity": _format_quantity(line["quantity"])}
                for line in (order.get("lines") or [])
                if isinstance(line, dict) and line.get("variantId")
            ]
        if not lines:
            lines = self._state_lines()
        if not lines:
            raise ValueError(
                "El pedido no trae líneas y el carrito en estado está vacío; "
                "pásalas explícitas en get_checkout_link."
            )
        checkout = await self.commerce.start_checkout(
            order["id"],
            lines=lines,
            delivery_mode=str(args.get("deliveryMode") or "PICKUP"),
        )
        return {
            "orderId": order["id"],
            "linkRef": checkout.get("checkoutUrl"),
            "expiresAt": checkout.get("order", {}).get("expiresAt"),
        }

    async def _get_order_status(self, args: dict[str, Any]) -> dict[str, Any]:
        order = await self.commerce.get_order(str(args["orderId"]))
        return {
            "orderId": order["id"],
            "status": order.get("status"),
            "total": str(order.get("total")),
            "paidAt": order.get("paidAt"),
            "placedAt": order.get("placedAt"),
            "livemode": False,
        }

    async def _request_human(self, args: dict[str, Any]) -> dict[str, Any]:
        return {
            "handoff": True,
            "reason": str(args.get("reason", "CLIENTE_LO_PIDE")),
            "summary": str(args.get("summary", ""))[:500],
            "assignedAt": time.time(),
        }
