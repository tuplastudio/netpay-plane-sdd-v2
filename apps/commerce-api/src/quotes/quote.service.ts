/**
 * Cotizaciones: DRAFT → ISSUED → ACCEPTED|EXPIRED|CANCELLED.
 * Ver docs/07-qte.md T-QTE-01..07.
 */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { PricingService } from "../pricing/pricing.service.js";
import { CustomerService } from "../customers/customer.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { pickChannel } from "../notifications/pick-channel.js";

@Injectable()
export class QuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly customers: CustomerService,
    private readonly notifications: NotificationService,
  ) {}

  async list(tenantId: string, status?: string) {
    return this.prisma.quote.findMany({
      where: { tenantId, ...(status ? { status: status as never } : {}) },
      include: { customer: true, lines: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
  }

  async get(tenantId: string, id: string) {
    const q = await this.prisma.quote.findFirst({
      where: { id, tenantId },
      include: {
        customer: true,
        lines: true,
        order: {
          include: {
            payments: { select: { id: true, status: true }, orderBy: { createdAt: "desc" } },
          },
        },
        tenant: true,
        _count: { select: { shares: true } },
      },
    });
    if (!q) throw new NotFoundException({ code: "NOT_FOUND", message: "Cotización no accesible" });
    return { ...q, editable: this.editability(q).ok };
  }

  /**
   * Una cotización se puede editar mientras no esté cerrada (CANCELLED/EXPIRED)
   * y mientras el pedido que generó (si ya lo generó) no se haya pagado. Un
   * checkout abierto sin pagar NO bloquea: al editar se regresa el pedido a
   * DRAFT y se libera la reserva (ver `update`).
   */
  private editability(q: {
    status: string;
    order: { status: string; payments: Array<{ status: string }> } | null;
  }): { ok: true } | { ok: false; reason: string } {
    if (q.status === "CANCELLED" || q.status === "EXPIRED") {
      return { ok: false, reason: `No se puede editar en estado ${q.status}` };
    }
    const order = q.order;
    if (order) {
      if (["PAID", "FULFILLED", "REFUNDED"].includes(order.status)) {
        return { ok: false, reason: "El pedido de esta cotización ya se pagó" };
      }
      if (order.payments.some((p) => p.status === "CAPTURED" || p.status === "AUTHORIZED")) {
        return { ok: false, reason: "Ya hay un cobro capturado para esta cotización" };
      }
    }
    return { ok: true };
  }

  /**
   * Edita líneas y/o notas de una cotización no pagada. Recalcula totales con
   * el pricing vigente y sube `version`. Si la cotización ya había llegado al
   * cliente (ACCEPTED, o ISSUED y compartida) se le reenvía el link con la
   * nueva versión; si además ya tenía pedido, ese pedido vuelve a DRAFT con
   * los totales nuevos y se libera cualquier reserva de stock del checkout
   * anterior, para que el cobro se emita otra vez con las líneas correctas.
   */
  async update(
    tenantId: string,
    id: string,
    actorId: string | null,
    input: {
      lines?: Array<{ variantId: string; quantity: string; discountPct?: number }>;
      notes?: string | null;
    },
  ) {
    const q = await this.get(tenantId, id);
    const can = this.editability(q);
    if (!can.ok) {
      throw new BadRequestException({ code: "RULE_VIOLATION", message: can.reason });
    }
    if (input.lines && input.lines.length === 0) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Al menos una línea" });
    }
    if (input.lines === undefined && input.notes === undefined) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Nada que actualizar" });
    }

    const priced = input.lines ? await this.pricing.price(tenantId, input.lines) : null;
    const previousTotal = q.total.toFixed(2);
    const order = q.order;
    const orderNeedsReset =
      !!order && !!priced && ["DRAFT", "CHECKOUT_OPEN", "AWAITING_PAYMENT"].includes(order.status);

    // Reserva del checkout anterior: se libera fuera de la transacción, igual
    // que hace OrderService.cancel, porque PricingService no recibe `tx`.
    if (orderNeedsReset && order.currentRevisionId) {
      const reserved = await this.prisma.orderRevisionLine.findMany({
        where: { revisionId: order.currentRevisionId },
        select: { variantId: true, quantity: true },
      });
      if (reserved.length > 0) {
        await this.pricing.releaseStock(
          tenantId,
          reserved.map((l) => ({ variantId: l.variantId, quantity: l.quantity.toString() })),
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (priced) {
        await tx.quoteLine.deleteMany({ where: { quoteId: q.id } });
      }
      const quote = await tx.quote.update({
        where: { id: q.id },
        data: {
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(priced
            ? {
                subtotal: priced.totals.subtotal,
                discount: priced.totals.discount,
                taxBase: priced.totals.taxBase,
                tax: priced.totals.tax,
                shipping: priced.totals.shipping,
                total: priced.totals.total,
                lines: {
                  create: priced.lines.map((l) => ({
                    variantId: l.variantId,
                    sku: l.sku,
                    title: l.title,
                    quantity: l.quantity,
                    unitPrice: l.unitPrice,
                    discountPct: l.discountPct,
                    lineSubtotal: l.lineSubtotal,
                    satProductCode: l.satProductCode,
                    satUnitCode: l.satUnitCode,
                  })),
                },
              }
            : {}),
          version: { increment: 1 },
        },
        include: { lines: true, customer: true },
      });

      if (orderNeedsReset && order && priced) {
        if (order.currentRevisionId) {
          await tx.orderRevision.update({
            where: { id: order.currentRevisionId },
            data: { status: "CANCELLED" },
          });
        }
        await tx.checkoutSession.updateMany({
          where: { orderId: order.id, status: "PENDING" },
          data: { status: "CANCELLED" },
        });
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "DRAFT",
            currentRevisionId: null,
            expiresAt: null,
            subtotal: priced.totals.subtotal,
            discount: priced.totals.discount,
            taxBase: priced.totals.taxBase,
            tax: priced.totals.tax,
            shipping: priced.totals.shipping,
            total: priced.totals.total,
            version: { increment: 1 },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId,
          action: "quote.updated",
          targetType: "Quote",
          targetId: q.id,
          metadata: {
            previousTotal,
            total: quote.total.toFixed(2),
            linesChanged: !!priced,
            notesChanged: input.notes !== undefined,
            orderReset: orderNeedsReset ? order!.id : null,
          },
        },
      });

      return quote;
    });

    // El cliente ya la vio: se le avisa con un link nuevo (los anteriores
    // siguen resolviendo la cotización en vivo, así que también verán la
    // versión nueva si los abren).
    const customerSawIt = q.status === "ACCEPTED" || (q.status === "ISSUED" && q._count.shares > 0);
    let notified = false;
    if (customerSawIt && priced) {
      const target = pickChannel(q.customer);
      if (target) {
        const shareToken = await this.prisma.quoteShareToken.create({
          data: { quoteId: q.id, tenantId, token: this.randomToken(), expiresAt: q.expiresAt },
        });
        const link = `${process.env.PUBLIC_BASE_URL ?? "http://localhost:3000"}/quotes/public/${shareToken.token}`;
        await this.notifications.scheduleFromTemplate({
          tenantId,
          recipientType: "CUSTOMER",
          recipientId: q.customerId,
          channel: target.channel,
          templateKey: "QUOTE_UPDATED",
          to: target.to,
          vars: {
            customerName: q.customer.fullName,
            previousTotal,
            total: updated.total.toFixed(2),
            link,
          },
        });
        notified = true;
      }
    }

    return { ...updated, customerNotified: notified, orderReset: orderNeedsReset };
  }

  /**
   * Crea DRAFT desde un set de líneas. Versión 1.
   * Si `issue:true`, transiciona a ISSUED y congela totales.
   */
  async create(
    tenantId: string,
    actorId: string | null,
    input: {
      customerId: string;
      lines: Array<{ variantId: string; quantity: string; discountPct?: number }>;
      notes?: string;
      issue?: boolean;
    },
  ) {
    if (input.lines.length === 0) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Al menos una línea",
      });
    }
    await this.customers.assertAccess(tenantId, input.customerId);

    const priced = await this.pricing.price(tenantId, input.lines);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant" });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + tenant.quoteValidityHours * 60 * 60 * 1000);

    return this.prisma.quote.create({
      data: {
        tenantId,
        customerId: input.customerId,
        status: input.issue ? "ISSUED" : "DRAFT",
        configVersion: tenant.configVersion,
        subtotal: priced.totals.subtotal,
        discount: priced.totals.discount,
        taxBase: priced.totals.taxBase,
        tax: priced.totals.tax,
        shipping: priced.totals.shipping,
        total: priced.totals.total,
        notes: input.notes,
        issuedAt: input.issue ? now : null,
        expiresAt,
        createdById: actorId,
        lines: {
          create: priced.lines.map((l) => ({
            variantId: l.variantId,
            sku: l.sku,
            title: l.title,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            lineSubtotal: l.lineSubtotal,
            satProductCode: l.satProductCode,
            satUnitCode: l.satUnitCode,
          })),
        },
      },
      include: { lines: true, customer: true },
    });
  }

  /** Issue: congela y pasa a ISSUED. */
  async issue(tenantId: string, id: string) {
    const q = await this.get(tenantId, id);
    if (q.status !== "DRAFT") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `No se puede emitir en estado ${q.status}`,
      });
    }
    return this.prisma.quote.update({
      where: { id: q.id },
      data: { status: "ISSUED", issuedAt: new Date(), version: { increment: 1 } },
      include: { lines: true },
    });
  }

  /** Cancel: cierra la cotización. */
  async cancel(tenantId: string, id: string, actorId: string | null) {
    const q = await this.get(tenantId, id);
    if (["ACCEPTED", "CANCELLED", "EXPIRED"].includes(q.status)) {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `No se puede cancelar en estado ${q.status}`,
      });
    }
    const result = await this.prisma.quote.update({
      where: { id: q.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), version: { increment: 1 } },
    });
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId,
        action: "quote.cancelled",
        targetType: "Quote",
        targetId: q.id,
      },
    });
    return result;
  }

  /** Aceptar cotización: pasa a ACCEPTED. La conversión a Order se hace en OrdersService. */
  async markAccepted(tenantId: string, id: string) {
    const q = await this.get(tenantId, id);
    if (q.status !== "ISSUED") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Solo ISSUED se acepta (actual: ${q.status})`,
      });
    }
    if (q.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "Cotización vencida",
      });
    }
    return this.prisma.quote.update({
      where: { id: q.id },
      data: { status: "ACCEPTED", acceptedAt: new Date(), version: { increment: 1 } },
    });
  }

  /** Marca como vencida (job scheduled). */
  async markExpired(tenantId: string, id: string) {
    return this.prisma.quote.updateMany({
      where: { id, tenantId, status: "ISSUED" },
      data: { status: "EXPIRED", version: { increment: 1 } },
    });
  }

  /** Genera token opaco de compartición pública. */
  async createShareToken(tenantId: string, id: string) {
    const q = await this.get(tenantId, id);
    if (q.status === "CANCELLED" || q.status === "EXPIRED") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `No se puede compartir en estado ${q.status}`,
      });
    }
    const shareToken = await this.prisma.quoteShareToken.create({
      data: {
        quoteId: q.id,
        tenantId,
        token: this.randomToken(),
        expiresAt: q.expiresAt,
      },
    });

    const target = pickChannel(q.customer);
    if (target) {
      const link = `${process.env.PUBLIC_BASE_URL ?? "http://localhost:3000"}/quotes/public/${shareToken.token}`;
      await this.notifications.scheduleFromTemplate({
        tenantId,
        recipientType: "CUSTOMER",
        recipientId: q.customerId,
        channel: target.channel,
        templateKey: "QUOTE_LINK",
        to: target.to,
        vars: { customerName: q.customer.fullName, total: q.total.toString(), link },
      });
    }

    return shareToken;
  }

  async resolveShareToken(token: string) {
    const t = await this.prisma.quoteShareToken.findUnique({
      where: { token },
      include: {
        quote: {
          include: {
            lines: true,
            customer: true,
            tenant: true,
            order: { select: { id: true, status: true, currentRevisionId: true, expiresAt: true } },
          },
        },
      },
    });
    if (!t) return null;
    if (t.expiresAt.getTime() <= Date.now()) return null;
    return t.quote;
  }

  /**
   * Token de checkout vigente del pedido de una cotización, si su checkout
   * sigue abierto. Los tokens no se "gastan" (no hay `usedAt` en el flujo de
   * pago), así que el link público puede reusar el último emitido en vez de
   * acumular uno nuevo por cada vez que el cliente abre la cotización.
   */
  async activeCheckoutToken(order: {
    status: string;
    currentRevisionId: string | null;
    expiresAt: Date | null;
  } | null): Promise<string | null> {
    if (!order || !order.currentRevisionId) return null;
    if (order.status !== "CHECKOUT_OPEN" && order.status !== "AWAITING_PAYMENT") return null;
    if (order.expiresAt && order.expiresAt.getTime() <= Date.now()) return null;
    const t = await this.prisma.checkoutAccessToken.findFirst({
      where: { revisionId: order.currentRevisionId, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: "desc" },
      select: { token: true },
    });
    return t?.token ?? null;
  }

  private randomToken(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
}