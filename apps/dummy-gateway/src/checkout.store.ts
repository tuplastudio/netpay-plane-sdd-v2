import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { CheckoutSession, PaymentStatus } from "@netpay/contracts";

/**
 * Datos opcionales que la API comercial adjunta al crear la sesión para que
 * la página hosted se parezca a un checkout real (comercio, cliente, líneas,
 * totales) y sepa a dónde volver. Todos son opcionales: un caller que solo
 * mande amount/currency/orderId sigue funcionando igual que antes.
 */
export interface SessionLineItem {
  title: string;
  quantity: string;
  unitPrice: string | null;
}

export interface SessionTotals {
  subtotal?: string;
  discount?: string;
  tax?: string;
  shipping?: string;
  total?: string;
}

export interface SessionCustomer {
  fullName?: string;
  email?: string;
}

/** Dirección de facturación capturada en la página hosted. */
export interface BillingDetails {
  name: string;
  rfc?: string;
  street: string;
  neighborhood?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

/**
 * Métodos de pago que la página hosted sabe simular. Una pasarela real
 * expone más (CoDi, meses sin intereses, wallets); estos tres cubren los
 * flujos que el negocio necesita probar: cobro inmediato (tarjeta) y cobro
 * diferido con referencia (SPEI, efectivo en tienda).
 */
export const PAYMENT_METHODS = ["CARD", "SPEI", "OXXO"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/** Lo que se recuerda de la tarjeta de prueba: nunca el PAN completo. */
export interface CardSummary {
  brand: "visa" | "mastercard" | "amex" | "unknown";
  last4: string;
  holder?: string;
}

export interface SessionPresentation {
  merchantName?: string;
  customer?: SessionCustomer;
  requiresInvoice?: boolean;
  billingRequired?: boolean;
  lineItems?: SessionLineItem[];
  totals?: SessionTotals;
  successUrl?: string;
  cancelUrl?: string;
  /** Métodos que el comercio acepta para esta sesión. Vacío/ausente = todos. */
  paymentMethods?: PaymentMethod[];
}

/**
 * Almacén en memoria del gateway dummy. En V2 esto se reemplaza por tabla
 * SQL propia del gateway (no comparte BD con la app comercial).
 */
export interface InternalSession extends CheckoutSession, SessionPresentation {
  serviceApiKey: string; // el caller validado
  webhooksDelivered: number;
  webhookUrl?: string;
  webhookSecret?: string;
  metadata?: Record<string, string>;
  // Resultado del cobro (lo llena la página hosted al capturar/fallar).
  billing?: BillingDetails;
  card?: CardSummary;
  email?: string;
  /** Método con el que se cobró (o intentó cobrar). */
  paymentMethod?: PaymentMethod;
  /** Referencia SPEI/OXXO que se le mostró al cliente. Fija por sesión. */
  paymentReference: string;
  capturedAt?: string;
  failedAt?: string;
  failureReason?: string;
}

export interface PaymentOutcome {
  billing?: BillingDetails;
  card?: CardSummary;
  email?: string;
  reason?: string;
  paymentMethod?: PaymentMethod;
}

/**
 * Referencia numérica estable por sesión (18 dígitos: cabe en una CLABE de
 * prueba y en una referencia OXXO de 14). Derivada del id para que recargar
 * la página muestre siempre la misma.
 */
export function paymentReferenceFor(sessionId: string): string {
  let out = "";
  for (let i = 0; i < sessionId.length && out.length < 18; i += 1) {
    out += String(parseInt(sessionId[i]!, 16) % 10);
  }
  return out.padEnd(18, "0");
}

@Injectable()
export class CheckoutStore {
  private readonly sessions = new Map<string, InternalSession>();

  create(input: {
    amount: string;
    currency: "MXN";
    orderId: string;
    metadata?: Record<string, string>;
    serviceApiKey: string;
    webhookUrl?: string;
    webhookSecret?: string;
    expiresInMs?: number;
  } & SessionPresentation): InternalSession {
    const id = randomBytes(16).toString("hex");
    const now = new Date();
    const methods = (input.paymentMethods ?? []).filter(isPaymentMethod);
    const expires = new Date(now.getTime() + (input.expiresInMs ?? 15 * 60 * 1000));
    const session: InternalSession = {
      id,
      tenantId: "dummy",
      orderId: input.orderId,
      amount: input.amount,
      currency: input.currency,
      status: "PENDING",
      livemode: false,
      expiresAt: expires.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      version: 1,
      serviceApiKey: input.serviceApiKey,
      webhooksDelivered: 0,
      webhookUrl: input.webhookUrl,
      webhookSecret: input.webhookSecret,
      refundedTotal: "0.00",
      metadata: input.metadata,
      merchantName: input.merchantName,
      customer: input.customer,
      requiresInvoice: input.requiresInvoice ?? false,
      billingRequired: input.billingRequired ?? false,
      lineItems: input.lineItems,
      totals: input.totals,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      paymentMethods: methods.length ? methods : [...PAYMENT_METHODS],
      paymentReference: paymentReferenceFor(id),
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): InternalSession | undefined {
    return this.sessions.get(id);
  }

  setStatus(
    id: string,
    status: PaymentStatus,
    outcome?: PaymentOutcome,
  ): InternalSession | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    const now = new Date().toISOString();
    s.status = status;
    s.updatedAt = now;
    s.version += 1;
    if (outcome?.billing) s.billing = outcome.billing;
    if (outcome?.card) s.card = outcome.card;
    if (outcome?.email) s.email = outcome.email;
    if (outcome?.paymentMethod) s.paymentMethod = outcome.paymentMethod;
    if (status === "CAPTURED") {
      s.capturedAt = now;
    } else if (status === "FAILED") {
      s.failedAt = now;
      s.failureReason = outcome?.reason ?? "GENERIC_DECLINE";
    }
    return s;
  }

  markWebhookDelivered(id: string): void {
    const s = this.sessions.get(id);
    if (s) s.webhooksDelivered += 1;
  }
}
