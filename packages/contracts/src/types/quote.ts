import type { Iso8601, Money, Quantity, ResourceId, TenantId } from "./common.js";

export interface QuoteLine {
  variantId: ResourceId;
  sku: string;
  title: string;
  quantity: Quantity;
  unitPrice: Money;
  discountPct: number; // 0..100, dos decimales
  lineSubtotal: Money; // quantity * unitPrice * (1 - discountPct/100)
  satProductCode: string;
  satUnitCode: string;
}

export interface QuoteTotals {
  subtotal: Money;
  discount: Money;
  tax: Money; // IVA
  shipping: Money;
  total: Money;
}

export interface Quote {
  id: ResourceId;
  tenantId: TenantId;
  customerId: ResourceId;
  status: "DRAFT" | "ISSUED" | "EXPIRED" | "ACCEPTED" | "CANCELLED";
  configVersion: number;
  lines: QuoteLine[];
  totals: QuoteTotals;
  issuedAt: Iso8601 | null;
  expiresAt: Iso8601;
  acceptedAt: Iso8601 | null;
  cancelledAt: Iso8601 | null;
  createdAt: Iso8601;
  updatedAt: Iso8601;
  version: number;
}

export interface CreateQuoteRequest {
  customerId: ResourceId;
  lines: Array<{
    variantId: ResourceId;
    quantity: Quantity;
    discountPct?: number; // seller discount, default 0
  }>;
  notes?: string;
}

export interface AcceptQuoteRequest {
  expectedVersion: number;
}