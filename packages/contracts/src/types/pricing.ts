/**
 * Calculadora oficial de importes (`POST /pricing/preview`).
 *
 * Es la única fuente de totales del sistema: el portal y el agente IA la usan
 * en lugar de estimar precios. No crea cotización ni pedido.
 */

import type { Money, Quantity, ResourceId } from "./common.js";

export interface PricingLineInput {
  variantId: ResourceId;
  quantity: Quantity;
  /** Descuento por línea; el backend valida el máximo del tenant. */
  discountPct?: number;
}

export type DeliveryMode = "PICKUP" | "LOCAL_DELIVERY";

export interface PricingPreviewRequest {
  lines: PricingLineInput[];
  deliveryMode?: DeliveryMode;
}

export interface PricingTotals {
  subtotal: Money;
  discount: Money;
  taxBase: Money;
  tax: Money;
  shipping: Money;
  total: Money;
}

export interface PricingPreviewLine {
  variantId: ResourceId;
  sku: string;
  title: string;
  quantity: Quantity;
  unitPrice: Money;
  discountPct: number;
  lineSubtotal: Money;
  satProductCode: string;
  satUnitCode: string;
}

export interface PricingPreviewData {
  lines: PricingPreviewLine[];
  totals: PricingTotals;
  deliveryMode: DeliveryMode;
}
