import { Injectable, Logger } from "@nestjs/common";
import { createHmac } from "node:crypto";
import type { CheckoutSession } from "@netpay/contracts";
import type { BillingDetails, CardSummary, SessionCustomer } from "./checkout.store.js";

/**
 * Campos adicionales que la sesión puede traer tras el cobro. Son opcionales
 * para que el dispatcher siga aceptando un `CheckoutSession` pelado (como en
 * las pruebas); si están, viajan en el webhook.
 */
export interface WebhookSessionExtras {
  billing?: BillingDetails;
  card?: CardSummary;
  email?: string;
  customer?: SessionCustomer;
  metadata?: Record<string, string>;
  failureReason?: string;
  requiresInvoice?: boolean;
  billingRequired?: boolean;
}

/**
 * Despacha webhook firmado al endpoint configurado por el caller (la API comercial).
 * HMAC SHA256 sobre body crudo con secreto compartido.
 *
 * Contrato del payload: los campos originales (eventName, status, eventId,
 * sessionId, orderId, amount, currency, livemode, occurredAt) se mantienen
 * siempre; los nuevos (billing, card, email, customer, metadata,
 * failureReason, requiresInvoice, billingRequired) solo van cuando existen.
 */
@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  async dispatch(
    targetUrl: string,
    session: CheckoutSession & WebhookSessionExtras,
    secret: string,
  ): Promise<void> {
    const payload = JSON.stringify({
      eventName: session.status === "CAPTURED" ? "payment.captured" : `payment.${session.status.toLowerCase()}`,
      status: session.status,
      eventId: session.id,
      sessionId: session.id,
      orderId: session.orderId,
      amount: session.amount,
      currency: session.currency,
      livemode: false,
      occurredAt: new Date().toISOString(),
      ...(session.billing ? { billing: session.billing } : {}),
      ...(session.card ? { card: session.card } : {}),
      ...(session.email ? { email: session.email } : {}),
      ...(session.customer ? { customer: session.customer } : {}),
      ...(session.metadata ? { metadata: session.metadata } : {}),
      ...(session.failureReason ? { failureReason: session.failureReason } : {}),
      ...(session.requiresInvoice !== undefined ? { requiresInvoice: session.requiresInvoice } : {}),
      ...(session.billingRequired !== undefined ? { billingRequired: session.billingRequired } : {}),
    });
    const signature = createHmac("sha256", secret).update(payload).digest("hex");

    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dummy-signature": signature,
          "x-dummy-event": "payment.status_changed",
        },
        body: payload,
      });
      if (!res.ok) {
        this.logger.warn(`Webhook ${targetUrl} responded ${res.status}`);
      }
    } catch (err) {
      this.logger.error(`Webhook delivery failed: ${String(err)}`);
    }
  }
}
