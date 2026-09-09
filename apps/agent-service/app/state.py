"""Estado del grafo y checkpoints (T-AIA-01).

Namespace `tenant/conversation`. El checkpoint se guarda como JSON en disco
(`AGENT_CHECKPOINT_DIR`), de modo que reiniciar el servicio reanuda la
conversación sin repetir herramientas mutantes: los `commandId` ya ejecutados
viven en el propio checkpoint.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

from .config import get_settings
from .text import format_quantity


@dataclass
class CartLine:
    variant_id: str
    sku: str
    title: str
    quantity: str
    unit: str | None = None
    unit_price: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "variantId": self.variant_id,
            "sku": self.sku,
            "title": self.title,
            "quantity": self.quantity,
            "unit": self.unit,
            "unitPrice": self.unit_price,
        }


@dataclass
class AgentState:
    tenant_id: str
    conversation_id: str
    customer_phone: str | None = None
    customer_name: str | None = None
    customer_email: str | None = None
    customer_lookup_done: bool = False
    channel: str = "web"

    messages: list[dict[str, Any]] = field(default_factory=list)
    summary: str = ""
    tools_called: list[dict[str, Any]] = field(default_factory=list)
    command_log: dict[str, dict[str, Any]] = field(default_factory=dict)
    processed_message_ids: list[str] = field(default_factory=list)

    cart: list[CartLine] = field(default_factory=list)
    candidates: list[dict[str, Any]] = field(default_factory=list)
    pending_slots: list[str] = field(default_factory=list)
    quote_id: str | None = None
    quote_link: str | None = None
    order_id: str | None = None
    checkout_link: str | None = None
    confirmation_ref: str | None = None

    node: str = "RECEIVED"
    last_intent: str | None = None
    score: float | None = None
    handoff: bool = False
    handoff_reason: str | None = None
    control_version: int = 1
    cost_usd: float = 0.0
    turns: int = 0
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    # ---------- helpers de conversación ----------

    def add_message(self, role: str, content: str, **extra: Any) -> None:
        self.messages.append({"role": role, "content": content, "ts": time.time(), **extra})
        self.updated_at = time.time()

    def history(self, window: int) -> list[dict[str, str]]:
        return [
            {"role": m["role"], "content": m["content"]}
            for m in self.messages[-window:]
            if m.get("content")
        ]

    def cart_lines_payload(self) -> list[dict[str, Any]]:
        return [{"variantId": l.variant_id, "quantity": format_quantity(l.quantity)} for l in self.cart]

    def upsert_cart_line(self, line: CartLine) -> None:
        for existing in self.cart:
            if existing.variant_id == line.variant_id:
                existing.quantity = line.quantity
                existing.unit = line.unit or existing.unit
                existing.unit_price = line.unit_price or existing.unit_price
                return
        self.cart.append(line)

    def clear_cart(self) -> None:
        self.cart = []
        self.candidates = []
        self.pending_slots = []

    def already_processed(self, message_id: str | None) -> bool:
        return bool(message_id) and message_id in self.processed_message_ids

    def mark_processed(self, message_id: str | None) -> None:
        if not message_id:
            return
        self.processed_message_ids.append(message_id)
        # Límite explícito: la lista no crece sin control.
        self.processed_message_ids = self.processed_message_ids[-50:]

    def maybe_summarize(self, threshold: int) -> None:
        """Resumen barato y determinista: conserva referencias comerciales."""
        if len(self.messages) <= threshold:
            return
        keep = self.messages[-threshold // 2 :]
        dropped = self.messages[: -threshold // 2]
        refs: list[str] = []
        for msg in dropped:
            refs.extend(re.findall(r"\b(?:SKU|sku)[-\w]*\d+\b", msg.get("content", "")))
        parts = [self.summary] if self.summary else []
        parts.append(
            f"[resumen] {len(dropped)} mensajes previos. "
            f"Cliente: {self.customer_name or 'sin nombre'}. "
            f"Carrito: {len(self.cart)} línea(s). "
            f"Cotización: {self.quote_id or 'ninguna'}. "
            f"Pedido: {self.order_id or 'ninguno'}."
            + (f" Referencias: {', '.join(sorted(set(refs))[:8])}." if refs else "")
        )
        self.summary = " ".join(parts)[-1500:]
        self.messages = keep

    # ---------- serialización ----------

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["cart"] = [line.to_dict() for line in self.cart]
        return {
            "tenantId": self.tenant_id,
            "conversationId": self.conversation_id,
            "customerPhone": self.customer_phone,
            "customerName": self.customer_name,
            "channel": self.channel,
            "node": self.node,
            "summary": self.summary,
            "messages": self.messages,
            "toolsCalled": self.tools_called,
            "cart": data["cart"],
            "candidates": self.candidates,
            "pendingSlots": self.pending_slots,
            "quoteId": self.quote_id,
            "quoteLink": self.quote_link,
            "orderId": self.order_id,
            "checkoutLink": self.checkout_link,
            "lastIntent": self.last_intent,
            "score": self.score,
            "handoff": self.handoff,
            "handoffReason": self.handoff_reason,
            "controlVersion": self.control_version,
            "costUsd": round(self.cost_usd, 6),
            "turns": self.turns,
            "updatedAt": self.updated_at,
        }

    def to_checkpoint(self) -> dict[str, Any]:
        data = asdict(self)
        data["cart"] = [line.to_dict() for line in self.cart]
        return data

    @classmethod
    def from_checkpoint(cls, data: dict[str, Any]) -> "AgentState":
        cart = [
            CartLine(
                variant_id=l["variantId"],
                sku=l.get("sku", ""),
                title=l.get("title", ""),
                quantity=l.get("quantity", "1"),
                unit=l.get("unit"),
                unit_price=l.get("unitPrice"),
            )
            for l in data.get("cart", [])
        ]
        payload = {k: v for k, v in data.items() if k in cls.__dataclass_fields__ and k != "cart"}
        state = cls(**payload)  # type: ignore[arg-type]
        state.cart = cart
        return state


class StateStore:
    """Almacén con checkpoint en disco por tenant/conversación."""

    def __init__(self, directory: Path | None = None, *, enabled: bool = True) -> None:
        settings = get_settings()
        self.directory = directory or settings.checkpoint_dir
        self.enabled = enabled and settings.checkpoint_enabled
        self._cache: dict[str, AgentState] = {}
        if self.enabled:
            self.directory.mkdir(parents=True, exist_ok=True)

    def _path(self, tenant_id: str, conversation_id: str) -> Path:
        safe_tenant = re.sub(r"[^A-Za-z0-9_.-]", "_", tenant_id)[:64]
        safe_conv = re.sub(r"[^A-Za-z0-9_.-]", "_", conversation_id)[:64]
        return self.directory / safe_tenant / f"{safe_conv}.json"

    def get(self, tenant_id: str, conversation_id: str) -> AgentState | None:
        key = f"{tenant_id}/{conversation_id}"
        if key in self._cache:
            return self._cache[key]
        if not self.enabled:
            return None
        path = self._path(tenant_id, conversation_id)
        if not path.exists():
            return None
        try:
            state = AgentState.from_checkpoint(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, TypeError):
            return None
        # Aislamiento: un checkpoint de otro tenant nunca se sirve.
        if state.tenant_id != tenant_id:
            return None
        self._cache[key] = state
        return state

    def create(self, tenant_id: str, conversation_id: str | None = None, **kwargs: Any) -> AgentState:
        state = AgentState(
            tenant_id=tenant_id,
            conversation_id=conversation_id or str(uuid.uuid4()),
            **kwargs,
        )
        self.save(state)
        return state

    def save(self, state: AgentState) -> None:
        state.updated_at = time.time()
        self._cache[f"{state.tenant_id}/{state.conversation_id}"] = state
        if not self.enabled:
            return
        path = self._path(state.tenant_id, state.conversation_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(state.to_checkpoint(), ensure_ascii=False, default=str), encoding="utf-8"
        )
        tmp.replace(path)

    def delete(self, tenant_id: str, conversation_id: str) -> None:
        self._cache.pop(f"{tenant_id}/{conversation_id}", None)
        if self.enabled:
            self._path(tenant_id, conversation_id).unlink(missing_ok=True)


_STORE: StateStore | None = None


def get_store() -> StateStore:
    global _STORE
    if _STORE is None:
        _STORE = StateStore()
    return _STORE
