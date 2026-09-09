/**
 * PaymentProvider abstraction. Único proveedor en V2: DUMMY.
 * Ver docs/09-pay.md T-PAY-01..07.
 *
 * Esta capa orquesta:
 *   1. Llamada HTTP al gateway dummy con API key de servicio.
 *   2. Recepción de webhooks firmados.
 *   3. Ledger de movimientos (CHARGE/REFUND/FEE/ADJUSTMENT).
 *   4. Transiciones de CheckoutSession.
 *
 * Restricciones V2 (ADR-005): PAYMENT_PROVIDER=DUMMY único. Cualquier
 * cambio en start.ts bloquea el arranque.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { pickChannel } from "../notifications/pick-channel.js";

export interface CreateCheckoutInput {
  tenantId: string;
  orderId: string;
  expectedOrderVersion: number;
  amount: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSessionResult {
  sessionId: string;
  checkoutUrl: string;
  expiresAt: Date;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  private async notifyPaymentResult(
    orderId: string,
    tenantId: string,
    templateKey: "PAYMENT_SIMULATED_SUCCESS" | "PAYMENT_SIMULATED_FAILED",
    total: string,
  ): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true },
    });
    const target = order && pickChannel(order.customer);
    if (!order || !target) return;
    await this.notifications.scheduleFromTemplate({
      tenantId,
      recipientType: "CUSTOMER",
      recipientId: order.customerId,
      channel: target.channel,
      templateKey,
      to: target.to,
      vars: { customerName: order.customer.fullName, total },
    });
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSessionResult> {
    // Verifica que el pedido esté en estado correcto.
    const order = await this.prisma.order.findFirst({
      where: { id: input.orderId, tenantId: input.tenantId },
    });
    if (!order) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Pedido no accesible" });
    }
    if (input.expectedOrderVersion !== 0 && order.version !== input.expectedOrderVersion) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "Versión del pedido desactualizada",
      });
    }

    // `baseUrl` es la dirección servidor-a-servidor (p. ej. dentro de Docker,
    // "http://dummy-gateway:4100"). `publicBaseUrl` es lo que el navegador
    // del cliente puede resolver (p. ej. "http://localhost:4100") — casi
    // siempre son el mismo host fuera de contenedores, pero no dentro.
    const baseUrl = process.env.DUMMY_BASE_URL ?? "http://localhost:4100";
    const publicBaseUrl = process.env.DUMMY_PUBLIC_URL ?? baseUrl;
    const apiKey = process.env.DUMMY_SERVICE_KEY ?? "npk_test_local";
    const webhookSecret = process.env.DUMMY_WEBHOOK_SECRET ?? "dev-webhook-secret";
    // Dirección propia alcanzable por el dummy-gateway para el callback del
    // webhook — NUNCA la URL pública del navegador (dentro de Docker
    // "http://commerce-api:4000" ≠ "http://localhost:3001").
    const selfUrl = process.env.API_SELF_URL ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:4000";

    // Llama al dummy para crear la sesión.
    const res = await fetch(`${baseUrl}/checkout/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        amount: input.amount,
        currency: "MXN",
        orderId: input.orderId,
        metadata: input.metadata,
        webhookUrl: `${selfUrl}/api/v1/payments/webhook`,
        secret: webhookSecret,
      }),
    });
    if (!res.ok) {
      this.logger.error(`Dummy createCheckout failed: ${res.status}`);
      throw new BadRequestException({
        code: "DEPENDENCY_UNAVAILABLE",
        message: "Pasarela no disponible",
      });
    }
    const body = (await res.json()) as { data: { id: string; hostedUrl: string; expiresAt: string } };
    const expiresAt = new Date(body.data.expiresAt);

    // Persistir CheckoutSession con referencia al dummy.
    const session = await this.prisma.checkoutSession.create({
      data: {
        tenantId: input.tenantId,
        orderId: input.orderId,
        amount: input.amount,
        status: "PENDING",
        expiresAt,
        capturedAt: null,
      },
    });

    await this.prisma.order.update({
      where: { id: input.orderId },
      data: { status: "AWAITING_PAYMENT" },
    });

    return {
      sessionId: session.id,
      checkoutUrl: `${publicBaseUrl}${body.data.hostedUrl}`,
      expiresAt,
    };
  }

  /** Recibe y verifica webhook firmado por el dummy. */
  async handleWebhook(rawBody: string, signature: string | undefined): Promise<void> {
    const secret = process.env.DUMMY_WEBHOOK_SECRET ?? "dev-webhook-secret";
    if (!signature) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Firma requerida" });
    }
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (expected.length !== signature.length) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Firma inválida" });
    }
    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Firma inválida" });
    }
    const event = JSON.parse(rawBody) as {
      sessionId?: string;
      orderId?: string;
      amount?: string;
      status?: string;
      eventName?: string;
    };
    if (!event.sessionId || !event.orderId) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Payload incompleto" });
    }
    await this.applyStatus(event.sessionId, event.orderId, event.status ?? "PENDING", event.amount);
  }

  private async applyStatus(
    dummySessionId: string,
    orderId: string,
    rawStatus: string,
    amount?: string,
  ) {
    this.logger.log(
      `applyStatus called dummy=${dummySessionId} order=${orderId} status=${rawStatus}`,
    );
    // dummySessionId es el id del gateway (32 hex). En nuestra BD
    // guardamos por orderId + amount (más fácil porque el cliente
    // no recibe el id externo; lo gestiona internamente).
    const order = await this.prisma.order.findFirst({ where: { id: orderId } });
    if (!order) {
      this.logger.warn(`Webhook para order ${orderId} no encontrada`);
      return;
    }

    const session = await this.prisma.checkoutSession.findFirst({
      where: { orderId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    if (!session) {
      this.logger.warn(`Webhook sin sesión pendiente para order ${orderId}`);
      return;
    }
    this.logger.log(`applyStatus found session=${session.id}`);

    const upper = rawStatus.toUpperCase();
    if (upper === "CAPTURED" || upper === "AUTHORIZED") {
      await this.prisma.$transaction(async (tx) => {
        await tx.checkoutSession.update({
          where: { id: session.id },
          data: { status: "CAPTURED", capturedAt: new Date(), version: { increment: 1 } },
        });
        await tx.ledgerEntry.create({
          data: {
            tenantId: session.tenantId,
            sessionId: session.id,
            entryType: "CHARGE",
            amount: amount ?? session.amount.toString(),
            balanceAfter: amount ?? session.amount.toString(),
            description: `Pago simulado: dummy session ${dummySessionId}`,
          },
        });
        await tx.order.update({
          where: { id: orderId },
          data: { status: "PAID", paidAt: new Date(), version: { increment: 1 } },
        });
      });
      this.logger.log(`Order ${orderId} PAID via dummy ${dummySessionId}`);
      await this.notifyPaymentResult(
        orderId,
        session.tenantId,
        "PAYMENT_SIMULATED_SUCCESS",
        amount ?? session.amount.toString(),
      );
    } else if (upper === "FAILED") {
      await this.prisma.checkoutSession.update({
        where: { id: session.id },
        data: { status: "FAILED", failedAt: new Date(), version: { increment: 1 } },
      });
      await this.notifyPaymentResult(
        orderId,
        session.tenantId,
        "PAYMENT_SIMULATED_FAILED",
        amount ?? session.amount.toString(),
      );
    } else if (upper === "REFUNDED") {
      await this.prisma.checkoutSession.update({
        where: { id: session.id },
        data: { status: "REFUNDED", version: { increment: 1 } },
      });
      await this.prisma.ledgerEntry.create({
        data: {
          tenantId: session.tenantId,
          sessionId: session.id,
          entryType: "REFUND",
          amount: amount ?? session.amount.toString(),
          balanceAfter: "0.00",
          description: `Reembolso simulado`,
        },
      });
    }
  }

  async refund(tenantId: string, sessionId: string, amount: string, reason: string) {
    const session = await this.prisma.checkoutSession.findFirst({
      where: { id: sessionId, tenantId },
    });
    if (!session) throw new NotFoundException({ code: "NOT_FOUND", message: "Sesión no accesible" });
    if (session.status !== "CAPTURED") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Sesión en estado ${session.status} no permite reembolso`,
      });
    }
    await this.prisma.checkoutSession.update({
      where: { id: session.id },
      data: { status: "REFUNDED", version: { increment: 1 } },
    });
    await this.prisma.ledgerEntry.create({
      data: {
        tenantId,
        sessionId,
        entryType: "REFUND",
        amount,
        balanceAfter: "0.00",
        description: reason,
      },
    });
    await this.prisma.order.updateMany({
      where: { id: session.orderId, tenantId, status: "PAID" },
      data: { status: "REFUNDED", version: { increment: 1 } },
    });
    return { ok: true };
  }

  async listSessions(tenantId: string) {
    const sessions = await this.prisma.checkoutSession.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const orderIds = [...new Set(sessions.map((s) => s.orderId))];
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: { customer: true },
    });
    const byId = new Map(orders.map((o) => [o.id, o]));
    return sessions.map((s) => ({
      ...s,
      customerName: byId.get(s.orderId)?.customer.fullName ?? null,
    }));
  }

  async getLedger(tenantId: string, sessionId?: string) {
    return this.prisma.ledgerEntry.findMany({
      where: { tenantId, ...(sessionId ? { sessionId } : {}) },
      orderBy: { recordedAt: "desc" },
      take: 100,
    });
  }
}