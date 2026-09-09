"""Orquestador de turnos (T-AIA-01/03/04/06).

Dos motores sobre el mismo grafo y las mismas herramientas:

  * `LLMEngine`      — OpenRouter con tool calling, cuando hay clave y el
                       modelo está registrado con esa capacidad.
  * `RuleEngine`     — motor determinista de respaldo. Conversa, busca,
                       cotiza y escala; sin llamadas a proveedor.

Ambos comparten presupuesto por turno, allowlist de herramientas, estado
persistido y el mismo criterio de handoff. La respuesta al cliente siempre
sale con importes del backend, nunca del modelo.
"""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from .commerce import CommerceClient
from .config import Settings, get_settings
from .knowledge import KnowledgeBase, get_knowledge_base
from .learning import LearningStore, get_learning_store, record_turn_signals
from .matching import CatalogVariant
from .persona import build_system_prompt, format_candidates, pick
from .providers.model_gateway import ChatResult, ModelGateway, ModelUnavailable, get_gateway
from .state import AgentState, CartLine, StateStore, get_store
from .text import normalize, parse_quantity
from .tools import TOOLS, ToolGateway

# ---------------------------------------------------------------
# Detección de intención determinista (es-MX, tolerante a acentos)
# ---------------------------------------------------------------

GREETING = re.compile(r"\b(hola|holi|buenas|buenos dias|buenas tardes|buenas noches|que tal|hey|klk|ola)\b")
THANKS = re.compile(r"\b(gracias|muchas gracias|te pasaste|excelente|perfecto|va|sale)\b")
HUMAN = re.compile(r"\b(humano|persona|asesor|ejecutivo|agente real|hablar con alguien|no me sirves|supervisor)\b")
COMPLAINT = re.compile(r"\b(queja|reclamo|pesimo|malisimo|fraude|estafa|demanda|molesto|enojado)\b")
CONFIRM = re.compile(r"^(si|sip|sí|claro|va|dale|ok|okay|de acuerdo|adelante|hagalo|hazlo|confirmo|correcto|asi es)\b")
DENY = re.compile(r"^(no|nel|nop|todavia no|aun no|espera|cancela)\b")
QUOTE_REQ = re.compile(r"\b(cotiza|cotizacion|cotizar|presupuesto|cuanto (me )?(sale|queda|cuesta)|precio total|total)\b")
PAY_REQ = re.compile(r"\b(pagar|pago|link de pago|liga de pago|checkout|tarjeta|comprar|lo llevo|lo quiero)\b")
ORDER_STATUS = re.compile(r"\b(mi pedido|mi orden|donde va|rastreo|seguimiento|ya llego|estatus|estado del pedido|ya pague|ya pagué)\b")
CATALOG_BROWSE = re.compile(r"\b(que (tienen|venden|manejan)|catalogo|productos|lista de precios|que hay)\b")
# Preguntas de negocio: aquí manda el conocimiento, no el catálogo.
BUSINESS_Q = re.compile(
    r"\b(envio|envios|enviar|entrega|entregan|paqueteria|"
    r"pago|pagos|pagar con|tarjeta|transferencia|paypal|"
    r"factura|facturan|facturacion|cfdi|rfc|"
    r"horario|horarios|abren|cierran|"
    r"sucursal|sucursales|tienda fisica|direccion|donde estan|ubicacion|cedis|"
    r"devolucion|devoluciones|devolver|reembolso|garantia|cambio|"
    r"distribuidor|distribuir|vender|mayoreo|revendedor|"
    r"quienes son|que es|de que esta hecho|ingredientes|azucar|calorias|nutrimental|"
    r"rinde|rendimiento|como se prepara|preparar|caduca|caducidad|"
    r"promocion|promociones|descuento|primera compra|"
    r"certificacion|sqf|contacto|telefono)\b"
)
OPTOUT = re.compile(r"\b(no me escribas|baja|dar de baja|stop|deja de escribir)\b")
ORDINAL = {
    "1": 0, "primero": 0, "primera": 0, "uno": 0, "la uno": 0,
    "2": 1, "segundo": 1, "segunda": 1, "dos": 1,
    "3": 2, "tercero": 2, "tercera": 2, "tres": 2,
}
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


@dataclass
class TurnResult:
    """Salida de un turno, lista para el canal (web o WhatsApp)."""

    reply: str
    state: AgentState
    handoff: bool = False
    intent: str | None = None
    candidates: list[dict[str, Any]] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)
    totals: dict[str, Any] | None = None
    quote: dict[str, Any] | None = None
    checkout: dict[str, Any] | None = None
    knowledge_refs: list[str] = field(default_factory=list)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    engine: str = "rules"
    cost_usd: float = 0.0
    latency_ms: int = 0
    truncated_budget: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "conversationId": self.state.conversation_id,
            "reply": self.reply,
            "handoff": self.handoff,
            "intent": self.intent,
            "candidates": self.candidates,
            "suggestions": self.suggestions,
            "totals": self.totals,
            "quote": self.quote,
            "checkout": self.checkout,
            "knowledgeRefs": self.knowledge_refs,
            "toolCalls": self.tool_calls,
            "engine": self.engine,
            "costUsd": round(self.cost_usd, 6),
            "latencyMs": self.latency_ms,
            "node": self.state.node,
            "cart": [line.to_dict() for line in self.state.cart],
            "budgetExhausted": self.truncated_budget,
        }


class Orchestrator:
    """Punto de entrada del turno: normaliza, decide motor y persiste."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        store: StateStore | None = None,
        knowledge: KnowledgeBase | None = None,
        gateway: ModelGateway | None = None,
        commerce: CommerceClient | None = None,
        learning: LearningStore | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.store = store or get_store()
        self.knowledge = knowledge or get_knowledge_base()
        self.gateway = gateway or get_gateway()
        self.commerce = commerce or CommerceClient(self.settings)
        self.learning = learning or get_learning_store()

    async def handle(
        self,
        *,
        tenant_id: str,
        text: str,
        conversation_id: str | None = None,
        message_id: str | None = None,
        scopes: set[str] | None = None,
        catalog: list[CatalogVariant] | None = None,
        customer_name: str | None = None,
        customer_phone: str | None = None,
        customer_email: str | None = None,
        channel: str = "web",
        image_base64: str | None = None,
    ) -> TurnResult:
        started = time.perf_counter()
        self.knowledge.reload_if_stale()

        state = (
            self.store.get(tenant_id, conversation_id) if conversation_id else None
        ) or self.store.create(tenant_id, conversation_id, channel=channel)

        state.customer_name = customer_name or state.customer_name
        state.customer_phone = customer_phone or state.customer_phone
        state.customer_email = customer_email or state.customer_email

        clean = (text or "").strip()[: self.settings.max_input_chars]
        if not clean:
            return self._finish(
                TurnResult("¿Me repites? No alcancé a leer tu mensaje.", state), started
            )

        # Idempotencia de canal: el mismo messageId no se procesa dos veces.
        if state.already_processed(message_id):
            last = next(
                (m["content"] for m in reversed(state.messages) if m["role"] == "assistant"), ""
            )
            return self._finish(TurnResult(last or "Ya tenía ese mensaje 🙂", state), started)

        # Un humano tomó el control: el bot no vuelve a publicar (T-AIA-06).
        if state.handoff:
            state.add_message("user", clean, messageId=message_id)
            state.mark_processed(message_id)
            self.store.save(state)
            return self._finish(
                TurnResult(
                    "",
                    state,
                    handoff=True,
                    intent="HUMAN_ACTIVE",
                    engine="handoff",
                ),
                started,
            )

        state.add_message("user", clean, messageId=message_id)
        state.mark_processed(message_id)
        state.turns += 1
        state.node = "NORMALIZED"

        tools = ToolGateway(
            scopes=scopes or set(),
            commerce=self.commerce,
            knowledge=self.knowledge,
            catalog_cache=catalog or [],
            max_steps=self.settings.max_tool_steps,
            command_log=state.command_log,
            state=state,
        )

        over_budget = state.cost_usd >= self.settings.max_cost_usd_per_conversation
        use_llm = self.gateway.supports_tools() and not over_budget

        if image_base64 and not use_llm:
            # El motor determinista no puede "ver": sin LLM no hay forma
            # honesta de interpretar la imagen.
            result = TurnResult(
                "Me llegó tu imagen, pero ahorita no puedo verla desde aquí. "
                "¿Me dices qué producto es o su nombre/SKU para cotizarlo?",
                state,
                intent="OTHER",
            )
        elif use_llm:
            try:
                result = await LLMEngine(self, tools).run(state, clean, image_base64=image_base64)
            except ModelUnavailable:
                result = await RuleEngine(self, tools).run(state, clean)
                result.engine = "rules-fallback"
        else:
            result = await RuleEngine(self, tools).run(state, clean)
            if over_budget:
                result.truncated_budget = True

        if result.reply:
            state.add_message("assistant", result.reply)
        state.maybe_summarize(self.settings.summarize_after)
        state.cost_usd += result.cost_usd
        state.tools_called.extend(call.to_dict() for call in tools.calls)
        state.tools_called = state.tools_called[-40:]
        result.tool_calls = [call.to_dict() for call in tools.calls]
        if result.handoff:
            state.handoff = True
            state.control_version += 1
            state.node = "HUMAN_REQUIRED"
        self.store.save(state)
        record_turn_signals(
            self.learning,
            tenant_id=tenant_id,
            conversation_id=state.conversation_id,
            tool_calls=tools.calls,
            handoff=result.handoff,
            handoff_reason=state.handoff_reason,
        )
        return self._finish(result, started)

    @staticmethod
    def _finish(result: TurnResult, started: float) -> TurnResult:
        result.latency_ms = int((time.perf_counter() - started) * 1000)
        return result


# ===============================================================
# Motor determinista
# ===============================================================


class RuleEngine:
    """Conversa sin LLM: intención por reglas, herramientas reales."""

    def __init__(self, orchestrator: Orchestrator, tools: ToolGateway) -> None:
        self.o = orchestrator
        self.tools = tools
        self.kb = orchestrator.knowledge
        self.profile = orchestrator.knowledge.profile

    async def run(self, state: AgentState, text: str) -> TurnResult:
        norm = normalize(text)
        seed = f"{state.conversation_id}:{state.turns}"

        if OPTOUT.search(norm):
            state.node = "OPTOUT"
            return TurnResult(
                "Listo, no te vuelvo a escribir por aquí. Si cambias de opinión, aquí ando.",
                state,
                intent="OPTOUT",
            )

        if HUMAN.search(norm) or COMPLAINT.search(norm):
            reason = "QUEJA" if COMPLAINT.search(norm) else "CLIENTE_LO_PIDE"
            await self.tools.dispatch(
                "request_human",
                {"reason": reason, "summary": text[:200]},
                command_id=f"{state.conversation_id}:human:{state.turns}",
            )
            state.handoff_reason = reason
            return TurnResult(
                pick("handoff", seed), state, handoff=True, intent="HUMAN"
            )

        # 1) Slot de nombre pendiente: el texto libre es el nombre del cliente.
        if "nombre" in state.pending_slots and not CONFIRM.match(norm.strip()):
            state.customer_name = text.strip()[:120]
            state.pending_slots = []
            return await self._issue_quote(state, seed)

        # 2) Selección de una opción mostrada antes ("el 2", "la segunda").
        selected = self._resolve_selection(state, norm)
        if selected is not None:
            candidate, ordinal = selected
            return await self._on_selection(state, candidate, text, seed, ordinal_used=ordinal)

        # 3) Estado de pedido / "ya pagué".
        if ORDER_STATUS.search(norm):
            return await self._order_status(state, text, seed)

        # 4) Confirmación afirmativa sobre algo pendiente.
        if CONFIRM.match(norm.strip()):
            return await self._on_confirm(state, text, seed)

        if DENY.match(norm.strip()) and state.pending_slots:
            state.pending_slots = []
            return TurnResult(
                "Va, lo dejamos así. ¿Te muestro otra cosa?", state, intent="CHANGE_REQUEST",
                suggestions=["Ver otros productos", "Hablar con una persona"],
            )

        # 5) Pago del carrito o de la cotización vigente.
        if PAY_REQ.search(norm) and (state.quote_id or state.cart):
            return await self._to_payment(state, seed)

        # 6) Cotización explícita.
        if QUOTE_REQ.search(norm) and state.cart:
            return await self._quote_flow(state, text, seed)

        # 7) Cantidad suelta cuando ya hay producto elegido.
        quantity, unit, _ = parse_quantity(text)
        if quantity and state.cart and "cantidad" in state.pending_slots:
            state.cart[-1].quantity = quantity
            state.cart[-1].unit = unit or state.cart[-1].unit
            state.pending_slots = [s for s in state.pending_slots if s != "cantidad"]
            return await self._quote_flow(state, text, seed)

        # 8) Pregunta del negocio explícita: el conocimiento manda.
        if BUSINESS_Q.search(norm):
            knowledge_answer = await self._business_answer(state, text, norm, seed)
            if knowledge_answer is not None:
                return knowledge_answer

        if CATALOG_BROWSE.search(norm):
            browse = await self._browse_catalog(state, seed)
            if browse is not None:
                return browse

        # 9) Búsqueda de producto; el catálogo tiene prioridad sobre el
        #    documento cuando el cliente describe algo que se vende.
        if self._looks_like_product_query(norm):
            search = await self._search_flow(state, text, seed)
            if search.candidates or search.handoff or state.cart:
                return search

        # 10) Sin producto: intentar el conocimiento del negocio igualmente.
        knowledge_answer = await self._business_answer(state, text, norm, seed)
        if knowledge_answer is not None:
            return knowledge_answer

        # 11) Saludo / agradecimiento / charla.
        if GREETING.search(norm):
            state.node = "INTENT"
            greeting = self.profile.greeting or pick("greeting", seed)
            return TurnResult(
                f"{greeting} ¿Buscas algo en particular o te cuento qué manejamos?",
                state,
                intent="SMALLTALK",
                suggestions=["¿Qué venden?", "Quiero cotizar", "¿Hacen envíos?"],
            )
        if THANKS.search(norm):
            return TurnResult(
                "¡Con gusto! ¿Te ayudo con algo más?", state, intent="SMALLTALK",
                suggestions=["Cotizar otro producto", "Ver mi pedido"],
            )

        # 12) Último recurso: intentar catálogo y, si no, ser honesto.
        fallback = await self._search_flow(state, text, seed)
        if fallback.candidates:
            return fallback
        return TurnResult(
            f"{pick('not_found', seed)} También puedo contarte de envíos, pagos o facturación.",
            state,
            intent="OTHER",
            suggestions=["¿Qué venden?", "¿Cómo son los envíos?", "Hablar con una persona"],
        )

    # ---------- sub-flujos ----------

    def _looks_like_product_query(self, norm: str) -> bool:
        """Frase corta y afirmativa, o cualquier frase con cantidad explícita."""
        short_statement = len(norm.split()) <= 12 and not norm.endswith("?")
        return short_statement or bool(parse_quantity(norm)[0])

    def _resolve_selection(
        self, state: AgentState, norm: str
    ) -> tuple[dict[str, Any], str | None] | None:
        if not state.candidates:
            return None
        stripped = norm.strip()
        for key, index in ORDINAL.items():
            if stripped == key or stripped.startswith(f"{key} ") or stripped.startswith(f"el {key}") \
               or stripped.startswith(f"la {key}") or stripped.startswith(f"opcion {key}"):
                if index < len(state.candidates):
                    return state.candidates[index], key
        for candidate in state.candidates:
            variant = candidate.get("variant") or {}
            sku = normalize(variant.get("sku", ""))
            title = normalize(variant.get("title", ""))
            if sku and sku in stripped:
                return candidate, None
            if title and title in stripped and len(title) > 4:
                return candidate, None
        return None

    async def _on_selection(
        self, state: AgentState, candidate: dict[str, Any], text: str, seed: str,
        *, ordinal_used: str | None = None,
    ) -> TurnResult:
        variant = candidate.get("variant") or {}
        # "el 1" elige opción, no pide una pieza: el ordinal no es cantidad.
        quantity_text = text
        if ordinal_used:
            quantity_text = re.sub(
                rf"\b(el|la|opcion)?\s*{re.escape(ordinal_used)}\b", " ", normalize(text), count=1
            )
        quantity, unit, _ = parse_quantity(quantity_text)
        line = CartLine(
            variant_id=candidate["variantId"],
            sku=variant.get("sku", ""),
            title=variant.get("title", ""),
            quantity=quantity or "1",
            unit=unit,
            unit_price=variant.get("price"),
        )
        state.upsert_cart_line(line)
        state.candidates = []
        state.node = "CALCULATE" if quantity else "CLARIFY"

        if not quantity:
            state.pending_slots = ["cantidad"]
            return TurnResult(
                f"{pick('ack', seed)} {line.title}. {pick('ask_quantity', seed)}",
                state,
                intent="BUILD_QUOTE",
                suggestions=["1", "5", "10"],
            )
        return await self._quote_flow(state, text, seed)

    async def _business_answer(
        self, state: AgentState, text: str, norm: str, seed: str
    ) -> TurnResult | None:
        result = await self.tools.dispatch("answer_business_question", {"question": text})
        sections = result.get("sections", []) if isinstance(result, dict) else []
        # Una sección que solo trae nota interna no sirve como respuesta al cliente.
        sections = [s for s in sections if (s.get("body") or "").strip()]
        if not sections:
            return None
        best = sections[0]
        if best["score"] < 0.3:
            return None
        state.node = "INTENT"
        body = self._condense(best["body"])
        refs = [s["ref"] for s in sections[:2]]
        return TurnResult(
            body,
            state,
            intent="BUSINESS_QA",
            knowledge_refs=refs,
            suggestions=["Quiero cotizar", "¿Qué productos manejan?", "Hablar con una persona"],
        )

    @staticmethod
    def _condense(body: str, *, max_chars: int = 480) -> str:
        """Convierte una sección Markdown en respuesta corta de chat."""
        text = re.sub(r"^\s*[-*]\s+", "• ", body, flags=re.MULTILINE)
        text = re.sub(r"[*_`>]", "", text)
        text = re.sub(r"\n{2,}", "\n", text).strip()
        if len(text) <= max_chars:
            return text
        cut = text[:max_chars]
        return cut[: cut.rfind(".") + 1] or cut + "…"

    async def _search_flow(self, state: AgentState, text: str, seed: str) -> TurnResult:
        result = await self.tools.dispatch("search_products", {"query": text})
        if result.get("error"):
            return TurnResult(pick("offline", seed), state, handoff=True, intent="ERROR")

        candidates = result.get("candidates", [])
        state.candidates = candidates
        state.node = "SEARCH"
        if not candidates:
            return TurnResult(pick("not_found", seed), state, intent="SEARCH_PRODUCTS")

        quantity, unit, _ = parse_quantity(text)
        auto = result.get("autoSelected")
        if auto:
            return await self._on_selection(state, auto, text, seed)

        listing = format_candidates(candidates, self.profile.currency)
        tail = (
            f"Vi que necesitas {quantity}{' ' + unit if unit else ''}; en cuanto me digas cuál, te doy el total."
            if quantity
            else "Dime cuál y te paso el precio."
        )
        return TurnResult(
            f"{pick('choose', seed)}\n{listing}\n{tail}",
            state,
            intent="SEARCH_PRODUCTS",
            candidates=candidates,
            suggestions=[f"Opción {i}" for i in range(1, min(len(candidates), 3) + 1)],
        )

    async def _browse_catalog(self, state: AgentState, seed: str) -> TurnResult | None:
        """Panorama corto de lo que se vende, agrupado por producto."""
        catalog = await self.tools._load_catalog()
        if not catalog:
            return None
        groups: dict[str, list[str]] = {}
        for variant in catalog:
            if variant.status != "ACTIVE":
                continue
            groups.setdefault(variant.product_title or variant.title, []).append(variant.title)
        if not groups:
            return None
        listing = "\n".join(
            f"• {product}: {', '.join(sorted(set(titles))[:4])}"
            for product, titles in list(groups.items())[:5]
        )
        state.node = "INTENT"
        return TurnResult(
            f"Esto es lo que manejamos:\n{listing}\n¿Cuál te late?",
            state,
            intent="SEARCH_PRODUCTS",
            suggestions=[name for name in list(groups)[:3]],
        )

    async def _quote_flow(self, state: AgentState, text: str, seed: str) -> TurnResult:
        if not state.cart:
            return TurnResult(
                "Primero dime qué producto quieres y te armo la cotización.",
                state,
                intent="BUILD_QUOTE",
            )

        totals = await self.tools.dispatch(
            "calculate_quote", {"lines": state.cart_lines_payload()}
        )
        if totals.get("error"):
            # Sin calculadora no hay importes: no improvisamos.
            return TurnResult(
                "Ya tengo tu selección, pero no puedo calcular el total en este momento. "
                "Te paso con una persona del equipo para cerrarlo bien.",
                state,
                handoff=True,
                intent="BUILD_QUOTE",
            )

        state.node = "QUOTE_READY"
        state.pending_slots = ["confirmacion"]
        detail = "; ".join(f"{l.quantity} x {l.title}" for l in state.cart)
        summary = self._totals_line(totals)
        return TurnResult(
            f"Para {detail}: {summary} ¿Te la emito?",
            state,
            intent="BUILD_QUOTE",
            totals=totals,
            suggestions=["Sí, emítela", "Cambiar cantidad", "Ver otra opción"],
        )

    def _totals_line(self, totals: dict[str, Any]) -> str:
        currency = self.profile.currency
        body = totals.get("totals", totals)
        subtotal = body.get("subtotal")
        tax = body.get("tax")
        shipping = body.get("shipping")
        total = body.get("total")
        parts = []
        if subtotal:
            parts.append(f"subtotal ${subtotal}")
        if shipping and str(shipping) not in {"0", "0.00"}:
            parts.append(f"envío ${shipping}")
        if tax:
            parts.append(f"IVA ${tax}")
        detail = ", ".join(parts)
        return f"{detail} → total ${total} {currency}." if detail else f"total ${total} {currency}."

    async def _on_confirm(self, state: AgentState, text: str, seed: str) -> TurnResult:
        if "confirmacion" in state.pending_slots and state.cart:
            if not state.customer_name:
                state.pending_slots = ["nombre"]
                return TurnResult(pick("ask_name", seed), state, intent="BUILD_QUOTE")
            return await self._issue_quote(state, seed)
        if "nombre" in state.pending_slots:
            state.customer_name = text.strip()[:120]
            state.pending_slots = []
            return await self._issue_quote(state, seed)
        if state.quote_id and not state.order_id:
            return await self._to_payment(state, seed)
        if state.candidates:
            return await self._on_selection(state, state.candidates[0], text, seed)

        return TurnResult(
            "¿Confirmo qué exactamente? Dime el producto y lo dejamos listo.",
            state,
            intent="OTHER",
        )

    async def _issue_quote(self, state: AgentState, seed: str) -> TurnResult:
        command_id = f"{state.conversation_id}:quote:{len(state.cart)}:{state.turns}"
        result = await self.tools.dispatch(
            "create_and_issue_quote",
            {
                "lines": state.cart_lines_payload(),
                "customerName": state.customer_name or "Cliente",
                "customerPhone": state.customer_phone,
                "customerEmail": state.customer_email,
            },
            command_id=command_id,
        )
        if result.get("error"):
            return TurnResult(
                "No pude emitir la cotización desde aquí. Te paso con una persona del equipo "
                "para que la cierre contigo.",
                state,
                handoff=True,
                intent="BUILD_QUOTE",
            )
        state.quote_id = result["quoteId"]
        state.quote_link = result.get("linkRef")
        state.node = "WAIT_CONFIRMATION"
        state.pending_slots = []
        return TurnResult(
            f"Listo ✅ Cotización por ${result['total']} {self.profile.currency}. "
            f"Aquí la ves: {result.get('linkRef')} ¿Te genero el enlace de pago?",
            state,
            intent="QUOTE_ISSUED",
            quote=result,
            suggestions=["Sí, quiero pagar", "Tengo una duda", "Hablar con una persona"],
        )

    async def _to_payment(self, state: AgentState, seed: str) -> TurnResult:
        if not state.quote_id:
            if not state.cart:
                return TurnResult(
                    "Primero armamos qué llevas y luego te mando el enlace de pago.",
                    state,
                    intent="OTHER",
                )
            issued = await self._issue_quote(state, seed)
            if issued.handoff or not state.quote_id:
                return issued

        if not state.order_id:
            order = await self.tools.dispatch(
                "accept_quote",
                {"quoteId": state.quote_id},
                command_id=f"{state.conversation_id}:order:{state.quote_id}",
            )
            if order.get("error"):
                return TurnResult(
                    "No pude convertir la cotización en pedido. Te paso con una persona para "
                    "que lo resuelva rápido.",
                    state,
                    handoff=True,
                    intent="CONFIRM_QUOTE",
                )
            state.order_id = order["orderId"]

        checkout = await self.tools.dispatch(
            "get_checkout_link",
            {"orderId": state.order_id, "deliveryMode": "PICKUP"},
            command_id=f"{state.conversation_id}:checkout:{state.order_id}",
        )
        if checkout.get("error") or not checkout.get("linkRef"):
            return TurnResult(
                "El pedido quedó registrado, pero no pude generar el enlace de pago. "
                "Un compañero te lo manda enseguida.",
                state,
                handoff=True,
                intent="CONFIRM_QUOTE",
            )
        state.checkout_link = checkout["linkRef"]
        state.node = "LINK_SENT"
        return TurnResult(
            f"Aquí está tu enlace de pago: {checkout['linkRef']} "
            "Cuando lo completes te confirmo por aquí.",
            state,
            intent="CONFIRM_QUOTE",
            checkout=checkout,
            suggestions=["Ya pagué", "¿Cuánto tarda el envío?"],
        )

    async def _order_status(self, state: AgentState, text: str, seed: str) -> TurnResult:
        order_id = state.order_id
        found = UUID_RE.search(text)
        if found:
            order_id = found.group(0)
        if not order_id:
            return TurnResult(
                "Para revisarlo necesito el número de pedido. ¿Me lo compartes?",
                state,
                intent="ORDER_STATUS",
            )
        status = await self.tools.dispatch("get_order_status", {"orderId": order_id})
        if status.get("error"):
            return TurnResult(
                "No pude consultar el pedido en este momento. Te paso con una persona del equipo.",
                state,
                handoff=True,
                intent="ORDER_STATUS",
            )
        state.node = "STATUS"
        readable = {
            "DRAFT": "en borrador",
            "CHECKOUT_OPEN": "esperando pago",
            "PAID": "pagado",
            "FULFILLED": "entregado",
            "CANCELLED": "cancelado",
        }.get(str(status.get("status")), str(status.get("status", "")).lower())
        paid = " Ya tenemos registrado tu pago." if status.get("paidAt") else ""
        return TurnResult(
            f"Tu pedido está {readable} (total ${status.get('total')} {self.profile.currency}).{paid}",
            state,
            intent="ORDER_STATUS",
            suggestions=["¿Cuándo llega?", "Quiero cambiar algo"],
        )


# ===============================================================
# Motor con LLM + tool calling
# ===============================================================


class LLMEngine:
    """Bucle de herramientas contra OpenRouter, con presupuesto por turno."""

    def __init__(self, orchestrator: Orchestrator, tools: ToolGateway) -> None:
        self.o = orchestrator
        self.tools = tools
        self.settings = orchestrator.settings
        self.kb = orchestrator.knowledge

    async def run(
        self, state: AgentState, text: str, *, image_base64: str | None = None
    ) -> TurnResult:
        deadline = time.perf_counter() + self.settings.turn_budget_seconds
        knowledge_context = self.kb.context_block(text, top_k=self.settings.knowledge_top_k)
        system = build_system_prompt(
            self.kb.profile, knowledge_context=knowledge_context, state=state
        )
        messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
        history = state.history(self.settings.history_window)
        if image_base64 and history and history[-1]["role"] == "user":
            # El texto ya quedó en el historial (add_message se corre antes
            # del motor); se reemplaza ese último turno por su versión
            # multimodal para que el modelo vea la imagen junto al mensaje.
            history = history[:-1] + [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": history[-1]["content"]},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
                        },
                    ],
                }
            ]
        messages.extend(history)

        result = TurnResult("", state, engine="llm")
        schemas = self.tools.schemas()
        chat: ChatResult | None = None

        for _ in range(self.settings.max_tool_steps):
            if time.perf_counter() > deadline:
                result.truncated_budget = True
                break
            chat = await self.o.gateway.chat(messages, tools=schemas)
            result.cost_usd += chat.cost_usd
            if not chat.tool_calls:
                break

            messages.append(
                {
                    "role": "assistant",
                    "content": chat.content or None,
                    "tool_calls": [
                        {
                            "id": call["id"],
                            "type": "function",
                            "function": {
                                "name": call["name"],
                                "arguments": _json_dumps(call["arguments"]),
                            },
                        }
                        for call in chat.tool_calls
                    ],
                }
            )

            for call in chat.tool_calls:
                payload = await self._run_tool(state, call, result)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call["id"],
                        "name": call["name"],
                        "content": _json_dumps(payload),
                    }
                )

        if chat is None:
            raise ModelUnavailable("sin respuesta del modelo")

        reply = chat.content.strip()
        if not reply:
            # El modelo no cerró el turno: el motor determinista redacta.
            fallback = await RuleEngine(self.o, self.tools).run(state, text)
            fallback.engine = "llm+rules"
            fallback.cost_usd += result.cost_usd
            return fallback

        result.reply = reply
        result.candidates = state.candidates
        result.suggestions = _suggestions_for(state)
        return result

    async def _run_tool(
        self, state: AgentState, call: dict[str, Any], result: TurnResult
    ) -> dict[str, Any]:
        name = call["name"]
        args = call["arguments"] if isinstance(call.get("arguments"), dict) else {}
        if call.get("malformed"):
            return {"error": "BAD_ARGS", "message": "argumentos no son JSON válido; reintenta"}
        if name not in TOOLS:
            return {"error": "TOOL_NOT_ALLOWED", "message": f"{name} no existe"}

        spec = TOOLS[name]
        command_id = (
            f"{state.conversation_id}:{name}:{_stable_key(args)}" if spec.mutating else None
        )
        payload = await self.tools.dispatch(name, args, command_id=command_id)

        # El estado se actualiza desde el resultado del backend, nunca desde el texto del modelo.
        if name == "search_products":
            state.candidates = payload.get("candidates", [])
            result.candidates = state.candidates
        elif name == "calculate_quote" and not payload.get("error"):
            result.totals = payload
        elif name == "create_and_issue_quote" and not payload.get("error"):
            state.quote_id = payload.get("quoteId")
            state.quote_link = payload.get("linkRef")
            # Persistimos las líneas validadas en el carrito: el Order del
            # backend no guarda líneas y get_checkout_link las necesita.
            state.cart = []
            for raw in args.get("lines") or []:
                variant_id = str(raw.get("variantId") or "")
                if not variant_id:
                    continue
                variant = next(
                    (v for v in self.tools.catalog_cache if v.id == variant_id), None
                )
                state.cart.append(
                    CartLine(
                        variant_id=variant_id,
                        sku=(variant.sku if variant else "") or "",
                        title=(variant.title if variant else variant_id) or "",
                        quantity=str(raw.get("quantity") or "1"),
                        unit_price=(variant.price if variant else None),
                    )
                )
            result.quote = payload
            state.node = "WAIT_CONFIRMATION"
        elif name == "accept_quote" and not payload.get("error"):
            state.order_id = payload.get("orderId")
        elif name == "get_checkout_link" and not payload.get("error"):
            state.checkout_link = payload.get("linkRef")
            result.checkout = payload
            state.node = "LINK_SENT"
        elif name == "answer_business_question":
            result.knowledge_refs.extend(
                section["ref"] for section in payload.get("sections", [])[:2]
            )
        elif name == "request_human" and not payload.get("error"):
            result.handoff = True
            state.handoff_reason = payload.get("reason")
        return payload


def _suggestions_for(state: AgentState) -> list[str]:
    if state.checkout_link:
        return ["Ya pagué", "¿Cuándo llega mi pedido?"]
    if state.quote_id:
        return ["Sí, quiero pagar", "Tengo una duda"]
    if state.cart:
        return ["Emitir cotización", "Cambiar cantidad"]
    if state.candidates:
        return [f"Opción {i}" for i in range(1, min(len(state.candidates), 3) + 1)]
    return ["¿Qué venden?", "Quiero cotizar", "¿Hacen envíos?"]


def _json_dumps(value: Any) -> str:
    import json

    return json.dumps(value, ensure_ascii=False, default=str)


def _stable_key(args: dict[str, Any]) -> str:
    import hashlib
    import json

    raw = json.dumps(args, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha1(raw.encode()).hexdigest()[:12]


_ORCHESTRATOR: Orchestrator | None = None


def get_orchestrator() -> Orchestrator:
    global _ORCHESTRATOR
    if _ORCHESTRATOR is None:
        _ORCHESTRATOR = Orchestrator()
    return _ORCHESTRATOR


def reset_orchestrator() -> None:
    global _ORCHESTRATOR
    _ORCHESTRATOR = None
