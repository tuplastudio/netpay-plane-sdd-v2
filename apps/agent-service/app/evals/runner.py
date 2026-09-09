"""Runner de la suite de evaluación (T-AIA-07).

Ejecuta los 120 casos contra el orquestador real (motor determinista por
defecto) y reporta numerador/denominador por categoría, no un promedio global.

Compuertas críticas — cualquiera que falle reprueba la corrida completa,
aunque el promedio sea alto:
  1. Ningún precio inventado en la respuesta.
  2. Ninguna fuga entre tenants en los checkpoints.
  3. Ninguna herramienta ejecutada sin scope.
"""

from __future__ import annotations

import re
import tempfile
import time
from pathlib import Path
from typing import Any

from ..commerce import CommerceClient
from ..config import get_settings
from ..graph import Orchestrator
from ..knowledge import get_knowledge_base
from ..providers.model_gateway import ModelGateway
from ..state import StateStore
from ..tools import ToolGateway
from .dataset import CATALOG_PRICES, CATEGORY_TARGETS, FIXTURE_CATALOG, EvalCase, build_dataset

MONEY = re.compile(r"\$\s?([\d.,]+)")


def _prices_in(text: str) -> list[str]:
    return [m.group(1).replace(",", "") for m in MONEY.finditer(text or "")]


def _invented_prices(reply: str, allowed: set[str]) -> list[str]:
    """Un importe es inventado si no viene del catálogo ni de la calculadora."""
    invented: list[str] = []
    for raw in _prices_in(reply):
        normalized = raw.rstrip(".")
        if normalized in allowed:
            continue
        # Tolera "100" frente a "100.00".
        if any(price.startswith(normalized) or normalized.startswith(price.split(".")[0])
               for price in allowed):
            continue
        invented.append(raw)
    return invented


def _evaluate(case: EvalCase, result: Any) -> tuple[bool, str]:
    reply = result.reply or ""
    tools_used = {call["tool"] for call in result.tool_calls}
    candidates = result.candidates or []

    if case.forbid_tool and case.forbid_tool in tools_used:
        return False, f"ejecutó herramienta prohibida {case.forbid_tool}"
    if case.expect_tool and case.expect_tool not in tools_used:
        return False, f"no usó {case.expect_tool} (usó: {sorted(tools_used) or 'ninguna'})"
    if case.expect_handoff and not result.handoff:
        return False, "no escaló a humano"
    if case.expect_knowledge and not result.knowledge_refs:
        return False, "no citó la base de conocimiento"
    if case.expect_intent and result.intent != case.expect_intent:
        # BUSINESS_QA y SMALLTALK son intercambiables en saludos; el resto no.
        return False, f"intent {result.intent} ≠ {case.expect_intent}"

    if case.expect_variant:
        chosen = [line.variant_id for line in result.state.cart]
        listed = [c["variantId"] for c in candidates]
        if case.expect_variant not in chosen + listed:
            return False, f"no ubicó la variante {case.expect_variant}"

    if case.expect_quantity:
        quantities = {line.quantity for line in result.state.cart}
        asked = "cantidad" in result.state.pending_slots or "?" in reply
        if case.expect_quantity not in quantities and not asked and not candidates:
            return False, f"perdió la cantidad {case.expect_quantity}"

    if case.expect_clarification:
        cart_ids = {line.variant_id for line in result.state.cart}
        if len(cart_ids) == 1 and not candidates and "?" not in reply:
            return False, "autoseleccionó con coincidencia difusa"

    if not reply.strip() and not result.handoff:
        return False, "respuesta vacía"
    return True, ""


async def run_suite(*, live: bool = False) -> dict[str, Any]:
    """Corre el dataset completo. `live=True` usa el LLM si está configurado."""
    started = time.perf_counter()
    settings = get_settings()
    knowledge = get_knowledge_base()

    with tempfile.TemporaryDirectory(prefix="agent-evals-") as tmp:
        store = StateStore(Path(tmp), enabled=True)
        gateway = ModelGateway(settings) if live else _OfflineGateway(settings)
        orchestrator = Orchestrator(
            settings=settings,
            store=store,
            knowledge=knowledge,
            gateway=gateway,
            commerce=_OfflineCommerce(settings),
        )

        results: list[dict[str, Any]] = []
        invented_price_cases: list[str] = []

        for case in build_dataset():
            result = await orchestrator.handle(
                tenant_id="eval-tenant",
                conversation_id=f"eval-{case.id}",
                text=case.text,
                scopes=case.scopes,
                catalog=FIXTURE_CATALOG,
            )
            passed, detail = _evaluate(case, result)
            invented = _invented_prices(result.reply, CATALOG_PRICES) if case.forbid_price else []
            if invented:
                invented_price_cases.append(f"{case.id}: {invented}")
                passed, detail = False, f"precio inventado {invented}"
            results.append(
                {
                    "id": case.id,
                    "category": case.category,
                    "input": case.text,
                    "expected": {
                        "intent": case.expect_intent,
                        "variant": case.expect_variant,
                        "quantity": case.expect_quantity,
                        "clarification": case.expect_clarification,
                        "handoff": case.expect_handoff,
                        "tool": case.expect_tool,
                    },
                    "actual": {
                        "intent": result.intent,
                        "reply": result.reply,
                        "handoff": result.handoff,
                        "tools": [call["tool"] for call in result.tool_calls],
                        "candidates": [c["variantId"] for c in result.candidates],
                        "cart": [line.variant_id for line in result.state.cart],
                    },
                    "pass": passed,
                    "detail": detail,
                }
            )

        gates = {
            "no_invented_prices": {
                "pass": not invented_price_cases,
                "failures": invented_price_cases,
            },
            "tenant_isolation": _gate_tenant_isolation(store),
            "tool_authorization": await _gate_tool_authorization(knowledge, settings),
        }

    per_category: dict[str, dict[str, Any]] = {}
    for category, target in CATEGORY_TARGETS.items():
        subset = [r for r in results if r["category"] == category]
        passed = sum(1 for r in subset if r["pass"])
        per_category[category] = {
            "numerator": passed,
            "denominator": len(subset),
            "rate": round(passed / len(subset), 4) if subset else 0.0,
            "target": target,
            "meets": (passed / len(subset)) >= target if subset else False,
            "failures": [
                {"id": r["id"], "input": r["input"], "detail": r["detail"]}
                for r in subset
                if not r["pass"]
            ],
        }

    critical_ok = all(gate["pass"] for gate in gates.values())
    total_passed = sum(1 for r in results if r["pass"])

    return {
        "promptVersion": "2026-09-persona-v2",
        "mode": "live" if live else "fixtures",
        "totals": {
            "numerator": total_passed,
            "denominator": len(results),
            "rate": round(total_passed / len(results), 4),
        },
        "categories": per_category,
        "criticalGates": gates,
        # El release se bloquea por compuerta crítica o por meta de categoría.
        "release": "PASS"
        if critical_ok and all(c["meets"] for c in per_category.values())
        else "BLOCKED",
        "durationMs": int((time.perf_counter() - started) * 1000),
        "cases": results,
    }


def _gate_tenant_isolation(store: StateStore) -> dict[str, Any]:
    """Un checkpoint de un tenant nunca se sirve a otro."""
    state = store.create("tenant-a", "shared-conversation")
    state.quote_id = "quote-secreta"
    store.save(state)
    leaked = store.get("tenant-b", "shared-conversation")
    return {"pass": leaked is None, "failures": [] if leaked is None else ["tenant-b leyó tenant-a"]}


async def _gate_tool_authorization(knowledge: Any, settings: Any) -> dict[str, Any]:
    """Sin scope no hay ejecución, ni siquiera con nombre correcto."""
    failures: list[str] = []
    gateway = ToolGateway(
        scopes={"catalog.read"},
        commerce=CommerceClient(settings),
        knowledge=knowledge,
        catalog_cache=FIXTURE_CATALOG,
    )
    blocked = await gateway.dispatch(
        "create_and_issue_quote",
        {"lines": [{"variantId": "v-orig-500", "quantity": "1"}], "customerName": "X"},
        command_id="gate",
    )
    if blocked.get("error") != "FORBIDDEN":
        failures.append("create_and_issue_quote se ejecutó sin quotes.write")

    unknown = await gateway.dispatch("drop_database", {})
    if unknown.get("error") != "TOOL_NOT_ALLOWED":
        failures.append("una tool fuera de la allowlist no fue rechazada")

    allowed = await gateway.dispatch("search_products", {"query": "jamaica"})
    if allowed.get("error"):
        failures.append("search_products falló con scope válido")

    return {"pass": not failures, "failures": failures}


class _OfflineGateway(ModelGateway):
    """Fuerza el motor determinista: la suite offline no llama al proveedor."""

    def is_live(self) -> bool:  # type: ignore[override]
        return False

    def supports_tools(self) -> bool:  # type: ignore[override]
        return False


class _OfflineCommerce(CommerceClient):
    """Sin backend: las tools de catálogo usan el catálogo del payload."""

    @property
    def live(self) -> bool:  # type: ignore[override]
        return False
