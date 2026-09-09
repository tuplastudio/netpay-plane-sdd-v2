"""NetPay Plane — agente IA (T-AIA-01..07).

Cumple ADR-013/ADR-014: herramientas con allowlist por tenant, LLM/STT/TTS
mediante OpenRouter (un único proveedor). El runtime real se activa con
OPENROUTER_KEY_REF; sin él, los métodos caen a fixtures deterministas.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import httpx


# ============================================================
# T-AIA-01 — Estado del agente + persistencia ligera en memoria
# ============================================================

@dataclass
class AgentState:
    tenant_id: str
    conversation_id: str
    customer_phone: str | None = None
    messages: list[dict[str, Any]] = field(default_factory=list)
    tools_called: list[dict[str, Any]] = field(default_factory=list)
    handoff: bool = False
    last_intent: str | None = None
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "tenantId": self.tenant_id,
            "conversationId": self.conversation_id,
            "customerPhone": self.customer_phone,
            "messages": self.messages,
            "toolsCalled": self.tools_called,
            "handoff": self.handoff,
            "lastIntent": self.last_intent,
            "score": self.score,
        }


_STATE: dict[str, AgentState] = {}


def get_state(conversation_id: str) -> AgentState | None:
    return _STATE.get(conversation_id)


def create_state(tenant_id: str, conversation_id: str | None = None) -> AgentState:
    cid = conversation_id or str(uuid.uuid4())
    state = AgentState(tenant_id=tenant_id, conversation_id=cid)
    _STATE[cid] = state
    return state


# ============================================================
# T-AIA-02 — ModelGateway (OpenRouter)
# ============================================================

OPENROUTER_KEY = os.environ.get("OPENROUTER_KEY_REF") or os.environ.get("OPENROUTER_API_KEY", "")
TEXT_MODEL = os.environ.get("MODEL_ID", "openai/gpt-4o-mini")
STT_MODEL = os.environ.get("STT_MODEL_ID", "openai/whisper-1")
TTS_MODEL = os.environ.get("TTS_MODEL_ID", "openai/tts-1")
TTS_VOICE = os.environ.get("TTS_VOICE", "alloy")


class ModelGateway:
    """Cliente OpenRouter para text/STT/TTS.

    Si OPENROUTER_KEY está vacío, devuelve fixtures deterministas
    para que el resto del sistema funcione en CI/local sin gastar
    tokens. En producción se activa por env (T-AIA-07).
    """

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key if api_key is not None else OPENROUTER_KEY
        self.base_url = "https://openrouter.ai/api/v1"

    def is_live(self) -> bool:
        return bool(self.api_key)

    def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str | None = None,
        temperature: float = 0.2,
        max_tokens: int = 512,
    ) -> dict[str, Any]:
        if not self.is_live():
            return {
                "id": f"fixture-{hashlib.md5(json.dumps(messages, default=str).encode()).hexdigest()[:8]}",
                "model": model or TEXT_MODEL,
                "content": "[fixture] respuesta determinista del agente (OPENROUTER_KEY no configurada)",
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total": 0},
            }
        body = {
            "model": model or TEXT_MODEL,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        with httpx.Client(timeout=30) as client:
            r = client.post(
                f"{self.base_url}/chat/completions",
                headers={"authorization": f"Bearer {self.api_key}"},
                json=body,
            )
            r.raise_for_status()
            data = r.json()
        return {
            "id": data.get("id"),
            "model": data.get("model"),
            "content": data["choices"][0]["message"]["content"],
            "usage": data.get("usage", {}),
        }

    def stt(self, audio_bytes: bytes, *, model: str | None = None) -> dict[str, Any]:
        if not self.is_live():
            return {"text": "[fixture] audio transcrito", "language": "es", "model": STT_MODEL}
        # En producción real usar multipart upload a OpenRouter.
        with httpx.Client(timeout=30) as client:
            r = client.post(
                f"{self.base_url}/audio/transcriptions",
                headers={"authorization": f"Bearer {self.api_key}"},
                files={"file": ("audio.m4a", audio_bytes, "audio/mp4a")},
                data={"model": model or STT_MODEL},
            )
            r.raise_for_status()
        return r.json()

    def tts(self, text: str, *, voice: str | None = None, model: str | None = None) -> dict[str, Any]:
        if not self.is_live():
            return {"url": None, "bytes": None, "voice": voice or TTS_VOICE}
        with httpx.Client(timeout=30) as client:
            r = client.post(
                f"{self.base_url}/audio/speech",
                headers={"authorization": f"Bearer {self.api_key}"},
                json={"model": model or TTS_MODEL, "voice": voice or TTS_VOICE, "input": text},
            )
            r.raise_for_status()
        return {"bytes": r.content, "voice": voice or TTS_VOICE}


# ============================================================
# T-AIA-03 — Matching explicable de catálogo
# ============================================================

@dataclass
class CatalogVariant:
    id: str
    sku: str
    title: str
    description: str
    price: str
    sat_product_code: str
    stock: float | None


@dataclass
class MatchResult:
    variant_id: str
    score: float
    reasons: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "variantId": self.variant_id,
            "score": round(self.score, 4),
            "reasons": self.reasons,
        }


def match_products(
    query: str,
    catalog: list[CatalogVariant],
    *,
    top_k: int = 3,
) -> list[MatchResult]:
    """Matching determinista (rule-based) cuando OPENROUTER_KEY está vacío.

    Score combina:
      - coincidencia literal en título (0..1)
      - coincidencia en SKU (boost si match exacto)
      - palabras compartidas (Jaccard simple)

    Devuelve `reasons` explicables para el humano (T-AIA-03).
    """
    q = (query or "").strip().lower()
    q_tokens = set(t for t in q.split() if t)
    if not q_tokens:
        return []

    scored: list[MatchResult] = []
    for v in catalog:
        title_tokens = set((v.title or "").lower().split())
        desc_tokens = set((v.description or "").lower().split())
        shared = q_tokens & (title_tokens | desc_tokens)
        score = len(shared) / max(1, len(q_tokens))
        reasons: list[str] = []
        if q == v.sku.lower():
            score = 1.0
            reasons.append("SKU exacto")
        if q in (v.title or "").lower():
            score = max(score, 0.9)
            reasons.append("título contiene la consulta")
        if shared:
            reasons.append(f"{len(shared)} palabras compartidas")
        if v.stock is not None and v.stock <= 0:
            score *= 0.1
            reasons.append("sin stock")
        if score > 0:
            scored.append(MatchResult(v.id, score, reasons))

    scored.sort(key=lambda r: r.score, reverse=True)
    return scored[:top_k]


# ============================================================
# T-AIA-04 — Tool gateway (allowlist por tenant)
# ============================================================

# Allowlist cerrada: ninguna herramienta fuera de esta lista se ejecuta.
ALLOWED_TOOLS = {
    "search_catalog": "Buscar variantes en el catálogo del tenant",
    "get_quote": "Recuperar cotización por id",
    "create_quote": "Crear cotización borrador",
    "share_quote": "Generar link público de cotización",
    "send_payment_link": "Crear sesión dummy y devolver checkout URL",
    "handoff_human": "Transferir la conversación a un humano",
}


class ToolGateway:
    """Valida y ejecuta herramientas con scopes.

    Cada tool expone un scope requerido. Antes de ejecutar se valida
    que el principal (api-key o user role) tenga ese scope (T-AIA-04).
    """

    REQUIRED_SCOPES: dict[str, str] = {
        "search_catalog": "catalog.read",
        "get_quote": "quotes.read",
        "create_quote": "quotes.write",
        "share_quote": "quotes.write",
        "send_payment_link": "orders.write",
        "handoff_human": "chat.write",
    }

    def __init__(self, principal_scopes: set[str]) -> None:
        self.principal_scopes = principal_scopes

    def can_call(self, name: str) -> bool:
        return name in ALLOWED_TOOLS and self.REQUIRED_SCOPES.get(name, "") in self.principal_scopes

    async def dispatch(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        if name not in ALLOWED_TOOLS:
            raise ValueError(f"Tool no permitida: {name}")
        if not self.can_call(name):
            raise PermissionError(
                f"Scope faltante para {name}: {self.REQUIRED_SCOPES[name]}"
            )
        # Aquí se haría la llamada al servicio (API comercial HTTP).
        # Mantenemos el contrato y devolvemos un placeholder.
        return {
            "tool": name,
            "args": args,
            "result": {"ok": True, "fixture": True},
        }


# ============================================================
# T-AIA-06 — Coordinación de turnos + handoff
# ============================================================

@dataclass
class TurnResult:
    reply: str
    state: AgentState
    handoff: bool
    score: float | None = None


def decide_handoff(state: AgentState) -> bool:
    """Reglas deterministas para transferir a humano."""
    if state.handoff:
        return True
    # 3 tool calls sin resolución → escalar
    if len(state.tools_called) >= 3 and state.last_intent is None:
        return True
    return False


def next_reply(
    state: AgentState,
    *,
    gateway: ModelGateway,
    matched: list[MatchResult],
) -> TurnResult:
    """Genera la siguiente respuesta usando LLM o fixture."""
    history = state.messages[-10:]  # ventana corta
    if matched:
        state.score = matched[0].score
        state.last_intent = "search_catalog"

    if not gateway.is_live():
        if matched:
            top = matched[0]
            v_id = top.variant_id
            return TurnResult(
                reply=(
                    f"Tenemos {v_id[:8]}: coincide {top.reasons}. "
                    "¿Quieres que te mande link de pago o una cotización?"
                ),
                state=state,
                handoff=decide_handoff(state),
                score=top.score,
            )
        return TurnResult(
            reply="No encuentro ese producto. ¿Me describes otra vez?",
            state=state,
            handoff=decide_handoff(state),
        )

    # Live LLM call
    system = {
        "role": "system",
        "content": (
            "Eres el agente comercial de NetPay Plane. Responde en español, breve, "
            "concreto. Si no estás seguro, transfiere a humano. No inventes precios."
        ),
    }
    user_msg = history[-1]["content"] if history else "Hola"
    messages = [system, {"role": "user", "content": user_msg}]
    response = gateway.chat(messages)
    state.messages.append({"role": "assistant", "content": response["content"], "ts": time.time()})
    return TurnResult(reply=response["content"], state=state, handoff=decide_handoff(state))


# ============================================================
# T-AIA-07 — Eval suite (asserts simples, sin LLM real)
# ============================================================

def eval_matching() -> dict[str, Any]:
    cat = [
        CatalogVariant("v1", "SKU-001", "Café de altura 250g", "Café orgánico", "199.99", "50201700", 100.0),
        CatalogVariant("v2", "SKU-002", "Tornillo M3", "Acero galvanizado", "1.50", "31161500", 5000.0),
    ]
    r1 = match_products("café 250g", cat)
    assert r1 and r1[0].variant_id == "v1", "match_products: café no encontró café"
    r2 = match_products("sku-002", cat)
    assert r2 and r2[0].score == 1.0, "match_products: SKU exacto debe ser score 1.0"
    r3 = match_products("xyz123", cat)
    assert r3 == [], "match_products: query sin overlap debe devolver vacío"
    return {"ok": True, "matched": len(r1) + len(r2) + len(r3)}


def eval_tool_allowlist() -> dict[str, Any]:
    tg_ok = ToolGateway({"catalog.read", "orders.write"})
    assert tg_ok.can_call("search_catalog")
    assert tg_ok.can_call("send_payment_link")
    assert not tg_ok.can_call("create_quote")  # falta quotes.write

    tg_admin = ToolGateway({"quotes.write"})
    assert tg_admin.can_call("create_quote")
    assert not tg_admin.can_call("send_payment_link")  # falta orders.write

    return {"ok": True, "tests": 5}


def run_eval_suite() -> dict[str, Any]:
    return {
        "matching": eval_matching(),
        "tools": eval_tool_allowlist(),
        "ts": time.time(),
    }


if __name__ == "__main__":
    import sys

    cmd = sys.argv[1] if len(sys.argv) > 1 else "eval"
    if cmd == "eval":
        result = run_eval_suite()
        print(json.dumps(result, indent=2))
    elif cmd == "demo":
        st = create_state("demo-tenant")
        catalog = [
            CatalogVariant("v1", "SKU-001", "Café de altura 250g", "Café orgánico", "199.99", "50201700", 100.0),
        ]
        matches = match_products("café", catalog)
        gw = ModelGateway()
        result = next_reply(st, gateway=gw, matched=matches)
        print(json.dumps(result.state.to_dict(), indent=2))
        print("reply:", result.reply)
        print("handoff:", result.handoff)
    else:
        print(f"Unknown cmd: {cmd}")
        sys.exit(1)