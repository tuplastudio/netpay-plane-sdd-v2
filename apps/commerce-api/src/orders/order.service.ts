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
import { randomBytes } from "node:crypto";

/**
 * Formato aceptado para `amountTotal` en el cable: decimal simple, sin signo,
 * sin separador de miles y sin notación científica. Se valida con regex y no
 * con `Number()` porque `Number()` acepta " 116 ", "1e3" y "0x10", y convierte
 * "1,234.50" en `NaN` — un importe malformado tiene que rebotar con un mensaje,
 * no colarse coercionado. La precisión final la sigue fijando la columna
 * Decimal(12,2) vía `toFixed(2)`: aquí no se redondea distinto.
 */
const AMOUNT_TOTAL_RE = /^\d{1,10}(?:\.\d{1,6})?$/;
/** Tope de la columna Decimal(12, 2). */
const AMOUNT_TOTAL_MAX = 9_999_999_999.99;

/**
 * Valida y convierte `amountTotal`. Lanza 400 VALIDATION_FAILED con mensaje en
 * español ante cualquier cosa que no sea un decimal positivo.
 */
export function parseAmountTotal(raw: unknown): number {
  const invalid = () =>
    new BadRequestException({
      code: "VALIDATION_FAILED",
      message:
        "amountTotal inválido: usa un decimal positivo con punto, sin separador de miles ni notación científica (ej. 1234.50)",
    });

  if (typeof raw !== "string" || !AMOUNT_TOTAL_RE.test(raw)) throw invalid();
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw invalid();
  // Un importe que redondea a 0.00 en la columna es tan inválido como un 0.
  if (Math.round(value * 100) < 1) throw invalid();
  if (value > AMOUNT_TOTAL_MAX) {
    throw new BadRequestException({
      code: "VALIDATION_FAILED",
      message: "amountTotal excede el máximo permitido (9999999999.99)",
    });
  }
  return value;
}

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
        revisions: { orderBy: { revisionNumber: "desc" }, include: { lines: true } },
        payments: { orderBy: { createdAt: "desc" }, include: { ledger: { orderBy: { recordedAt: "desc" } } } },
        quote: { select: { id: true, status: true, issuedAt: true, acceptedAt: true } },
      },
    });
    if (!o) throw new NotFoundException({ code: "NOT_FOUND", message: "Pedido no accesible" });

    // Las líneas viven en la revisión y solo guardan variantId+cantidad: sin
    // resolver la variante, el detalle de la venta no dice qué se vendió.
    const variantIds = [...new Set(o.revisions.flatMap((r) => r.lines.map((l) => l.variantId)))];
    const variants = variantIds.length
      ? await this.prisma.productVariant.findMany({
          where: { id: { in: variantIds }, tenantId },
          select: { id: true, sku: true, title: true, price: true, product: { select: { title: true } } },
        })
      : [];
    const byVariant = new Map(variants.map((v) => [v.id, v]));

    const revisions = o.revisions.map((r) => ({
      ...r,
      lines: r.lines.map((l) => {
        const variant = byVariant.get(l.variantId);
        const unitPrice = variant?.price ?? null;
        return {
          ...l,
          sku: variant?.sku ?? null,
          title: variant?.title ?? null,
          productTitle: variant?.product.title ?? null,
          unitPrice: unitPrice?.toString() ?? null,
          lineTotal:
            unitPrice != null ? (Number(unitPrice) * Number(l.quantity)).toFixed(2) : null,
        };
      }),
    }));

    const current = revisions.find((r) => r.id === o.currentRevisionId) ?? revisions[0] ?? null;
    return { ...o, revisions, lines: current?.lines ?? [] };
  }

  /**
   * Pide factura para un pedido: guarda un snapshot fiscal en el pedido
   * (independiente de si el cliente cambia sus datos después) y actualiza
   * el "último dato fiscal conocido" del cliente, para que la próxima vez
   * el bot pueda ofrecer reusarlo en vez de volver a preguntar todo.
   */
  async requestInvoice(
    tenantId: string,
    orderId: string,
    input: {
      rfc: string;
      legalName: string;
      postalCode: string;
      cfdiUse: string;
      constanciaUrl?: string;
      notes?: string;
    },
  ) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Pedido no accesible" });
    }

    const rfc = input.rfc.toUpperCase();
    const [updated] = await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          requiresInvoice: true,
          invoiceStatus: "DATA_COMPLETE",
          invoiceRfc: rfc,
          invoiceLegalName: input.legalName,
          invoicePostalCode: input.postalCode,
          invoiceCfdiUse: input.cfdiUse.toUpperCase(),
          invoiceConstanciaUrl: input.constanciaUrl,
          invoiceNotes: input.notes,
          invoiceRequestedAt: new Date(),
        },
      }),
      this.prisma.customer.update({
        where: { id: order.customerId },
        data: {
          taxId: rfc,
          legalName: input.legalName,
          fiscalPostalCode: input.postalCode,
          fiscalCfdiUse: input.cfdiUse.toUpperCase(),
        },
      }),
      this.prisma.auditLog.create({
        data: {
          tenantId,
          actorId: null,
          action: "order.invoice_requested",
          targetType: "Order",
          targetId: orderId,
          metadata: { rfc, cfdiUse: input.cfdiUse.toUpperCase() },
        },
      }),
    ]);
    return updated;
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
   * Busca el pedido creado por una `idempotencyKey`. El índice único de
   * `Order.idempotencyKey` es global (no compuesto con `tenantId`), así que una
   * clave de otro tenant no se puede reusar ni se puede devolver: se contesta
   * 409 en vez de dejar que el insert reviente con un error crudo de Postgres.
   */
  private async findByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    const existing = await this.prisma.order.findUnique({
      where: { idempotencyKey },
      include: { revisions: true },
    });
    if (!existing) return null;
    if (existing.tenantId !== tenantId) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "La clave de idempotencia ya fue usada por otro cobro",
      });
    }
    return existing;
  }

  /**
   * "Cliente mostrador" del tenant. El upsert compite consigo mismo cuando dos
   * cobros sin cliente entran a la vez y el placeholder aún no existe: ahí
   * Postgres levanta P2002 y basta con releer el que ganó.
   */
  private async walkInCustomerId(tenantId: string): Promise<string> {
    const email = `walkin+${tenantId}@quickcharge.local`;
    try {
      const placeholder = await this.prisma.customer.upsert({
        where: { tenantId_email: { tenantId, email } },
        create: { tenantId, fullName: "Cliente mostrador", email },
        update: {},
      });
      return placeholder.id;
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
      const winner = await this.prisma.customer.findUnique({
        where: { tenantId_email: { tenantId, email } },
      });
      if (!winner) throw err;
      return winner.id;
    }
  }

  /**
   * T-QTE-07: cobro rápido. `amountTotal` es el total incluido (no subtotal);
   * el impuesto se extrae hacia atrás con la tasa del tenant. Cliente
   * opcional (usa un placeholder "Cliente mostrador" por tenant).
   *
   * Idempotente por `idempotencyKey` (opcional pero recomendada): repetir la
   * misma clave devuelve el pedido original sin crear un segundo cobro. La
   * garantía la da el índice único de `Order.idempotencyKey`, no la lectura
   * previa: dos peticiones simultáneas con la misma clave pasan las dos por el
   * `findByIdempotencyKey` inicial en vacío, una gana el insert y la otra
   * recibe P2002 y relee al ganador. El insert y el `currentRevisionId` van en
   * una sola transacción para que el perdedor nunca lea un pedido a medias.
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
    const idempotencyKey = input.idempotencyKey?.trim() || undefined;
    if (idempotencyKey) {
      const replay = await this.findByIdempotencyKey(tenantId, idempotencyKey);
      if (replay) return replay;
    }

    // Antes de tocar la base: un importe malformado no debe llegar a crear el
    // cliente mostrador ni a coercionarse a NaN dentro del cálculo del IVA.
    const total = parseAmountTotal(input.amountTotal);

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant" });

    let customerId = input.customerId;
    if (customerId) {
      await this.customers.assertAccess(tenantId, customerId);
    } else {
      customerId = await this.walkInCustomerId(tenantId);
    }

    const taxRate = Number(tenant.taxRatePct);
    const base = Math.round((total / (1 + taxRate / 100)) * 100) / 100;
    const tax = Math.round((total - base) * 100) / 100;
    const expiresAt = new Date(Date.now() + tenant.checkoutReservationMinutes * 60 * 1000);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            tenantId,
            customerId,
            createdById: input.actorId ?? null,
            source: "QUICK_CHARGE",
            status: "CHECKOUT_OPEN",
            description: input.description,
            idempotencyKey,
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

        return tx.order.update({
          where: { id: created.id },
          data: { currentRevisionId: created.revisions[0]!.id },
          include: { revisions: true },
        });
      });
    } catch (err) {
      // Perdedor de la carrera: el índice único ya garantizó que solo se creó
      // un pedido; queda devolver el del ganador en vez de un 500 con el error
      // crudo de la restricción. Si no aparece, el P2002 era de otra cosa.
      if (idempotencyKey && (err as { code?: string }).code === "P2002") {
        const replay = await this.findByIdempotencyKey(tenantId, idempotencyKey);
        if (replay) return replay;
      }
      throw err;
    }
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
   * Autoservicio del cliente desde el link público de la cotización: acepta
   * (si hace falta), crea el pedido y abre el checkout con las líneas de la
   * cotización. Idempotente sobre un checkout ya abierto: sólo extiende la
   * ventana (mismo comportamiento que "reenviar link de pago" del portal).
   * Devuelve lo necesario para emitir el token de acceso al checkout.
   */
  async checkoutFromShareToken(shareToken: string): Promise<{
    tenantId: string;
    orderId: string;
    revisionId: string;
    expiresAt: Date;
  }> {
    const q = await this.quotes.resolveShareToken(shareToken);
    if (!q) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Link inválido o expirado" });
    }
    const tenantId = q.tenantId;
    if (q.status === "CANCELLED" || q.status === "EXPIRED") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "La cotización ya no está disponible",
      });
    }
    if (q.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({ code: "RULE_VIOLATION", message: "Cotización vencida" });
    }
    const existing = q.order;
    if (existing) {
      if (["PAID", "FULFILLED", "REFUNDED"].includes(existing.status)) {
        throw new BadRequestException({
          code: "RULE_VIOLATION",
          message: "Esta cotización ya está pagada",
        });
      }
      if (existing.status === "CANCELLED" || existing.status === "EXPIRED") {
        throw new BadRequestException({
          code: "RULE_VIOLATION",
          message: "El pedido de esta cotización se cerró. Pide a tu asesor un link nuevo.",
        });
      }
      if (existing.status === "CHECKOUT_OPEN" || existing.status === "AWAITING_PAYMENT") {
        const resumed = await this.resumeCheckout(tenantId, existing.id);
        return { tenantId, orderId: existing.id, ...resumed };
      }
    }

    const order = existing ?? (await this.createFromQuote(tenantId, q.id, null));
    const opened = await this.startCheckout(tenantId, order.id, {
      lines: q.lines.map((l) => ({
        variantId: l.variantId,
        quantity: l.quantity.toFixed(3),
        discountPct: Number(l.discountPct),
      })),
      deliveryMode: "PICKUP",
    });
    const revision = opened.revisions[opened.revisions.length - 1];
    if (!revision) {
      throw new BadRequestException({ code: "RULE_VIOLATION", message: "Pedido sin revisión" });
    }
    return {
      tenantId,
      orderId: order.id,
      revisionId: revision.id,
      expiresAt: opened.expiresAt ?? revision.expiresAt,
    };
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
    // Precio y producto padre: el checkout público muestra el detalle de lo
    // que se paga sin sesión, así que todo lo que necesita viaja aquí.
    const variants = variantIds.length
      ? await this.prisma.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: {
            id: true,
            sku: true,
            title: true,
            price: true,
            product: {
              select: {
                id: true,
                sku: true,
                title: true,
                description: true,
                variants: {
                  where: { status: "ACTIVE" },
                  select: { id: true, sku: true, title: true, price: true, stock: true },
                  orderBy: { price: "asc" },
                },
              },
            },
          },
        })
      : [];
    const lines = t.revision.lines.map((l: { variantId: string; quantity: { toString(): string } }) => {
      const v = variants.find((x) => x.id === l.variantId);
      const qty = Number(l.quantity.toString());
      const unitPrice = v ? Number(v.price) : null;
      return {
        variantId: l.variantId,
        sku: v?.sku ?? l.variantId.slice(0, 8),
        title: v?.title ?? "Producto",
        quantity: l.quantity.toString(),
        unitPrice: unitPrice != null ? unitPrice.toFixed(2) : null,
        lineTotal:
          unitPrice != null && Number.isFinite(qty) ? (unitPrice * qty).toFixed(2) : null,
        product: v
          ? {
              id: v.product.id,
              sku: v.product.sku,
              title: v.product.title,
              description: v.product.description,
              variants: v.product.variants.map((pv) => ({
                id: pv.id,
                sku: pv.sku,
                title: pv.title,
                price: pv.price.toFixed(2),
                stock: pv.stock == null ? null : pv.stock.toString(),
              })),
            }
          : null,
      };
    });

    return { order: t.revision.order, lines, revisionExpiresAt: t.revision.expiresAt };
  }

  /**
   * Token público y duradero de seguimiento (ver modelo OrderTrackingToken).
   * Mint-once: si el pedido ya tiene uno, se reusa el mismo link siempre —
   * generar uno nuevo cada vez invalidaría el que el cliente ya guardó.
   */
  async getOrCreateTrackingToken(tenantId: string, orderId: string): Promise<string> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Pedido no accesible" });
    }
    const existing = await this.prisma.orderTrackingToken.findUnique({ where: { orderId } });
    if (existing) return existing.token;
    const token = randomBytes(24).toString("base64url");
    const created = await this.prisma.orderTrackingToken.create({ data: { orderId, token } });
    return created.token;
  }

  /**
   * Resuelve el link público de seguimiento: estado + timeline (creado,
   * pagado, entregado/cancelado) + líneas. A diferencia de resolvePublicToken
   * (CheckoutAccessToken), este no vence ni se marca usado.
   */
  async resolveTrackingToken(token: string) {
    const t = await this.prisma.orderTrackingToken.findUnique({
      where: { token },
      include: {
        order: {
          include: {
            customer: { select: { fullName: true } },
            tenant: { select: { name: true, logoUrl: true } },
            revisionsRel: { include: { lines: true } },
          },
        },
      },
    });
    if (!t) return null;
    const order = t.order;
    const revisionLines = order.revisionsRel?.lines ?? [];
    const variantIds = revisionLines.map((l) => l.variantId);
    const variants = variantIds.length
      ? await this.prisma.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: { id: true, sku: true, title: true },
        })
      : [];
    const byId = new Map(variants.map((v) => [v.id, v]));
    const lines = revisionLines.map((l) => {
      const v = byId.get(l.variantId);
      return {
        variantId: l.variantId,
        sku: v?.sku ?? l.variantId.slice(0, 8),
        title: v?.title ?? "Producto",
        quantity: l.quantity.toString(),
      };
    });
    return {
      id: order.id,
      status: order.status,
      total: order.total.toString(),
      merchant: order.tenant.name,
      customer: { fullName: order.customer.fullName },
      lines,
      timeline: {
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        fulfilledAt: order.fulfilledAt,
        cancelledAt: order.cancelledAt,
      },
    };
  }

  /**
   * Marca un pedido pagado como entregado/completado. Único avance manual de
   * estado que existe hoy (el resto lo maneja el pago o la cancelación): el
   * enum no tiene etapas intermedias (preparando, enviado) — ver
   * docs/ARCHITECTURE si se necesita ese detalle más fino.
   */
  async fulfill(tenantId: string, orderId: string, actorId: string | null) {
    const o = await this.get(tenantId, orderId);
    if (o.status !== "PAID") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Pedido ${o.status} no se puede marcar como entregado (debe estar PAID)`,
      });
    }
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId,
        action: "order.fulfilled",
        targetType: "Order",
        targetId: orderId,
      },
    });
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: "FULFILLED", fulfilledAt: new Date(), version: { increment: 1 } },
    });
    const trackingLink = await this.notifyFulfilled(tenantId, updated);
    return { order: updated, trackingLink };
  }

  /**
   * Avisa al cliente que su pedido quedó entregado/completado, con su link
   * de seguimiento (se genera aquí si todavía no existe). Best-effort: si
   * falla, el pedido ya quedó marcado igual — se puede reenviar el link a
   * mano desde GET :id/tracking-link.
   */
  private async notifyFulfilled(
    tenantId: string,
    order: { id: string; customerId: string; total: { toString(): string } },
  ): Promise<string | null> {
    const base = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const token = await this.getOrCreateTrackingToken(tenantId, order.id);
    const link = `${base}/orders/public/track/${token}`;
    const customer = await this.prisma.customer.findUnique({ where: { id: order.customerId } });
    const target = customer && pickChannel(customer);
    if (target) {
      await this.notifications.scheduleFromTemplate({
        tenantId,
        recipientType: "CUSTOMER",
        recipientId: order.customerId,
        channel: target.channel,
        templateKey: "ORDER_FULFILLED",
        to: target.to,
        vars: { customerName: customer!.fullName, orderId: order.id.slice(0, 8), link },
      });
    }
    return link;
  }
}