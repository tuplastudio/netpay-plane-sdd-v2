/**
 * Aritmética y máquina de estados del reembolso — SIN dependencias de Nest ni
 * de la base. Todo el dinero es `Prisma.Decimal` (decimal.js con precisión
 * arbitraria), nunca `number`: los importes son `Decimal(12,2)` y
 * `Number(a) + Number(b)` acumula error binario (0.1 + 0.2 = 0.30000000000000004).
 *
 * La decisión que vive aquí es exactamente la misma que ejecuta el UPDATE
 * condicional de `PaymentService#refund` en SQL. Está separada para poder
 * probarla como función pura y para que la regla exista escrita en un único
 * sitio legible.
 */

import { Prisma } from "@prisma/client";

export type RefundableStatus = "CAPTURED" | "PARTIALLY_REFUNDED";
export type RefundedStatus = "PARTIALLY_REFUNDED" | "REFUNDED";

/** Estados de sesión sobre los que se admite un (nuevo) reembolso. */
export const REFUNDABLE_STATUSES: readonly RefundableStatus[] = [
  "CAPTURED",
  "PARTIALLY_REFUNDED",
];

/** `Decimal(12,2)` positivo o cero: hasta 10 enteros y como mucho 2 decimales. */
const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;

export const ZERO = new Prisma.Decimal(0);

/**
 * Convierte el importe que llega por HTTP a `Decimal`. Devuelve `null` si no
 * es un decimal con la forma de `Decimal(12,2)`.
 *
 * Se valida con expresión regular ANTES de construir el `Decimal` porque
 * `new Decimal("1e9")`, `new Decimal("0.005")` o `new Decimal(" 12 ")` se
 * aceptarían y luego Postgres redondearía en silencio al escribir.
 */
export function parseMoney(raw: unknown): Prisma.Decimal | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return parseMoney(raw.toFixed(2));
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!MONEY_RE.test(trimmed)) return null;
  return new Prisma.Decimal(trimmed);
}

export type RefundDecision =
  | {
      ok: true;
      /** Acumulado tras aplicar el reembolso. Siempre <= `amount`. */
      refundedTotal: Prisma.Decimal;
      /** Neto que queda vivo en la sesión: `amount - refundedTotal`. */
      netTotal: Prisma.Decimal;
      /** Estado a escribir. `REFUNDED` solo al alcanzar el importe completo. */
      status: RefundedStatus;
      /** `true` cuando el acumulado alcanza exactamente `amount`. */
      fullyRefunded: boolean;
    }
  | { ok: false; reason: "NOT_POSITIVE" | "NOT_REFUNDABLE" | "EXCEEDS_AMOUNT" };

/**
 * Regla única del reembolso.
 *
 *   refundedTotal' = refundedTotal + refund
 *   status'        = refundedTotal' >= amount ? REFUNDED : PARTIALLY_REFUNDED
 *
 * Rechaza importes no positivos, sesiones que no admiten reembolso y todo
 * acumulado que se pasaría del importe de la sesión. Comparaciones con
 * `Decimal#cmp`, nunca con `<`/`>` sobre `number`.
 */
export function decideRefund(input: {
  status: string;
  amount: Prisma.Decimal;
  refundedTotal: Prisma.Decimal;
  refund: Prisma.Decimal;
}): RefundDecision {
  if (input.refund.lessThanOrEqualTo(ZERO)) return { ok: false, reason: "NOT_POSITIVE" };
  if (!(REFUNDABLE_STATUSES as readonly string[]).includes(input.status)) {
    return { ok: false, reason: "NOT_REFUNDABLE" };
  }
  const next = input.refundedTotal.plus(input.refund);
  if (next.greaterThan(input.amount)) return { ok: false, reason: "EXCEEDS_AMOUNT" };

  const fullyRefunded = next.equals(input.amount);
  return {
    ok: true,
    refundedTotal: next,
    netTotal: input.amount.minus(next),
    status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
    fullyRefunded,
  };
}

/** Lo que aún se puede reembolsar de una sesión. Nunca negativo. */
export function remainingRefundable(
  amount: Prisma.Decimal,
  refundedTotal: Prisma.Decimal,
): Prisma.Decimal {
  const remaining = amount.minus(refundedTotal);
  return remaining.lessThan(ZERO) ? ZERO : remaining;
}
