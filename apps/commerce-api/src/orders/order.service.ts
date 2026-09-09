/**
 * Pedidos: create (direct o desde cotización), checkout, cancel, incidents.
 * Ver docs/08-ord.md T-ORD-01..06.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { PricingService } from "../pricing/pricing.service.js";
import { CustomerService } from "../customers/customer.service.js";
import { QuoteService } from "../quotes/quote.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { pickChannel } from "../notifications/pick-channel.js";

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly customers: CustomerService,
    private readonly quotes: QuoteService,
    private readonly notifications: NotificationService,
  ) {}

  private async notifyOrderReceived(order: {
    id: string;
    tenantId: string;
    customerId: string;
    total: { toString(): string };
  }): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { id: order.customerId } });
    const target = customer && pickChannel(customer);
    if (!target) return;
    await this.notifications.scheduleFromTemplate({
      tenantId: order.tenantId,
      recipientType: "CUSTOMER",
      recipientId: order.customerId,
      channel: target.channel,
      templateKey: "ORDER_RECEIVED",
      to: target.to,
      vars: { customerName: customer!.fullName, total: order.total.toString(), orderId: order.id.slice(0, 8) },
    });
  }

  async list(tenantId: string, status?: string) {
    return this.prisma.order.findMany({
      where: { tenantId, ...(status ? { status: status as never } : {}) },
      include: { customer: true, revisions: true, payments: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
  }

  async get(tenantId: string, id: string) {
    const o = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: {
        customer: true,
        revisions: { orderBy: { revisionNumber: "desc" } },
        payments: true,
      },
    });
    if (!o) throw new NotFoundException({ code: "NOT_FOUND", message: "Pedido no accesible" });
    return o;
  }

  async createDirect(
    tenantId: string,
    actorId: string | null,
    input: {
      customerId: string;
      lines: Array<{ variantId: string; quantity: string; discountPct?: number }>;
      notes?: string;
    },
  ) {
    await this.customers.assertAccess(tenantId, input.customerId);
    const priced = await this.pricing.price(tenantId, input.lines);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant" });

    const order = await this.prisma.order.create({
      data: {
        tenantId,
        customerId: input.customerId,
        createdById: actorId,
        source: "DIRECT",
        status: "DRAFT",
        configVersion: tenant.configVersion,
        subtotal: priced.totals.subtotal,
        discount: priced.totals.discount,
        taxBase: priced.totals.taxBase,
        tax: priced.totals.tax,
        shipping: priced.totals.shipping,
        total: priced.totals.total,
        revisions: {
          create: {
            revisionNumber: 1,
            status: "OPEN",
            total: priced.totals.total,
            deliveryMode: "PICKUP",
            expiresAt: new Date(Date.now() + tenant.checkoutReservationMinutes * 60 * 1000),
          },
        },
      },
      include: { revisions: true },
    });
    await this.notifyOrderReceived(order);
    return order;
  }

  /**
   * T-QTE-07: cobro rápido. `amountTotal` es el total incluido (no subtotal);
   * el impuesto se extrae hacia atrás con la tasa del tenant. Cliente
   * opcional (usa un placeholder "Cliente mostrador" por tenant).
   */
  async quickCharge(
    tenantId: string,
    input: {
      customerId?: string;
      description: string;
      amountTotal: string;
      idempotencyKey?: string;
      actorId?: string | null;
    },
  ) {
    if (input.idempotencyKey) {
      const existing = await this.prisma.order.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { revisions: true },
      });
      if (existing && existing.tenantId === tenantId) return existing;
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant" });

    let customerId = input.customerId;
    if (customerId) {
      await this.customers.assertAccess(tenantId, customerId);
    } else {
      const placeholder = await this.prisma.customer.upsert({
        where: { tenantId_email: { tenantId, email: `walkin+${tenantId}@quickcharge.local` } },
        create: {
          tenantId,
          fullName: "Cliente mostrador",
          email: `walkin+${tenantId}@quickcharge.local`,
        },
        update: {},
      });
      customerId = placeholder.id;
    }

    const total = Number(input.amountTotal);
    if (!Number.isFinite(total) || total <= 0) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "amountTotal inválido" });
    }
    const taxRate = Number(tenant.taxRatePct);
    const base = Math.round((total / (1 + taxRate / 100)) * 100) / 100;
    const tax = Math.round((total - base) * 100) / 100;
    const expiresAt = new Date(Date.now() + tenant.checkoutReservationMinutes * 60 * 1000);

    const order = await this.prisma.order.create({
      data: {
        tenantId,
        customerId,
        createdById: input.actorId ?? null,
        source: "QUICK_CHARGE",
        status: "CHECKOUT_OPEN",
        description: input.description,
        idempotencyKey: input.idempotencyKey,
        configVersion: tenant.configVersion,
        subtotal: base.toFixed(2),
        discount: "0.00",
        taxBase: base.toFixed(2),
        tax: tax.toFixed(2),
        shipping: "0.00",
        total: total.toFixed(2),
        checkoutRevision: 1,
        expiresAt,
        revisions: {
          create: {
            revisionNumber: 1,
            status: "OPEN",
            total: total.toFixed(2),
            deliveryMode: "PICKUP",
            expiresAt,
          },
        },
      },
      include: { revisions: true },
    });

    return this.prisma.order.update({
      where: { id: order.id },
      data: { currentRevisionId: order.revisions[0]!.id },
      include: { revisions: true },
    });
  }

  async createFromQuote(tenantId: string, quoteId: string, actorId: string | null = null) {
    // Idempotente (AC-AIA-04): repetir la aceptación devuelve el mismo pedido.
    const existing = await this.prisma.order.findFirst({
      where: { tenantId, quoteId },
      include: { revisions: true },
    });
    if (existing) return existing;

    const q = await this.quotes.get(tenantId, quoteId);
    if (q.status !== "ISSUED" && q.status !== "ACCEPTED") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Quote en estado ${q.status} no se puede convertir`,
      });
    }
    if (q.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "Cotización vencida",
      });
    }
    await this.quotes.markAccepted(tenantId, q.id);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant" });

    const order = await this.prisma.order.create({
      data: {
        tenantId,
        customerId: q.customerId,
        createdById: actorId,
        quoteId: q.id,
        source: "QUOTE",
        status: "DRAFT",
        configVersion: q.configVersion,
        subtotal: q.subtotal,
        discount: q.discount,
        taxBase: q.taxBase,
        tax: q.tax,
        shipping: q.shipping,
        total: q.total,
        revisions: {
          create: {
            revisionNumber: 1,
            status: "OPEN",
            total: q.total,
            deliveryMode: "PICKUP",
            expiresAt: new Date(Date.now() + tenant.checkoutReservationMinutes * 60 * 1000),
          },
        },
      },
    });
    await this.notifyOrderReceived(order);
    return order;
  }

  /**
   * Inicia checkout: reserva stock, crea OrderRevision si hay cambios,
   * transiciona a CHECKOUT_OPEN.
   */
  async startCheckout(
    tenantId: string,
    orderId: string,
    input: {
      lines: Array<{ variantId: string; quantity: string }>;
      deliveryMode: "PICKUP" | "LOCAL_DELIVERY";
      addressId?: string;
    },
  ) {
    const o = await this.get(tenantId, orderId);
    if (o.status !== "DRAFT" && o.status !== "CHECKOUT_OPEN") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Pedido ${o.status} no puede iniciar checkout`,
      });
    }
    // Reintentar checkout (p. ej. cambiar líneas) no debe apilar reservas:
    // se libera lo reservado por la revisión vigente antes de reservar de nuevo.
    if (o.currentRevisionId) {
      await this.releaseRevisionStock(tenantId, o.currentRevisionId);
    }
    const priced = await this.pricing.price(tenantId, input.lines);
    const reserveResult = await this.pricing.reserveStock(tenantId, input.lines);
    if ("conflict" in reserveResult) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "Stock insuficiente",
        metadata: reserveResult.conflict,
      });
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant" });

    return this.prisma.$transaction(async (tx) => {
      // Calcular el siguiente revisionNumber basado en las revisiones existentes
      const existing = await tx.orderRevision.findMany({
        where: { orderId: o.id },
        orderBy: { revisionNumber: "desc" },
        take: 1,
        select: { revisionNumber: true },
      });
      const nextNumber = (existing[0]?.revisionNumber ?? 0) + 1;
      const newRev = await tx.orderRevision.create({
        data: {
          orderId: o.id,
          revisionNumber: nextNumber,
          status: "OPEN",
          total: priced.totals.total,
          deliveryMode: input.deliveryMode,
          addressId: input.addressId,
          expiresAt: new Date(
            Date.now() + tenant.checkoutReservationMinutes * 60 * 1000,
          ),
          lines: {
            create: input.lines.map((l) => ({
              variantId: l.variantId,
              quantity: l.quantity,
            })),
          },
        },
      });
      const updated = await tx.order.update({
        where: { id: o.id },
        data: {
          status: "CHECKOUT_OPEN",
          checkoutRevision: nextNumber,
          currentRevisionId: newRev.id,
          subtotal: priced.totals.subtotal,
          discount: priced.totals.discount,
          taxBase: priced.totals.taxBase,
          tax: priced.totals.tax,
          shipping: priced.totals.shipping,
          total: priced.totals.total,
          expiresAt: newRev.expiresAt,
          version: { increment: 1 },
        },
        include: { revisions: true },
      });
      return updated;
    });
  }

  /**
   * Extiende la ventana de un checkout ya abierto (CHECKOUT_OPEN/AWAITING_PAYMENT)
   * para reemitir un link de pago. No repite reserveStock: la reserva ya existe.
   */
  async resumeCheckout(tenantId: string, orderId: string) {
    const o = await this.get(tenantId, orderId);
    if (o.status !== "CHECKOUT_OPEN" && o.status !== "AWAITING_PAYMENT") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Pedido ${o.status} no tiene checkout activo`,
      });
    }
    if (!o.currentRevisionId) {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "Pedido sin revisión de checkout vigente",
      });
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant" });

    const expiresAt = new Date(Date.now() + tenant.checkoutReservationMinutes * 60 * 1000);
    await this.prisma.order.update({
      where: { id: o.id },
      data: { expiresAt, version: { increment: 1 } },
    });
    return { revisionId: o.currentRevisionId, expiresAt };
  }

  /** Marca como pagado (llamado por el payment provider tras CAPTURED). */
  async markPaid(tenantId: string, orderId: string) {
    return this.prisma.order.updateMany({
      where: { id: orderId, tenantId, status: { in: ["CHECKOUT_OPEN", "AWAITING_PAYMENT"] } },
      data: { status: "PAID", paidAt: new Date(), version: { increment: 1 } },
    });
  }

  async cancel(
    tenantId: string,
    orderId: string,
    actorId: string | null,
    reason?: string,
    opts?: { requireOwnership?: boolean },
  ) {
    const o = await this.get(tenantId, orderId);
    if (opts?.requireOwnership && o.createdById !== actorId) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Solo puedes cancelar pedidos que tú creaste",
      });
    }
    if (o.status === "PAID" || o.status === "FULFILLED" || o.status === "REFUNDED") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Pedido ${o.status} no puede cancelarse desde aquí`,
      });
    }
    if (o.status === "CANCELLED" || o.status === "EXPIRED") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Pedido ya en estado ${o.status}`,
      });
    }
    if (o.currentRevisionId) {
      await this.releaseRevisionStock(tenantId, o.currentRevisionId);
    }
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId,
        action: "order.cancelled",
        targetType: "Order",
        targetId: orderId,
        metadata: { reason },
      },
    });
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        version: { increment: 1 },
      },
    });
  }

  async expireCheckout(tenantId: string, orderId: string) {
    const o = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        tenantId,
        status: { in: ["CHECKOUT_OPEN", "AWAITING_PAYMENT"] },
        expiresAt: { lt: new Date() },
      },
    });
    if (!o) return { count: 0 };
    if (o.currentRevisionId) {
      await this.releaseRevisionStock(tenantId, o.currentRevisionId);
    }
    return this.prisma.order.updateMany({
      where: { id: o.id, tenantId, version: o.version },
      data: { status: "EXPIRED", version: { increment: 1 } },
    });
  }

  /** Revierte a stock las líneas reservadas por una revisión de checkout. */
  private async releaseRevisionStock(tenantId: string, revisionId: string): Promise<void> {
    const lines = await this.prisma.orderRevisionLine.findMany({
      where: { revisionId },
      select: { variantId: true, quantity: true },
    });
    if (lines.length === 0) return;
    await this.pricing.releaseStock(
      tenantId,
      lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity.toString() })),
    );
  }

  async resolvePublicToken(token: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = this.prisma as any;
    const t = await prisma.checkoutAccessToken.findUnique({
      where: { token },
      include: {
        revision: {
          include: {
            order: { include: { customer: true, tenant: true } },
            lines: true,
          },
        },
      },
    });
    if (!t) return null;
    if (t.expiresAt.getTime() <= Date.now()) return null;
    if (t.usedAt) return null;

    const variantIds = t.revision.lines.map((l: { variantId: string }) => l.variantId);
    const variants = variantIds.length
      ? await this.prisma.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: { id: true, sku: true, title: true },
        })
      : [];
    const lines = t.revision.lines.map((l: { variantId: string; quantity: { toString(): string } }) => {
      const v = variants.find((x) => x.id === l.variantId);
      return {
        variantId: l.variantId,
        sku: v?.sku ?? l.variantId.slice(0, 8),
        title: v?.title ?? "Producto",
        quantity: l.quantity.toString(),
      };
    });

    return { order: t.revision.order, lines, revisionExpiresAt: t.revision.expiresAt };
  }
}