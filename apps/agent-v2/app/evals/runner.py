"""Runner de la suite de evaluación del agente v2.

Corre cada `EvalCase` (una conversación) turno a turno contra el agente real
(`build_agent`), con un checkpointer en memoria (una conversación por caso,
nunca se cruzan). No hay motor determinista al que caerle: cada turno
consume al menos una llamada al modelo vía OpenRouter, así que esto SIEMPRE
cuesta dinero real salvo que se use `--dry-run`.

Compuertas automáticas (se evalúan en todos los turnos, no se declaran por
caso):
  - `sin_precio_inventado`: todo importe ($NNN) en la respuesta cruda del
    modelo debe existir en el catálogo real o haber salido de una
    herramienta de la misma conversación (calcular_total, emitir_cotizacion,
    generar_enlace_pago, etc.). Ver `_invented_prices`.
  - `formato_whatsapp`: la respuesta cruda del modelo (antes del saneador de
    `app.text`) no debe traer **negritas**, encabezados `#` ni viñetas con
    guion. Se prueba la salida CRUDA a propósito: el saneador de `main.py`
    puede tapar un mal hábito del prompt; aquí se mide si el modelo lo
    respeta por sí solo.
"""

from __future__ import annotations

import re
import time
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from ..agent import build_agent
from ..commerce import CommerceClient, CommerceError, CommerceUnavailable
from ..config import Settings, get_settings
from ..state import TurnContext
from .dataset import EvalCase, Turn, build_dataset

MONEY = re.compile(r"\$\s?([\d.,]+)")

# Precio aproximado de OpenAI/OpenRouter para gpt-4o-mini (USD por 1M tokens).
# Solo para dar una estimación de costo en el reporte; no es facturación real.
_PRICE_PER_1M_INPUT = 0.15
_PRICE_PER_1M_OUTPUT = 0.60


def _prices_in(text: str) -> list[str]:
    return [m.group(1).replace(",", "") for m in MONEY.finditer(text or "")]


def _price_allowed(raw: str, allowed: set[str]) -> bool:
    normalized = raw.rstrip(".")
    if normalized in allowed:
        return True
    # Tolera "100" frente a "100.00" y viceversa.
    return any(
        price.startswith(normalized) or normalized.startswith(price.split(".")[0])
        for price in allowed
    )


def _invented_prices(reply: str, allowed: set[str]) -> list[str]:
    return [p for p in _prices_in(reply) if not _price_allowed(p, allowed)]


_MARKDOWN_CHECKS: list[tuple[str, re.Pattern[str]]] = [
    ("doble_asterisco", re.compile(r"\*\*[^*]+\*\*")),
    ("encabezado_markdown", re.compile(r"(?m)^\s{0,3}#{1,6}\s")),
    ("vineta_con_guion", re.compile(r"(?m)^[ \t]*-\s+\S")),
    ("enlace_markdown", re.compile(r"\[[^\]]+\]\(https?://[^\s)]+\)")),
]


def _markdown_violations(text: str) -> list[str]:
    return [label for label, pattern in _MARKDOWN_CHECKS if pattern.search(text or "")]


async def _fetch_catalog_prices(settings: Settings) -> set[str]:
    """Precios reales del tenant de pruebas. Vacío si commerce-api no está
    configurada (la corrida sigue, pero la compuerta de precios pierde
    cobertura y se anota en el reporte)."""
    client = CommerceClient(settings)
    if not client.live:
        return set()
    try:
        variants = await client.search_products(None, limit=100)
    except (CommerceError, CommerceUnavailable):
        return set()
    return {str(v["price"]) for v in variants}


def _new_ai_messages(messages: list[Any]) -> list[AIMessage]:
    return [m for m in messages if isinstance(m, AIMessage)]


def _tool_calls_in(messages: list[Any]) -> list[str]:
    names: list[str] = []
    for m in messages:
        if isinstance(m, AIMessage):
            for call in m.tool_calls or []:
                names.append(call["name"])
    return names


def _tool_message_amounts(messages: list[Any]) -> list[str]:
    amounts: list[str] = []
    for m in messages:
        if isinstance(m, ToolMessage):
            amounts.extend(_prices_in(str(m.content)))
    return amounts


def _tool_errors(messages: list[Any]) -> list[str]:
    """Texto de las herramientas que devolvieron ERROR: este turno. Sirve
    para diagnosticar un fallo real de backend, no solo reprobar el caso."""
    errors: list[str] = []
    for m in messages:
        if isinstance(m, ToolMessage) and str(m.content).startswith("ERROR:"):
            errors.append(f"{m.name}: {m.content}")
    return errors


def _raw_reply(messages: list[Any]) -> str:
    for m in reversed(messages):
        if isinstance(m, AIMessage) and isinstance(m.content, str) and m.content.strip():
            return m.content.strip()
    return ""


def _usage(messages: list[Any]) -> dict[str, int]:
    input_tokens = output_tokens = calls = 0
    for m in messages:
        if isinstance(m, AIMessage):
            calls += 1
            usage = getattr(m, "usage_metadata", None)
            if usage:
                input_tokens += usage.get("input_tokens", 0) or 0
                output_tokens += usage.get("output_tokens", 0) or 0
    return {"calls": calls, "input_tokens": input_tokens, "output_tokens": output_tokens}


def _evaluate_turn(turn: Turn, *, tools_called: list[str], reply: str, state: dict[str, Any]) -> list[str]:
    """Devuelve la lista de fallas (vacía si el turno pasó)."""
    failures: list[str] = []
    tools_set = set(tools_called)

    for tool_name in turn.expect_tools:
        if tool_name not in tools_set:
            failures.append(f"no llamó {tool_name} (llamó: {sorted(tools_set) or 'ninguna'})")
    for tool_name in turn.forbid_tools:
        if tool_name in tools_set:
            failures.append(f"llamó {tool_name}, que estaba prohibida este turno")

    if turn.expect_stage is not None and state.get("stage") != turn.expect_stage:
        failures.append(f"etapa {state.get('stage')} ≠ {turn.expect_stage}")
    if turn.expect_handoff is not None and bool(state.get("handoff")) != turn.expect_handoff:
        failures.append(f"handoff {bool(state.get('handoff'))} ≠ {turn.expect_handoff}")

    cart_skus = {line.get("sku") for line in (state.get("cart") or [])}
    for sku in turn.expect_cart_skus:
        if sku not in cart_skus:
            failures.append(f"el carrito no tiene {sku} (tiene: {sorted(s for s in cart_skus if s)})")
    for sku in turn.expect_cart_absent_skus:
        if sku in cart_skus:
            failures.append(f"el carrito todavía tiene {sku}")

    customer = state.get("customer") or {}
    for field_name in turn.expect_customer_has:
        if not customer.get(field_name):
            failures.append(f"el cliente no tiene {field_name} guardado")

    if turn.expect_quote_issued is not None:
        has_quote = bool(state.get("quote_id"))
        if has_quote != turn.expect_quote_issued:
            failures.append(f"cotización emitida={has_quote} ≠ {turn.expect_quote_issued}")
    if turn.expect_checkout_issued is not None:
        has_checkout = bool(state.get("checkout_link"))
        if has_checkout != turn.expect_checkout_issued:
            failures.append(f"enlace de pago emitido={has_checkout} ≠ {turn.expect_checkout_issued}")

    for pattern in turn.expect_reply_patterns:
        if not re.search(pattern, reply):
            failures.append(f"la respuesta no cumple el patrón esperado: {pattern!r}")
    for pattern in turn.forbid_reply_patterns:
        if re.search(pattern, reply):
            failures.append(f"la respuesta repite algo que ya debía saber: {pattern!r}")

    if not reply.strip() and not state.get("handoff"):
        failures.append("respuesta vacía")

    return failures


async def _run_case(
    case: EvalCase,
    *,
    agent: Any,
    catalog_prices: set[str],
    run_id: str,
) -> dict[str, Any]:
    thread_id = f"eval:{run_id}:{case.id}"
    config = {"configurable": {"thread_id": thread_id}, "recursion_limit": 40}
    context: TurnContext = {
        "tenant_id": "eval-tenant",
        "conversation_id": case.id,
        "channel": case.channel,
        "scopes": list(case.scopes),
        "customer_phone": case.customer_phone,
        "customer_name": case.customer_name,
        "customer_email": case.customer_email,
    }

    seen_ids: set[str] = set()
    allowed_amounts: set[str] = set(catalog_prices)
    turn_reports: list[dict[str, Any]] = []
    invented_price_hits: list[str] = []
    markdown_hits: list[str] = []
    totals_usage = {"calls": 0, "input_tokens": 0, "output_tokens": 0}
    transcript: list[dict[str, str]] = []
    case_passed = True

    for index, turn in enumerate(case.turns):
        started = time.perf_counter()
        try:
            result = await agent.ainvoke(
                {"messages": [HumanMessage(content=turn.text)]},
                config=config,
                context=context,
            )
        except Exception as exc:  # noqa: BLE001 - un fallo del turno es un fallo del caso, no del runner
            turn_reports.append(
                {
                    "turn": index,
                    "input": turn.text,
                    "pass": False,
                    "failures": [f"el agente lanzó una excepción: {exc}"],
                }
            )
            case_passed = False
            break

        messages = result.get("messages", [])
        # Diferencia por id, no por longitud: el checkpointer puede
        # deep-copiar o reordenar la lista entre invocaciones, y contar por
        # posición perdía turnos enteros de herramientas cuando eso pasaba.
        new_messages = [m for m in messages if getattr(m, "id", None) not in seen_ids]
        seen_ids |= {m.id for m in messages if getattr(m, "id", None) is not None}

        tools_called = _tool_calls_in(new_messages)
        reply = _raw_reply(new_messages) or _raw_reply(messages)
        allowed_amounts |= set(_tool_message_amounts(new_messages))

        invented = _invented_prices(reply, allowed_amounts)
        markdown = _markdown_violations(reply)
        usage = _usage(new_messages)
        for key in totals_usage:
            totals_usage[key] += usage[key]

        state = {
            "stage": result.get("stage"),
            "handoff": result.get("handoff"),
            "cart": result.get("cart"),
            "customer": result.get("customer"),
            "quote_id": result.get("quote_id"),
            "checkout_link": result.get("checkout_link"),
        }
        failures = _evaluate_turn(turn, tools_called=tools_called, reply=reply, state=state)
        if invented:
            failures.append(f"precio inventado: {invented}")
            invented_price_hits.extend(invented)
        if markdown:
            failures.append(f"formato no apto para WhatsApp: {markdown}")
            markdown_hits.extend(markdown)

        passed = not failures
        case_passed = case_passed and passed
        transcript.append({"role": "cliente", "text": turn.text})
        transcript.append({"role": "agente", "text": reply})

        turn_reports.append(
            {
                "turn": index,
                "input": turn.text,
                "reply": reply,
                "toolsCalled": tools_called,
                "toolErrors": _tool_errors(new_messages),
                "state": {
                    "stage": state["stage"],
                    "handoff": state["handoff"],
                    "cartSkus": [c.get("sku") for c in (state["cart"] or [])],
                    "customerFields": sorted((state["customer"] or {}).keys()),
                    "quoteIssued": bool(state["quote_id"]),
                    "checkoutIssued": bool(state["checkout_link"]),
                },
                "pass": passed,
                "failures": failures,
                "latencyMs": int((time.perf_counter() - started) * 1000),
                "usage": usage,
            }
        )

    return {
        "id": case.id,
        "category": case.category,
        "pass": case_passed,
        "turns": turn_reports,
        "invented_price_hits": invented_price_hits,
        "markdown_hits": markdown_hits,
        "usage": totals_usage,
        "transcript": transcript,
        "notes": case.notes,
        "judge_requested": case.judge,
    }


def _select_cases(
    *, categories: list[str] | None, case_ids: list[str] | None, limit: int | None
) -> list[EvalCase]:
    cases = build_dataset()
    if case_ids:
        wanted = set(case_ids)
        cases = [c for c in cases if c.id in wanted]
    if categories:
        wanted_cats = set(categories)
        cases = [c for c in cases if c.category in wanted_cats]
    if limit is not None:
        # `limit` acota casos POR CATEGORÍA, no el total: así una corrida
        # chica sigue tocando todas las categorías en vez de agotarse en la
        # primera.
        by_category: dict[str, list[EvalCase]] = {}
        for c in cases:
            by_category.setdefault(c.category, []).append(c)
        cases = [c for group in by_category.values() for c in group[:limit]]
    return cases


def plan(
    *,
    categories: list[str] | None = None,
    case_ids: list[str] | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    """Cuenta casos/turnos sin llamar a nada. Para decidir el gasto antes de correr."""
    cases = _select_cases(categories=categories, case_ids=case_ids, limit=limit)
    turns = sum(c.turn_count for c in cases)
    return {
        "cases": len(cases),
        "turns": turns,
        "estimatedModelCallsRange": [turns, turns * 3],
        "caseIds": [c.id for c in cases],
        "note": (
            "cada turno es al menos 1 llamada al modelo; puede ser más si el "
            "agente encadena varias herramientas antes de responder (tope: "
            "recursion_limit=40). El rango de arriba es una cota gruesa, no "
            "una medición."
        ),
    }


async def run_suite(
    *,
    categories: list[str] | None = None,
    case_ids: list[str] | None = None,
    limit: int | None = None,
    judge: bool = False,
    dry_run: bool = False,
) -> dict[str, Any]:
    started = time.perf_counter()
    cases = _select_cases(categories=categories, case_ids=case_ids, limit=limit)

    if dry_run:
        return {"mode": "dry-run", **plan(categories=categories, case_ids=case_ids, limit=limit)}

    settings = get_settings()
    warnings: list[str] = []
    if not settings.llm_live:
        warnings.append("OPENROUTER_KEY_REF no configurada: la corrida fallará en el primer turno")
    if not settings.commerce_live:
        warnings.append("AGENT_API_KEY_REF no configurada: sin catálogo real, la compuerta de precios pierde cobertura")

    catalog_prices = await _fetch_catalog_prices(settings)
    checkpointer = InMemorySaver()
    agent = build_agent(checkpointer, settings)  # type: ignore[arg-type]  # InMemorySaver cumple el protocolo async

    run_id = str(int(started))
    case_reports: list[dict[str, Any]] = []
    for case in cases:
        report = await _run_case(case, agent=agent, catalog_prices=catalog_prices, run_id=run_id)
        if judge and case.judge:
            from .judge import judge_conversation  # import diferido: solo si se pide juicio

            report["judge"] = await judge_conversation(report["transcript"], settings)
        case_reports.append(report)

    per_category: dict[str, dict[str, Any]] = {}
    for report in case_reports:
        bucket = per_category.setdefault(
            report["category"], {"numerator": 0, "denominator": 0, "failures": []}
        )
        bucket["denominator"] += 1
        if report["pass"]:
            bucket["numerator"] += 1
        else:
            bucket["failures"].append(
                {
                    "id": report["id"],
                    "detail": [f for t in report["turns"] for f in t["failures"]],
                }
            )
    for bucket in per_category.values():
        bucket["rate"] = round(bucket["numerator"] / bucket["denominator"], 4) if bucket["denominator"] else 0.0

    total_calls = sum(r["usage"]["calls"] for r in case_reports)
    total_input = sum(r["usage"]["input_tokens"] for r in case_reports)
    total_output = sum(r["usage"]["output_tokens"] for r in case_reports)
    estimated_cost_usd = round(
        total_input / 1_000_000 * _PRICE_PER_1M_INPUT + total_output / 1_000_000 * _PRICE_PER_1M_OUTPUT,
        4,
    )

    all_invented = [h for r in case_reports for h in r["invented_price_hits"]]
    all_markdown = [h for r in case_reports for h in r["markdown_hits"]]
    gates = {
        "sin_precio_inventado": {"pass": not all_invented, "failures": all_invented},
        "formato_whatsapp": {"pass": not all_markdown, "failures": all_markdown},
    }

    total_passed = sum(1 for r in case_reports if r["pass"])
    critical_ok = all(g["pass"] for g in gates.values())

    return {
        "mode": "live",
        "model": settings.model,
        "warnings": warnings,
        "totals": {
            "numerator": total_passed,
            "denominator": len(case_reports),
            "rate": round(total_passed / len(case_reports), 4) if case_reports else 0.0,
        },
        "categories": per_category,
        "criticalGates": gates,
        "release": "PASS" if critical_ok and total_passed == len(case_reports) else "BLOCKED",
        "usage": {
            "modelCalls": total_calls,
            "inputTokens": total_input,
            "outputTokens": total_output,
            "estimatedCostUsd": estimated_cost_usd,
            "pricingAssumed": f"gpt-4o-mini vía OpenRouter: ${_PRICE_PER_1M_INPUT}/1M in, ${_PRICE_PER_1M_OUTPUT}/1M out (aprox., no es la factura real)",
        },
        "durationMs": int((time.perf_counter() - started) * 1000),
        "cases": case_reports,
    }
