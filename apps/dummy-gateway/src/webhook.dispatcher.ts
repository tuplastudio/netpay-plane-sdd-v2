import { Injectable, Logger } from "@nestjs/common";
import { createHmac } from "node:crypto";
import type { CheckoutSession } from "@netpay/contracts";

/**
 * Despacha webhook firmado al endpoint configurado por el caller (la API comercial).
 * HMAC SHA256 sobre body crudo con secreto compartido.
 */
@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  async dispatch(targetUrl: string, session: CheckoutSession, secret: string): Promise<void> {
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