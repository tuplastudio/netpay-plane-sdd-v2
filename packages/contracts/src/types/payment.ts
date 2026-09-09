import type { Iso8601, Money, RequestEnvelope, ResourceId, TenantId } from "./common.js";

export type PaymentStatus =
  | "PENDING"
  | "AUTHORIZED"
  | "CAPTURED"
  | "FAILED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "CANCELLED"
  | "UNKNOWN";

export interface CheckoutSession {
  id: ResourceId;
  tenantId: TenantId;
  orderId: ResourceId;
  amount: Money;
  currency: "MXN";
  status: PaymentStatus;
  livemode: false;
  expiresAt: Iso8601;
  createdAt: Iso8601;
  updatedAt: Iso8601;
  version: number;
}

export interface CreateCheckoutRequest {
  orderId: ResourceId;
  expectedOrderVersion: number;
}

export interface CreateCheckoutResponse {
  sessionId: ResourceId;
  checkoutUrl: string; // dummy hosted checkout
  expiresAt: Iso8601;
}

export type CreateCheckoutResult = RequestEnvelope<CreateCheckoutResponse>;

export interface RefundRequest {
  checkoutSessionId: ResourceId;
  amount: Money;
  reason: string;
}

export interface LedgerEntry {
  id: ResourceId;
  tenantId: TenantId;
  sessionId: ResourceId;
  entryType: "CHARGE" | "REFUND" | "FEE" | "ADJUSTMENT";
  amount: Money;
  balanceAfter: Money;
  description: string;
  recordedAt: Iso8601;
}