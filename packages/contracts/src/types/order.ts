import type { Iso8601, Money, ResourceId, TenantId } from "./common.js";
import type { QuoteTotals } from "./quote.js";

export interface Order {
  id: ResourceId;
  tenantId: TenantId;
  customerId: ResourceId;
  source: "QUOTE" | "DIRECT" | "CHAT";
  status:
    | "DRAFT"
    | "CHECKOUT_OPEN"
    | "AWAITING_PAYMENT"
    | "PAID"
    | "FULFILLED"
    | "CANCELLED"
    | "EXPIRED";
  totals: QuoteTotals;
  checkoutRevision: number;
  currentRevisionId: ResourceId | null;
  placedAt: Iso8601 | null;
  paidAt: Iso8601 | null;
  fulfilledAt: Iso8601 | null;
  cancelledAt: Iso8601 | null;
  expiresAt: Iso8601 | null;
  createdAt: Iso8601;
  updatedAt: Iso8601;
  version: number;
}

export interface OrderRevision {
  id: ResourceId;
  orderId: ResourceId;
  revisionNumber: number;
  status: "OPEN" | "ACCEPTED" | "CANCELLED" | "EXPIRED";
  total: Money;
  deliveryMode: "PICKUP" | "LOCAL_DELIVERY";
  addressId: ResourceId | null;
  acceptedAt: Iso8601 | null;
  expiresAt: Iso8601;
}

export interface PublicCheckout {
  token: string; // opaco
  orderId: ResourceId;
  revisionId: ResourceId;
  total: Money;
  expiresAt: Iso8601;
}

export interface CheckoutResult {
  status: "PAID" | "EXPIRED" | "CANCELLED" | "PENDING";
  orderId: ResourceId;
  total: Money;
  livemode: false;
}