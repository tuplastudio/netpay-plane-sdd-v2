"""Ejecuta la suite de evaluación del agente v2 desde la línea de comandos.

  python -m app.evals                         # dataset completo (real, cuesta dinero)
  python -m app.evals --dry-run                # solo cuenta casos/turnos, no llama a nada
  python -m app.evals --category tool_correcto # una sola categoría
  python -m app.evals --case mt-01-carrito-cliente-cotizacion-pago
  python -m app.evals --limit 1                # como mucho 1 caso por categoría
  python -m app.evals --judge                  # + juicio por LLM en las conversaciones marcadas
  python -m app.evals --report evals.json

Requiere las mismas variables de entorno que el servicio: OPENROUTER_KEY_REF,
COMMERCE_API_URL, AGENT_API_KEY_REF, PUBLIC_BASE_URL, AGENT_V2_DATA_DIR.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from .runner import plan, run_suite


def main() -> int:
    parser = argparse.ArgumentParser(description="Suite de evaluación del agente v2")
    parser.add_argument("--category", action="append", dest="categories", help="repetible")
    parser.add_argument("--case", action="append", dest="case_ids", help="id exacto, repetible")
    parser.add_argument("--limit", type=int, default=None, help="máximo de casos POR categoría")
    parser.add_argument("--judge", action="store_true", help="añade juicio por LLM (llamadas extra)")
    parser.add_argument("--dry-run", action="store_true", help="solo cuenta casos/turnos, no llama a nada")
    parser.add_argument("--report", type=Path, help="guarda el reporte JSON completo")
    parser.add_argument("--quiet", action="store_true", help="solo el resumen")
    args = parser.parse_args()

    if not args.dry_run:
        forecast = plan(categories=args.categories, case_ids=args.case_ids, limit=args.limit)
        print(
            f"plan: {forecast['cases']} casos, {forecast['turns']} turnos "
            f"(~{forecast['estimatedModelCallsRange'][0]}-{forecast['estimatedModelCallsRange'][1]} "
            "llamadas al modelo). Esto cuesta dinero real."
        )

    report = asyncio.run(
        run_suite(
            categories=args.categories,
            case_ids=args.case_ids,
            limit=args.limit,
            judge=args.judge,
            dry_run=args.dry_run,
        )
    )

    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if report["mode"] == "dry-run":
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    for warning in report.get("warnings", []):
        print(f"  ADVERTENCIA: {warning}")

    totals = report["totals"]
    usage = report["usage"]
    print(f"modo: {report['mode']}  modelo: {report['model']}")
    print(f"total: {totals['numerator']}/{totals['denominator']} ({totals['rate']:.2%})")
    for category, data in report["categories"].items():
        print(f"  {category:<24} {data['numerator']}/{data['denominator']} ({data['rate']:.0%})")
    for name, gate in report["criticalGates"].items():
        print(f"  [{'ok ' if gate['pass'] else 'FAIL'}] compuerta {name}")
        for failure in gate["failures"]:
            print(f"        {failure}")

    if not args.quiet:
        for report_case in report["cases"]:
            if not report_case["pass"]:
                print(f"  {report_case['category']}/{report_case['id']}:")
                for t in report_case["turns"]:
                    for f in t["failures"]:
                        print(f"      turno {t['turn']} ({t['input'][:40]!r}): {f}")

    print(
        f"llamadas al modelo: {usage['modelCalls']}  tokens: {usage['inputTokens']}in/"
        f"{usage['outputTokens']}out  costo estimado: ${usage['estimatedCostUsd']} "
        f"({usage['pricingAssumed']})"
    )
    print(f"release: {report['release']}")
    return 0 if report["release"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
