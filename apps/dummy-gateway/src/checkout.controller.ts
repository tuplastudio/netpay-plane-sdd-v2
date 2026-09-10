import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  NotFoundException,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import {
  CheckoutStore,
  type BillingDetails,
  type CardSummary,
  type InternalSession,
  type PaymentOutcome,
  type SessionCustomer,
  type SessionLineItem,
  type SessionTotals,
} from "./checkout.store.js";
import { WebhookDispatcher } from "./webhook.dispatcher.js";
import {
  renderHostedCheckout,
  renderHostedFailure,
  renderHostedNotFound,
  renderHostedStatus,
  renderHostedSuccess,
} from "./hosted-page.js";

/**
 * Cuerpo que la página hosted manda al capturar/fallar. Todo opcional para
 * que los callers existentes (`POST /capture` con `{}`) sigan funcionando.
 */
interface OutcomeBody {
  reason?: string;
  email?: string;
  country?: string;
  card?: { brand?: string; last4?: string; number?: string; holder?: string };
  billing?: Partial<BillingDetails>;
}

const CARD_BRANDS = new Set(["visa", "mastercard", "amex", "unknown"]);
const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

/**
 * API del simulador. Ver docs/09-pay.md.
 *  - POST /checkout/sessions      crear sesión (autenticado por service key)
 *  - GET  /checkout/:id           ver sesión
 *  - POST /checkout/:id/capture   simular captura exitosa
 *  - POST /checkout/:id/fail      simular fallo
 *  - GET  /checkout/:id/hosted    página hosted (HTML tipo Stripe Checkout)
 */
@Controller("checkout")
export class CheckoutController {
  constructor(
    private readonly store: CheckoutStore,
    private readonly webhooks: WebhookDispatcher,
  ) {}

  @Post("sessions")
  async create(
    @Body() body: {
      amount: string;
      currency: "MXN";
      orderId: string;
      metadata?: Record<string, string>;
      successUrl?: string;
      cancelUrl?: string;
      webhookUrl?: string;
      secret?: string;
      // Presentación (opcional): ver SessionPresentation en checkout.store.ts.
      merchantName?: string;
      customer?: SessionCustomer;
      requiresInvoice?: boolean;
      billingRequired?: boolean;
      lineItems?: SessionLineItem[];
      totals?: SessionTotals;
    },
    @Headers("authorization") auth?: string,
  ) {
    const apiKey = this.extractApiKey(auth);
    const session = this.store.create({
      amount: body.amount,
      currency: body.currency,
      orderId: body.orderId,
      metadata: body.metadata,
      serviceApiKey: apiKey,
      webhookUrl: body.webhookUrl,
      webhookSecret: body.secret,
      successUrl: this.safeUrl(body.successUrl),
      cancelUrl: this.safeUrl(body.cancelUrl),
      merchantName: typeof body.merchantName === "string" ? body.merchantName.slice(0, 120) : undefined,
      customer: body.customer,
      requiresInvoice: Boolean(body.requiresInvoice),
      billingRequired: Boolean(body.billingRequired),
      lineItems: Array.isArray(body.lineItems) ? body.lineItems.slice(0, 200) : undefined,
      totals: body.totals,
    });

    return {
      data: {
        id: session.id,
        hostedUrl: `/checkout/${session.id}/hosted`,
        expiresAt: session.expiresAt,
        livemode: false,
      },
      requestId: session.id,
    };
  }

  @Get("sessions/:id")
  get(@Param("id") id: string) {
    const session = this.store.get(id);
    if (!session) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Sesión no encontrada" });
    }
    return {
      data: {
        id: session.id,
        orderId: session.orderId,
        amount: session.amount,
        currency: session.currency,
        status: session.status,
        livemode: false,
        expiresAt: session.expiresAt,
        ...(session.card ? { card: session.card } : {}),
        ...(session.billing ? { billing: session.billing } : {}),
        ...(session.email ? { email: session.email } : {}),
        ...(session.failureReason ? { failureReason: session.failureReason } : {}),
      },
      requestId: session.id,
    };
  }

  @Post("sessions/:id/capture")
  async capture(@Param("id") id: string, @Body() body: OutcomeBody = {}) {
    const current = this.store.get(id);
    if (!current) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Sesión no encontrada" });
    }
    if (current.status === "CAPTURED") {
      // Reintento idempotente: no se vuelve a disparar el webhook.
      return { data: { id: current.id, status: current.status }, requestId: current.id };
    }
    this.assertPending(current);
    const outcome = this.parseOutcome(body, current, true);
    const session = this.store.setStatus(id, "CAPTURED", outcome)!;
    await this.deliverWebhook(session);
    return { data: { id: session.id, status: session.status }, requestId: session.id };
  }

  @Post("sessions/:id/fail")
  async fail(@Param("id") id: string, @Body() body: OutcomeBody = {}) {
    const current = this.store.get(id);
    if (!current) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Sesión no encontrada" });
    }
    if (current.status === "FAILED") {
      return {
        data: { id: current.id, status: current.status, reason: current.failureReason },
        requestId: current.id,
      };
    }
    this.assertPending(current);
    // Al fallar no se exige la facturación: no hubo cobro que facturar.
    const outcome = this.parseOutcome(body, current, false);
    const session = this.store.setStatus(id, "FAILED", {
      ...outcome,
      reason: body.reason ?? "GENERIC_DECLINE",
    })!;
    await this.deliverWebhook(session);
    return {
      data: { id: session.id, status: session.status, reason: session.failureReason },
      requestId: session.id,
    };
  }

  @Get(":id/hosted")
  @Header("content-type", "text/html; charset=utf-8")
  hosted(@Param("id") id: string, @Res({ passthrough: true }) res: Response) {
    // helmet() aplica un CSP global sin 'unsafe-inline'; esta página lleva su
    // <script>/<style> inline (no hay build ni CDN), así que se relaja aquí.
    // Los iconos son SVG inline y el chevron del <select> un data: URI.
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    );
    res.setHeader("Cache-Control", "no-store");
    const session = this.store.get(id);
    if (!session) {
      res.status(404);
      return renderHostedNotFound();
    }
    switch (session.status) {
      case "PENDING":
        return renderHostedCheckout(session);
      case "CAPTURED":
        return renderHostedSuccess(session);
      case "FAILED":
        return renderHostedFailure(session);
      default:
        return renderHostedStatus(session);
    }
  }

  // ---------------------------------------------------------------------------

  private assertPending(session: InternalSession): void {
    if (session.status !== "PENDING") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `La sesión ya está ${session.status}`,
      });
    }
  }

  private async deliverWebhook(session: InternalSession): Promise<void> {
    if (session.webhookUrl && session.webhookSecret) {
      await this.webhooks.dispatch(session.webhookUrl, session, session.webhookSecret);
      this.store.markWebhookDelivered(session.id);
    }
  }

  /**
   * Normaliza lo que manda la página hosted. `enforceBilling` aplica la regla
   * de la sesión (`billingRequired`): sin dirección válida no hay captura.
   * Nunca se persiste el PAN completo: si llega `number`, se reduce a last4.
   */
  private parseOutcome(body: OutcomeBody, session: InternalSession, enforceBilling: boolean): PaymentOutcome {
    const outcome: PaymentOutcome = {};

    if (typeof body.email === "string" && body.email.trim()) {
      outcome.email = body.email.trim().slice(0, 254);
    }

    if (body.card && typeof body.card === "object") {
      const digits = typeof body.card.number === "string" ? body.card.number.replace(/\D/g, "") : "";
      const last4 = typeof body.card.last4 === "string" ? body.card.last4.replace(/\D/g, "").slice(-4) : digits.slice(-4);
      const brand = typeof body.card.brand === "string" && CARD_BRANDS.has(body.card.brand) ? body.card.brand : "unknown";
      if (last4.length === 4) {
        const card: CardSummary = { brand: brand as CardSummary["brand"], last4 };
        if (typeof body.card.holder === "string" && body.card.holder.trim()) {
          card.holder = body.card.holder.trim().slice(0, 120);
        }
        outcome.card = card;
      }
    }

    const billing = this.parseBilling(body.billing, session);
    if (billing) outcome.billing = billing;
    if (enforceBilling && session.billingRequired && !billing) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "La dirección de facturación es obligatoria para este pago",
        fields: this.billingErrors(body.billing, session),
      });
    }
    return outcome;
  }

  private billingErrors(
    raw: Partial<BillingDetails> | undefined,
    session: InternalSession,
  ): Record<string, string> {
    const b = raw ?? {};
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const errors: Record<string, string> = {};
    if (str(b.name).length < 2) errors.name = "Escribe el nombre o razón social.";
    const rfc = str(b.rfc).toUpperCase();
    if (session.requiresInvoice && !rfc) errors.rfc = "El RFC es obligatorio para emitir la factura.";
    else if (rfc && !RFC_RE.test(rfc)) errors.rfc = "El RFC no tiene un formato válido.";
    if (!str(b.street)) errors.street = "Escribe la calle y número.";
    if (!str(b.city)) errors.city = "Escribe la ciudad.";
    if (!str(b.state)) errors.state = "Escribe el estado.";
    const cp = str(b.postalCode);
    const country = str(b.country).toUpperCase() || "MX";
    if (!cp) errors.postalCode = "Escribe el código postal.";
    else if (country === "MX" && !/^\d{5}$/.test(cp)) errors.postalCode = "El código postal debe tener 5 dígitos.";
    return errors;
  }

  private parseBilling(
    raw: Partial<BillingDetails> | undefined,
    session: InternalSession,
  ): BillingDetails | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    if (Object.keys(this.billingErrors(raw, session)).length > 0) {
      // Si la facturación es obligatoria, `parseOutcome` lo convierte en 400;
      // si es opcional, una dirección incompleta simplemente no se guarda.
      return undefined;
    }
    const str = (v: unknown, max = 160) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const rfc = str(raw.rfc, 13).toUpperCase();
    const neighborhood = str(raw.neighborhood);
    return {
      name: str(raw.name, 200),
      ...(rfc ? { rfc } : {}),
      street: str(raw.street, 200),
      ...(neighborhood ? { neighborhood } : {}),
      city: str(raw.city, 120),
      state: str(raw.state, 120),
      postalCode: str(raw.postalCode, 10),
      country: str(raw.country, 2).toUpperCase() || "MX",
    };
  }

  /** Solo se aceptan URLs http(s) absolutas para volver a la tienda. */
  private safeUrl(value: unknown): string | undefined {
    if (typeof value !== "string" || !value) return undefined;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  }

  private extractApiKey(auth: string | undefined): string {
    if (!auth || !auth.startsWith("Bearer ")) {
      throw new ForbiddenException({ code: "UNAUTHORIZED", message: "Service key requerida" });
    }
    const key = auth.slice("Bearer ".length).trim();
    if (!key) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Service key vacía" });
    }
    return key;
  }
}
