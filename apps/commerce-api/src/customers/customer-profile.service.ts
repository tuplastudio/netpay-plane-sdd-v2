/**
 * Perfil 360° del cliente (T-CRM-06): resumen de por vida, línea de tiempo
 * unificada, notas internas, direcciones y datos fiscales.
 *
 * Separado de `CustomerService` (CRUD + identidad de canal) para que la
 * ficha pueda crecer sin engordar el servicio que usa el agente en cada
 * cotización. Todo va por Prisma (nada de SQL crudo) para que las pruebas
 * puedan usar el mismo fake en memoria que `customer-resolve-channel.test.ts`.
 */

import { createHash } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Paging } from "../common/pagination.js";
import { extractPdfText } from "../common/pdf-text.js";
import { parseConstancia } from "../orders/constancia-parser.js";
import { publicUrlForKey, writeObject } from "../tenants/logo-storage.js";

/** Pedidos que cuentan como "compra" (dinero que sí entró). */
export const PAID_ORDER_STATUSES: Prisma.OrderWhereInput["status"] = {
  in: ["PAID", "FULFILLED"],
};
/** Pedidos con cobro abierto: esperan que el cliente pague. */
export const PENDING_ORDER_STATUSES: Prisma.OrderWhereInput["status"] = {
  in: ["CHECKOUT_OPEN", "AWAITING_PAYMENT"],
};
/** Cotizaciones vivas: todavía pueden convertirse en pedido. */
const OPEN_QUOTE_STATUSES: Prisma.QuoteWhereInput["status"] = { in: ["DRAFT", "ISSUED"] };

const MAX_CONSTANCIA_BYTES = 8 * 1024 * 1024; // mismo tope que order.service.ts

export const TIMELINE_KINDS = ["all", "quote", "order", "payment", "conversation", "note"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/** Tope de filas que se leen de CADA fuente para armar la línea de tiempo. */
const TIMELINE_SOURCE_CAP = 500;

export interface CustomerSummary {
  ordersCount: number;
  paidOrdersCount: number;
  /** Decimal serializado como string (mismo criterio que los importes del API). */
  totalPaid: string;
  averageTicket: string;
  lastPurchaseAt: string | null;
  firstPurchaseAt: string | null;
  quotesCount: number;
  openQuotesCount: number;
  pendingPaymentsCount: number;
  pendingPaymentsAmount: string;
  refundedOrdersCount: number;
  conversationsCount: number;
  openConversationsCount: number;
  /** Hilo con actividad más reciente, para el botón "Abrir conversación". */
  lastConversationId: string | null;
  firstContactAt: string;
  lastContactAt: string | null;
  notesCount: number;
  addressesCount: number;
  identitiesCount: number;
}

export interface TimelineItem {
  kind: Exclude<TimelineKind, "all">;
  id: string;
  /** Fecha que ordena la línea de tiempo (ISO). */
  at: string;
  /** Enum crudo del dominio (`StatusBadge` lo etiqueta en el front). */
  status: string | null;
  /** Importe cuando aplica (cotización, pedido, pago). String decimal. */
  amount: string | null;
  currency: string | null;
  /** Campos propios de cada tipo (origen del pedido, método de pago, autor…). */
  meta: Record<string, unknown>;
}

function decimalToString(value: Prisma.Decimal | number | null | undefined): string {
  if (value === null || value === undefined) return "0.00";
  return new Prisma.Decimal(value).toFixed(2);
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function maxDate(...values: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const v of values) {
    if (v && (!best || v.getTime() > best.getTime())) best = v;
  }
  return best;
}

function minDate(...values: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const v of values) {
    if (v && (!best || v.getTime() < best.getTime())) best = v;
  }
  return best;
}

/**
 * Normaliza etiquetas: minúsculas, sin espacios sobrantes, sin duplicados ni
 * vacíos. Mismo criterio que `WhatsAppConversation.tags` para que "VIP" y
 * "vip" sean la misma etiqueta al filtrar.
 */
export function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) return undefined;
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (t && !seen.has(t)) seen.add(t);
  }
  return [...seen].slice(0, 20);
}

/** Escapa una celda CSV (RFC 4180): comillas dobles y separadores. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

@Injectable()
export class CustomerProfileService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireCustomer(tenantId: string, id: string) {
    const c = await this.prisma.customer.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException({ code: "NOT_FOUND", message: "Cliente no accesible" });
    return c;
  }

  // -------------------------------------------------------------------------
  // Resumen de por vida
  // -------------------------------------------------------------------------

  async summary(tenantId: string, id: string): Promise<CustomerSummary> {
    const customer = await this.requireCustomer(tenantId, id);
    const scope = { tenantId, customerId: id };

    const [
      ordersCount,
      paidAgg,
      pendingAgg,
      refundedOrdersCount,
      quotesCount,
      openQuotesCount,
      lastQuote,
      conversationsCount,
      openConversationsCount,
      convAgg,
      lastConversation,
      notesCount,
      addressesCount,
      identitiesCount,
    ] = await Promise.all([
      this.prisma.order.count({ where: scope }),
      this.prisma.order.aggregate({
        where: { ...scope, status: PAID_ORDER_STATUSES },
        _sum: { total: true },
        _count: { _all: true },
        _max: { paidAt: true, createdAt: true },
        _min: { paidAt: true, createdAt: true },
      }),
      this.prisma.order.aggregate({
        where: { ...scope, status: PENDING_ORDER_STATUSES },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.order.count({ where: { ...scope, status: "REFUNDED" } }),
      this.prisma.quote.count({ where: scope }),
      this.prisma.quote.count({ where: { ...scope, status: OPEN_QUOTE_STATUSES } }),
      this.prisma.quote.findFirst({
        where: scope,
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      this.prisma.whatsAppConversation.count({ where: scope }),
      this.prisma.whatsAppConversation.count({
        where: { ...scope, status: { not: "CLOSED" } },
      }),
      this.prisma.whatsAppConversation.aggregate({
        where: scope,
        _min: { createdAt: true },
        _max: { lastMessageAt: true },
      }),
      this.prisma.whatsAppConversation.findFirst({
        where: scope,
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        select: { id: true },
      }),
      this.prisma.customerNote.count({ where: scope }),
      this.prisma.customerAddress.count({ where: { customerId: id } }),
      this.prisma.customerIdentity.count({ where: { customerId: id } }),
    ]);

    const paidOrdersCount = paidAgg._count._all;
    const totalPaid = new Prisma.Decimal(paidAgg._sum.total ?? 0);
    const averageTicket =
      paidOrdersCount > 0 ? totalPaid.div(paidOrdersCount) : new Prisma.Decimal(0);

    const firstContactAt = minDate(customer.createdAt, convAgg._min.createdAt) ?? customer.createdAt;
    const lastContactAt = maxDate(
      convAgg._max.lastMessageAt,
      paidAgg._max.createdAt,
      lastQuote?.createdAt,
    );

    return {
      ordersCount,
      paidOrdersCount,
      totalPaid: decimalToString(totalPaid),
      averageTicket: decimalToString(averageTicket),
      lastPurchaseAt: iso(paidAgg._max.paidAt ?? paidAgg._max.createdAt),
      firstPurchaseAt: iso(paidAgg._min.paidAt ?? paidAgg._min.createdAt),
      quotesCount,
      openQuotesCount,
      pendingPaymentsCount: pendingAgg._count._all,
      pendingPaymentsAmount: decimalToString(pendingAgg._sum.total),
      refundedOrdersCount,
      conversationsCount,
      openConversationsCount,
      lastConversationId: lastConversation?.id ?? null,
      firstContactAt: firstContactAt.toISOString(),
      lastContactAt: iso(lastContactAt),
      notesCount,
      addressesCount,
      identitiesCount,
    };
  }

  // -------------------------------------------------------------------------
  // Línea de tiempo unificada
  // -------------------------------------------------------------------------

  /**
   * Une cotizaciones, pedidos, pagos, conversaciones y notas en una sola
   * lista ordenada por fecha (más reciente primero) y paginada por offset.
   *
   * No hay `UNION` en Prisma, así que se leen `offset + limit` filas de cada
   * fuente (con tope), se funden en memoria y se corta la página. Para una
   * ficha de cliente (decenas, no millones de movimientos) es suficiente y
   * evita SQL a mano que se saltaría el tipado y la RLS de pruebas.
   */
  async timeline(
    tenantId: string,
    id: string,
    kind: TimelineKind,
    paging: Paging,
  ): Promise<{ items: TimelineItem[]; total: number }> {
    await this.requireCustomer(tenantId, id);
    const scope = { tenantId, customerId: id };
    const take = Math.min(paging.offset + paging.limit, TIMELINE_SOURCE_CAP);
    const wants = (k: Exclude<TimelineKind, "all">) => kind === "all" || kind === k;

    const sources: Array<Promise<{ items: TimelineItem[]; total: number }>> = [];

    if (wants("quote")) {
      sources.push(
        Promise.all([
          this.prisma.quote.findMany({
            where: scope,
            orderBy: { createdAt: "desc" },
            take,
            select: {
              id: true,
              status: true,
              total: true,
              createdAt: true,
              issuedAt: true,
              expiresAt: true,
              acceptedAt: true,
              order: { select: { id: true } },
            },
          }),
          this.prisma.quote.count({ where: scope }),
        ]).then(([rows, total]) => ({
          total,
          items: rows.map<TimelineItem>((q) => ({
            kind: "quote",
            id: q.id,
            at: q.createdAt.toISOString(),
            status: q.status,
            amount: decimalToString(q.total),
            currency: "MXN",
            meta: {
              issuedAt: iso(q.issuedAt),
              expiresAt: iso(q.expiresAt),
              acceptedAt: iso(q.acceptedAt),
              orderId: q.order?.id ?? null,
            },
          })),
        })),
      );
    }

    if (wants("order")) {
      sources.push(
        Promise.all([
          this.prisma.order.findMany({
            where: scope,
            orderBy: { createdAt: "desc" },
            take,
            select: {
              id: true,
              status: true,
              total: true,
              source: true,
              createdAt: true,
              paidAt: true,
              fulfilledAt: true,
              description: true,
              requiresInvoice: true,
              invoiceStatus: true,
              quoteId: true,
            },
          }),
          this.prisma.order.count({ where: scope }),
        ]).then(([rows, total]) => ({
          total,
          items: rows.map<TimelineItem>((o) => ({
            kind: "order",
            id: o.id,
            at: o.createdAt.toISOString(),
            status: o.status,
            amount: decimalToString(o.total),
            currency: "MXN",
            meta: {
              source: o.source,
              paidAt: iso(o.paidAt),
              fulfilledAt: iso(o.fulfilledAt),
              description: o.description,
              requiresInvoice: o.requiresInvoice,
              invoiceStatus: o.invoiceStatus,
              quoteId: o.quoteId,
            },
          })),
        })),
      );
    }

    if (wants("payment")) {
      const where: Prisma.CheckoutSessionWhereInput = { tenantId, order: { customerId: id } };
      sources.push(
        Promise.all([
          this.prisma.checkoutSession.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take,
            select: {
              id: true,
              status: true,
              amount: true,
              refundedTotal: true,
              currency: true,
              paymentMethod: true,
              createdAt: true,
              capturedAt: true,
              orderId: true,
            },
          }),
          this.prisma.checkoutSession.count({ where }),
        ]).then(([rows, total]) => ({
          total,
          items: rows.map<TimelineItem>((p) => ({
            kind: "payment",
            id: p.id,
            at: p.createdAt.toISOString(),
            status: p.status,
            amount: decimalToString(p.amount),
            currency: p.currency,
            meta: {
              refundedTotal: decimalToString(p.refundedTotal),
              paymentMethod: p.paymentMethod,
              capturedAt: iso(p.capturedAt),
              orderId: p.orderId,
            },
          })),
        })),
      );
    }

    if (wants("conversation")) {
      sources.push(
        Promise.all([
          this.prisma.whatsAppConversation.findMany({
            where: scope,
            orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
            take,
            select: {
              id: true,
              status: true,
              handoffToHuman: true,
              externalPhone: true,
              tags: true,
              lastMessageAt: true,
              createdAt: true,
              closedAt: true,
              connection: { select: { provider: true } },
            },
          }),
          this.prisma.whatsAppConversation.count({ where: scope }),
        ]).then(([rows, total]) => ({
          total,
          items: rows.map<TimelineItem>((c) => ({
            kind: "conversation",
            id: c.id,
            at: (c.lastMessageAt ?? c.createdAt).toISOString(),
            status: c.status,
            amount: null,
            currency: null,
            meta: {
              handoffToHuman: c.handoffToHuman,
              externalPhone: c.externalPhone,
              tags: c.tags,
              provider: c.connection.provider,
              startedAt: c.createdAt.toISOString(),
              closedAt: iso(c.closedAt),
            },
          })),
        })),
      );
    }

    if (wants("note")) {
      sources.push(
        Promise.all([
          this.prisma.customerNote.findMany({
            where: scope,
            orderBy: { createdAt: "desc" },
            take,
            include: { author: { select: { id: true, fullName: true, email: true } } },
          }),
          this.prisma.customerNote.count({ where: scope }),
        ]).then(([rows, total]) => ({
          total,
          items: rows.map<TimelineItem>((n) => ({
            kind: "note",
            id: n.id,
            at: n.createdAt.toISOString(),
            status: null,
            amount: null,
            currency: null,
            meta: { body: n.body, author: n.author },
          })),
        })),
      );
    }

    const parts = await Promise.all(sources);
    const merged = parts
      .flatMap((p) => p.items)
      .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
    return {
      items: merged.slice(paging.offset, paging.offset + paging.limit),
      total: parts.reduce((acc, p) => acc + p.total, 0),
    };
  }

  // -------------------------------------------------------------------------
  // Notas internas
  // -------------------------------------------------------------------------

  async listNotes(tenantId: string, customerId: string, paging: Paging) {
    await this.requireCustomer(tenantId, customerId);
    const where = { tenantId, customerId };
    const [items, total] = await Promise.all([
      this.prisma.customerNote.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: paging.limit,
        skip: paging.offset,
        include: { author: { select: { id: true, fullName: true, email: true } } },
      }),
      this.prisma.customerNote.count({ where }),
    ]);
    return { items, total };
  }

  async addNote(tenantId: string, customerId: string, authorId: string | undefined, body: string) {
    const text = body?.trim();
    if (!text) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "La nota no puede ir vacía" });
    }
    await this.requireCustomer(tenantId, customerId);
    return this.prisma.customerNote.create({
      data: { tenantId, customerId, authorId: authorId ?? null, body: text },
      include: { author: { select: { id: true, fullName: true, email: true } } },
    });
  }

  async deleteNote(tenantId: string, customerId: string, noteId: string) {
    const note = await this.prisma.customerNote.findFirst({
      where: { id: noteId, tenantId, customerId },
      select: { id: true },
    });
    if (!note) throw new NotFoundException({ code: "NOT_FOUND", message: "Nota no accesible" });
    await this.prisma.customerNote.delete({ where: { id: noteId } });
    return { id: noteId };
  }

  // -------------------------------------------------------------------------
  // Direcciones (alta está en CustomerService.addAddress)
  // -------------------------------------------------------------------------

  private async requireAddress(tenantId: string, customerId: string, addressId: string) {
    await this.requireCustomer(tenantId, customerId);
    const a = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });
    if (!a) throw new NotFoundException({ code: "NOT_FOUND", message: "Dirección no accesible" });
    return a;
  }

  async updateAddress(
    tenantId: string,
    customerId: string,
    addressId: string,
    patch: {
      label?: string;
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
      isDefault?: boolean;
    },
  ) {
    await this.requireAddress(tenantId, customerId, addressId);
    if (patch.isDefault) {
      await this.prisma.customerAddress.updateMany({
        where: { customerId, id: { not: addressId } },
        data: { isDefault: false },
      });
    }
    return this.prisma.customerAddress.update({
      where: { id: addressId },
      data: {
        label: patch.label,
        line1: patch.line1,
        line2: patch.line2,
        city: patch.city,
        state: patch.state,
        postalCode: patch.postalCode,
        country: patch.country,
        isDefault: patch.isDefault,
      },
    });
  }

  async deleteAddress(tenantId: string, customerId: string, addressId: string) {
    await this.requireAddress(tenantId, customerId, addressId);
    await this.prisma.customerAddress.delete({ where: { id: addressId } });
    return { id: addressId };
  }

  // -------------------------------------------------------------------------
  // Datos fiscales: constancia de situación fiscal
  // -------------------------------------------------------------------------

  /**
   * Lee la constancia (PDF) con el mismo parser que usa el checkout público
   * (`orders/constancia-parser.ts`), la guarda bajo `customers/…` y completa
   * RFC, razón social, CP y régimen en la ficha. Lo que venga en `overrides`
   * manda sobre lo leído; lo que no se pudo leer conserva el valor anterior.
   * `cfdiUse` nunca sale del PDF (lo elige quien factura), por eso es override.
   */
  async uploadConstancia(
    tenantId: string,
    customerId: string,
    file: { buffer: Buffer; mimetype?: string },
    overrides: {
      rfc?: string;
      legalName?: string;
      postalCode?: string;
      regimenFiscal?: string;
      cfdiUse?: string;
    },
  ) {
    if (file.mimetype && file.mimetype !== "application/pdf") {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "La constancia debe ser un PDF",
      });
    }
    if (file.buffer.length > MAX_CONSTANCIA_BYTES) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "El PDF pesa más de 8 MB" });
    }
    await this.requireCustomer(tenantId, customerId);

    const text = await extractPdfText(file.buffer);
    const parsed = text ? parseConstancia(text) : null;
    const warnings = parsed?.warnings ?? ["No se pudo leer el texto del PDF (¿es una foto/escaneo?)"];

    const hash = createHash("sha256").update(file.buffer).digest("hex").slice(0, 16);
    const key = `customers/${tenantId}/${customerId}/constancia-${hash}.pdf`;
    await writeObject(key, file.buffer);
    const fiscalConstanciaUrl = publicUrlForKey(key);

    const rfc = overrides.rfc ?? parsed?.rfc ?? undefined;
    const legalName = overrides.legalName ?? parsed?.legalName ?? undefined;
    const postalCode = overrides.postalCode ?? parsed?.postalCode ?? undefined;
    const regimenFiscal = overrides.regimenFiscal ?? parsed?.regimenFiscal ?? undefined;

    const customer = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        taxId: rfc?.toUpperCase(),
        legalName,
        fiscalPostalCode: postalCode,
        fiscalRegimenFiscal: regimenFiscal,
        fiscalCfdiUse: overrides.cfdiUse?.toUpperCase(),
        fiscalConstanciaUrl,
        version: { increment: 1 },
      },
      include: { addresses: true, identities: true, consents: true },
    });

    return {
      customer,
      parsed: {
        rfc: parsed?.rfc ?? null,
        legalName: parsed?.legalName ?? null,
        postalCode: parsed?.postalCode ?? null,
        regimenFiscal: parsed?.regimenFiscal ?? null,
      },
      warnings,
    };
  }

  // -------------------------------------------------------------------------
  // Etiquetas del tenant (para el filtro del listado)
  // -------------------------------------------------------------------------

  async tags(tenantId: string): Promise<Array<{ tag: string; count: number }>> {
    const rows = await this.prisma.customer.findMany({
      where: { tenantId, tags: { isEmpty: false } },
      select: { tags: true },
    });
    const counts = new Map<string, number>();
    for (const r of rows) {
      for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }
}
