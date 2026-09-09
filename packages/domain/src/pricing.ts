import { applyDiscount, qtyTimesPrice } from "./money.js";

export interface QuoteLineInput {
  variantId: string;
  quantity: string;
  unitPrice: string;
  discountPct: number; // 0..100
}

export interface QuoteTotals {
  subtotal: string;
  discount: string;
  taxBase: string; // subtotal - discount
  tax: string; // 16% IVA sobre taxBase
  shipping: string;
  total: string;
}

export interface PricingConfig {
  taxRatePct: number; // ej. 16
  shippingFlat: string; // "0.00" si es pickup
}

export const DEFAULT_TAX_RATE_PCT = 16;

/** Conversión interna: de string MXN a cents (BigInt). */
function toCents(value: string): bigint {
  const parts = value.split(".");
  const int = parts[0] ?? "0";
  const frac = parts[1] ?? "";
  const fracPadded = (frac + "00").slice(0, 2);
  return BigInt(int) * 100n + BigInt(fracPadded);
}

function fromCents(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  const int = abs / 100n;
  const frac = abs % 100n;
  return `${sign}${int.toString()}.${frac.toString().padStart(2, "0")}`;
}

/** Calcula totales de cotización. Acepta descuento por línea, valida topes. */
export function calculateQuoteTotals(
  lines: QuoteLineInput[],
  config: PricingConfig,
): QuoteTotals {
  if (lines.length === 0) {
    throw new Error("Quote must have at least one line");
  }
  if (lines.length > 200) {
    throw new Error("Quote exceeds 200 lines limit");
  }

  let subtotalCents = 0n;
  let discountCents = 0n;

  for (const line of lines) {
    const lineSubtotal = qtyTimesPrice(line.quantity, line.unitPrice);
    const lineAfterDiscount = applyDiscount(lineSubtotal, line.discountPct);
    const subC = toCents(lineSubtotal);
    const afterC = toCents(lineAfterDiscount);
    subtotalCents += subC;
    discountCents += subC - afterC;
  }

  const taxBaseCents = subtotalCents - discountCents;

  // tax = taxBase * pct / 100  (half-up en cents)
  const taxFactor = BigInt(Math.round(config.taxRatePct * 10000));
  const taxCents = (taxBaseCents * taxFactor + 500_000n) / 1_000_000n;

  const shippingCents = toCents(config.shippingFlat);
  const totalCents = taxBaseCents + taxCents + shippingCents;

  return {
    subtotal: fromCents(subtotalCents),
    discount: fromCents(discountCents),
    taxBase: fromCents(taxBaseCents),
    tax: fromCents(taxCents),
    shipping: fromCents(shippingCents),
    total: fromCents(totalCents),
  };
}