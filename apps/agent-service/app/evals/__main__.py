"""Ejecuta la suite de evaluación desde la línea de comandos.

  python3 -m app.evals            # fixtures deterministas
  python3 -m app.evals --live     # además llama al modelo configurado
  python3 -m app.evals --report evals.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from .runner import run_suite


def main() -> int:
    parser = argparse.ArgumentParser(description="Suite de evaluación del agente")
    parser.add_argument("--live", action="store_true", help="usa el LLM configurado")
    parser.add_argument("--report", type=Path, help="guarda el reporte JSON completo")
    parser.add_argument("--quiet", action="store_true", help="solo el resumen")
    args = parser.parse_args()

    report = asyncio.run(run_suite(live=args.live))

    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    totals = report["totals"]
    print(f"modo: {report['mode']}  prompt: {report['promptVersion']}")
    print(f"total: {totals['numerator']}/{totals['denominator']} ({totals['rate']:.2%})")
    for category, data in report["categories"].items():
        flag = "ok " if data["meets"] else "FAIL"
        print(
            f"  [{flag}] {category:<18} {data['numerator']}/{data['denominator']} "
            f"(meta {data['target']:.0%})"
        )
    for name, gate in report["criticalGates"].items():
        print(f"  [{'ok ' if gate['pass'] else 'FAIL'}] compuerta {name}")
        for failure in gate["failures"]:
            print(f"        {failure}")

    if not args.quiet:
        for category, data in report["categories"].items():
            for failure in data["failures"]:
                print(f"    {category}/{failure['id']}: {failure['input']} → {failure['detail']}")

    print(f"release: {report['release']}")
    return 0 if report["release"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
