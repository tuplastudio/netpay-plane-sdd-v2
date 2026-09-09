import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { CheckoutSession, PaymentStatus } from "@netpay/contracts";

/**
 * Almacén en memoria del gateway dummy. En V2 esto se reemplaza por tabla
 * SQL propia del gateway (no comparte BD con la app comercial).
 */
interface InternalSession extends CheckoutSession {
  serviceApiKey: string; // el caller validado
  webhooksDelivered: number;
  webhookUrl?: string;
  webhookSecret?: string;
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
  }): InternalSession {
    const id = randomBytes(16).toString("hex");
    const now = new Date();
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
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): InternalSession | undefined {
    return this.sessions.get(id);
  }

  setStatus(id: string, status: PaymentStatus): InternalSession | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    s.status = status;
    s.updatedAt = new Date().toISOString();
    s.version += 1;
    return s;
  }

  markWebhookDelivered(id: string): void {
    const s = this.sessions.get(id);
    if (s) s.webhooksDelivered += 1;
  }
}