import type { Iso8601, TenantId } from "./common.js";

/** Eventos canónicos publicados al broker. */
export type EventName =
  | "quote.created"
  | "quote.issued"
  | "quote.accepted"
  | "quote.expired"
  | "order.created"
  | "order.checkout_opened"
  | "order.paid"
  | "order.cancelled"
  | "order.expired"
  | "payment.checkout_created"
  | "payment.captured"
  | "payment.failed"
  | "payment.refunded"
  | "channel.message_received"
  | "channel.message_sent"
  | "agent.handoff"
  | "integration.outbox_published";

export interface EventEnvelope<T = unknown> {
  schemaVersion: 1;
  eventName: EventName;
  eventId: string; // UUIDv7, dedup key
  aggregateId: string;
  aggregateVersion: number;
  tenantId: TenantId;
  origin: string; // service name
  livemode: false;
  occurredAt: Iso8601;
  data: T;
}