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
      include: { customer: true, lines: true, order: true, tenant: true },
    });
    if (!q) throw new NotFoundException({ code: "NOT_FOUND", message: "Cotización no accesible" });
    return q;
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
      include: { quote: { include: { lines: true, customer: true, tenant: true } } },
    });
    if (!t) return null;
    if (t.expiresAt.getTime() <= Date.now()) return null;
    return t.quote;
  }

  private randomToken(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
}