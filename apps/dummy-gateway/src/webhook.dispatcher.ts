import { Injectable, Logger } from "@nestjs/common";
import { createHmac } from "node:crypto";
import type { CheckoutSession } from "@netpay/contracts";
import type { BillingDetails, CardSummary, PaymentMethod, SessionCustomer } from "./checkout.store.js";

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
  paymentMethod?: PaymentMethod;
  paymentReference?: string;
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
      ...(session.paymentMethod ? { paymentMethod: session.paymentMethod } : {}),
      ...(session.paymentReference ? { paymentReference: session.paymentReference } : {}),
    });
    const signature = createHmac("sha256", secret).update(payload).digest("hex");

    const maxAttempts = webhookMaxAttempts();
    const baseDelayMs = webhookRetryBaseMs();
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let retryable: boolean;
      let reason: string;
      try {
        const res = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-dummy-signature": signature,
            "x-dummy-event": "payment.status_changed",
          },
          body: payload,
          // Sin tope, un receptor colgado bloquea el "Pagar" del cliente y un
          // intento colgado nunca llega a los reintentos.
          signal: AbortSignal.timeout(webhookAttemptTimeoutMs()),
        });
        if (res.ok) {
          if (attempt > 1) {
            this.logger.log(`Webhook ${targetUrl} entregado en el intento ${attempt}/${maxAttempts}`);
          }
          return;
        }
        // 4xx = el receptor rechazó el evento (firma, importe, payload):
        // reintentar no lo arregla. Solo 5xx (o 408/429) se reintentan.
        retryable = res.status >= 500 || res.status === 408 || res.status === 429;
        reason = `HTTP ${res.status}`;
      } catch (err) {
        retryable = true;
        reason = String(err);
      }
      if (!retryable || attempt === maxAttempts) {
        this.logger.error(
          `Webhook ${targetUrl} sesión ${session.id} falló (intento ${attempt}/${maxAttempts}): ${reason}` +
            (retryable ? " — sin más reintentos" : " — no reintentable"),
        );
        return;
      }
      const delay = baseDelayMs * 2 ** (attempt - 1);
      this.logger.warn(
        `Webhook ${targetUrl} sesión ${session.id} falló (intento ${attempt}/${maxAttempts}): ${reason}; reintento en ${delay} ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/** Intentos totales de entrega (1 + reintentos). `WEBHOOK_MAX_ATTEMPTS`, 1..10, default 4. */
function webhookMaxAttempts(): number {
  const n = Number(process.env.WEBHOOK_MAX_ATTEMPTS);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 4;
}

/**
 * Espera antes del primer reintento; se duplica en cada uno (250, 500, 1000 ms
 * con el default). `WEBHOOK_RETRY_BASE_MS`, 0..30000. Corto a propósito: la
 * entrega se espera dentro de la petición de la página hosted.
 */
/** Tope por intento de entrega del webhook (WEBHOOK_ATTEMPT_TIMEOUT_MS, default 8 s). */
function webhookAttemptTimeoutMs(): number {
  const raw = Number.parseInt(process.env.WEBHOOK_ATTEMPT_TIMEOUT_MS ?? "8000", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 8000;
}

function webhookRetryBaseMs(): number {
  const n = Number(process.env.WEBHOOK_RETRY_BASE_MS);
  return Number.isFinite(n) && n >= 0 && n <= 30_000 ? n : 250;
}
