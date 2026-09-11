/**
 * Contexto CRM de una conversación: todo lo que un agente necesita para
 * contestar sin salir de la bandeja (ficha del cliente, sus compras, sus
 * pagos, las notas internas del hilo y una línea de tiempo unificada).
 *
 * **Por qué un solo endpoint.** El panel de contexto necesitaba seis lecturas
 * distintas (cliente, pedidos, cotizaciones, sesiones de pago, agregados de
 * gasto y bitácora). Hacerlas desde el navegador serían seis viajes por hilo
 * abierto y una línea de tiempo cosida en el cliente, que además tendría que
 * conocer el vocabulario de `AuditLog`. Se arman aquí, en un `Promise.all` de
 * consultas **acotadas y en número constante**: nunca hay una consulta por
 * fila, ni siquiera cuando el cliente tiene cientos de pedidos.
 *
 * **Alcance.** Todo se filtra por `tenantId` además de por cliente: las
 * sesiones de pago se alcanzan por `order.customerId`, así que la condición de
 * tenant va explícita en `CheckoutSession` y no solo heredada del pedido.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";

/** Cuántos registros recientes de cada colección viajan al panel. */
const RECENT_TAKE = 8;
/** Notas del hilo que se asoman en el panel (el resto vive en la pestaña Notas). */
const NOTES_TAKE = 5;
/** Entradas de bitácora del hilo que alimentan la línea de tiempo. */
const AUDIT_TAKE = 25;
/** Tope de la línea de tiempo ya fusionada. */
const TIMELINE_TAKE = 30;

/** Estados de pedido que cuentan como "abierto": el hilo suele tratar de esto. */
const OPEN_ORDER_STATUSES = ["DRAFT", "CHECKOUT_OPEN", "AWAITING_PAYMENT"];
/** Estados de cotización que siguen vivas. */
const OPEN_QUOTE_STATUSES = ["DRAFT", "ISSUED"];

type Decimalish = Prisma.Decimal;

/** Fila de pedido tal como la necesita el panel (y la línea de tiempo). */
export interface ContextOrderRow {
  id: string;
  status: string;
  source: string;
  total: Decimalish;
  createdAt: Date;
  placedAt: Date | null;
  paidAt: Date | null;
}

export interface ContextQuoteRow {
  id: string;
  status: string;
  total: Decimalish;
  createdAt: Date;
  issuedAt: Date | null;
  acceptedAt: Date | null;
  expiresAt: Date;
}

export interface ContextPaymentRow {
  id: string;
  orderId: string;
  status: string;
  amount: Decimalish;
  refundedTotal: Decimalish;
  currency: string;
  createdAt: Date;
  capturedAt: Date | null;
  failedAt: Date | null;
}

export interface ContextNoteRow {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; fullName: string; email: string } | null;
}

export interface ContextAuditRow {
  id: string;
  action: string;
  metadata: unknown;
  createdAt: Date;
  actor: { fullName: string } | null;
}

export type TimelineKind = "conversation" | "note" | "quote" | "order" | "payment" | "system";

/**
 * Un renglón de la línea de tiempo. `href` es una ruta del portal (no una URL
 * absoluta): quien la pinta decide si es un `<Link>` o texto plano.
 */
export interface TimelineEvent {
  /** Estable y único dentro de la línea (`quote:<uuid>`), sirve de `key`. */
  id: string;
  kind: TimelineKind;
  at: string;
  title: string;
  detail: string | null;
  /** Estado del recurso, para pintar un `StatusBadge` sin adivinar. */
  status: string | null;
  /** Dominio del estado (`order` | `quote` | `payment`), o null si no aplica. */
  statusDomain: "order" | "quote" | "payment" | null;
  /** Importe en la misma forma decimal-string que el resto del API. */
  amount: string | null;
  /** Quién lo hizo, cuando se sabe. */
  actor: string | null;
  href: string | null;
}

export interface ConversationContext {
  conversation: {
    id: string;
    externalPhone: string;
    status: string;
    tags: string[];
    createdAt: string;
    lastMessageAt: string | null;
  };
  customer: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    taxId: string | null;
    legalName: string | null;
    status: string;
    createdAt: string;
  } | null;
  /** Agregados de todo el historial del cliente, no solo de lo que viaja aquí. */
  metrics: {
    /** Suma de los pedidos con `paidAt`, en decimal-string. */
    totalSpend: string;
    paidOrders: number;
    orderCount: number;
    quoteCount: number;
    /** Alta de la ficha, o el inicio de este hilo si no hay ficha. */
    firstContactAt: string;
  };
  orders: Array<{
    id: string;
    status: string;
    source: string;
    total: string;
    createdAt: string;
    paidAt: string | null;
  }>;
  quotes: Array<{
    id: string;
    status: string;
    total: string;
    createdAt: string;
    issuedAt: string | null;
    expiresAt: string;
  }>;
  payments: Array<{
    id: string;
    orderId: string;
    status: string;
    amount: string;
    refundedTotal: string;
    currency: string;
    createdAt: string;
    capturedAt: string | null;
  }>;
  /** El pedido/cotización viva más reciente: de eso suele tratar el hilo. */
  openOrderId: string | null;
  openQuoteId: string | null;
  notes: Array<{
    id: string;
    body: string;
    createdAt: string;
    author: { id: string; fullName: string; email: string } | null;
  }>;
  timeline: TimelineEvent[];
}

/** `AuditLog.action` → cómo se lee en la línea de tiempo. */
const AUDIT_TITLES: Record<string, string> = {
  "whatsapp.conversation.closed": "Conversación cerrada",
  "whatsapp.conversation.reopened": "Conversación reabierta",
  "whatsapp.conversation.auto_closed": "Cerrada por inactividad",
  "whatsapp.conversation.handoff": "Transferida a una persona",
  "whatsapp.conversation.claimed": "Tomada por una persona",
  "whatsapp.conversation.returned": "Devuelta al agente",
  "whatsapp.conversation.tags_changed": "Etiquetas actualizadas",
  "whatsapp.conversation.customer_linked": "Cliente vinculado al hilo",
};

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function dec(value: Decimalish | null | undefined): string {
  return value ? value.toString() : "0.00";
}

/** Primeras `max` letras de una nota, en una sola línea. */
function excerpt(body: string, max = 160): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Detalle legible de una entrada de bitácora, a partir de su metadata. */
function auditDetail(action: string, metadata: unknown): string | null {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  if (action === "whatsapp.conversation.tags_changed" && Array.isArray(meta.tags)) {
    const tags = (meta.tags as unknown[]).filter((t): t is string => typeof t === "string");
    return tags.length ? tags.join(", ") : "Sin etiquetas";
  }
  if (typeof meta.userName === "string") return meta.userName;
  if (typeof meta.reason === "string") return meta.reason;
  return null;
}

@Injectable()
export class ConversationContextService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string, conversationId: string): Promise<ConversationContext> {
    const conversation = await this.prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, tenantId },
      select: {
        id: true,
        customerId: true,
        externalPhone: true,
        status: true,
        tags: true,
        createdAt: true,
        lastMessageAt: true,
      },
    });
    if (!conversation) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Conversación no accesible" });
    }

    const customerId = conversation.customerId;
    // Sin ficha vinculada no hay historial que traer: el hilo se queda con sus
    // notas y su bitácora, y las nueve consultas se vuelven dos.
    const scope = customerId ? { tenantId, customerId } : null;

    const customerP: Promise<ConversationContext["customer"]> = scope
      ? this.prisma.customer
          .findFirst({
            where: { id: scope.customerId, tenantId },
            select: {
              id: true,
              fullName: true,
              email: true,
              phone: true,
              taxId: true,
              legalName: true,
              status: true,
              createdAt: true,
            },
          })
          .then((c) => (c ? { ...c, createdAt: c.createdAt.toISOString() } : null))
      : Promise.resolve(null);

    const ordersP: Promise<ContextOrderRow[]> = scope
      ? this.prisma.order.findMany({
          where: scope,
          orderBy: { createdAt: "desc" },
          take: RECENT_TAKE,
          select: {
            id: true,
            status: true,
            source: true,
            total: true,
            createdAt: true,
            placedAt: true,
            paidAt: true,
          },
        })
      : Promise.resolve([]);

    const quotesP: Promise<ContextQuoteRow[]> = scope
      ? this.prisma.quote.findMany({
          where: scope,
          orderBy: { createdAt: "desc" },
          take: RECENT_TAKE,
          select: {
            id: true,
            status: true,
            total: true,
            createdAt: true,
            issuedAt: true,
            acceptedAt: true,
            expiresAt: true,
          },
        })
      : Promise.resolve([]);

    // `tenantId` explícito además del pedido: el alcance no se hereda de la
    // relación, se afirma.
    const paymentsP: Promise<ContextPaymentRow[]> = scope
      ? this.prisma.checkoutSession.findMany({
          where: { tenantId, order: { customerId: scope.customerId } },
          orderBy: { createdAt: "desc" },
          take: RECENT_TAKE,
          select: {
            id: true,
            orderId: true,
            status: true,
            amount: true,
            refundedTotal: true,
            currency: true,
            createdAt: true,
            capturedAt: true,
            failedAt: true,
          },
        })
      : Promise.resolve([]);

    const spendP = scope
      ? this.prisma.order.aggregate({
          where: { ...scope, paidAt: { not: null } },
          _sum: { total: true },
          _count: { _all: true },
        })
      : Promise.resolve(null);

    const notesP: Promise<ContextNoteRow[]> = this.prisma.conversationNote.findMany({
      where: { tenantId, conversationId },
      include: { author: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: NOTES_TAKE,
    });

    const auditsP: Promise<ContextAuditRow[]> = this.prisma.auditLog.findMany({
      where: { tenantId, targetType: "WhatsAppConversation", targetId: conversationId },
      include: { actor: { select: { fullName: true } } },
      orderBy: { createdAt: "desc" },
      take: AUDIT_TAKE,
    });

    const orderCountP: Promise<number> = scope
      ? this.prisma.order.count({ where: scope })
      : Promise.resolve(0);
    const quoteCountP: Promise<number> = scope
      ? this.prisma.quote.count({ where: scope })
      : Promise.resolve(0);

    const [customer, orders, quotes, payments, notes, audits, spend, orderCount, quoteCount] =
      await Promise.all([
        customerP,
        ordersP,
        quotesP,
        paymentsP,
        notesP,
        auditsP,
        spendP,
        orderCountP,
        quoteCountP,
      ]);

    const openOrder = orders.find((o) => OPEN_ORDER_STATUSES.includes(o.status));
    const openQuote = quotes.find((q) => OPEN_QUOTE_STATUSES.includes(q.status));

    return {
      conversation: {
        id: conversation.id,
        externalPhone: conversation.externalPhone,
        status: conversation.status,
        tags: conversation.tags,
        createdAt: conversation.createdAt.toISOString(),
        lastMessageAt: iso(conversation.lastMessageAt),
      },
      customer,
      metrics: {
        totalSpend: dec(spend?._sum.total ?? null),
        paidOrders: spend?._count._all ?? 0,
        orderCount,
        quoteCount,
        firstContactAt: customer?.createdAt ?? conversation.createdAt.toISOString(),
      },
      orders: orders.map((o) => ({
        id: o.id,
        status: o.status,
        source: o.source,
        total: dec(o.total),
        createdAt: o.createdAt.toISOString(),
        paidAt: iso(o.paidAt),
      })),
      quotes: quotes.map((q) => ({
        id: q.id,
        status: q.status,
        total: dec(q.total),
        createdAt: q.createdAt.toISOString(),
        issuedAt: iso(q.issuedAt),
        expiresAt: q.expiresAt.toISOString(),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        orderId: p.orderId,
        status: p.status,
        amount: dec(p.amount),
        refundedTotal: dec(p.refundedTotal),
        currency: p.currency,
        createdAt: p.createdAt.toISOString(),
        capturedAt: iso(p.capturedAt),
      })),
      openOrderId: openOrder?.id ?? null,
      openQuoteId: openQuote?.id ?? null,
      notes: notes.map((n) => ({
        id: n.id,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
        author: n.author,
      })),
      timeline: buildTimeline({
        conversation: {
          externalPhone: conversation.externalPhone,
          createdAt: conversation.createdAt,
        },
        orders,
        quotes,
        payments,
        notes,
        audits,
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Fusión de la línea de tiempo
// ---------------------------------------------------------------------------

export interface TimelineInput {
  conversation: { externalPhone: string; createdAt: Date };
  orders: ContextOrderRow[];
  quotes: ContextQuoteRow[];
  payments: ContextPaymentRow[];
  notes: ContextNoteRow[];
  audits: ContextAuditRow[];
}

/**
 * Un evento por recurso, fechado en su hito más avanzado (una cotización
 * aceptada se cuenta como "aceptada", no tres veces: creada, enviada y
 * aceptada). Así la línea de tiempo cabe en una barra lateral en vez de
 * repetir el mismo pedido en cada estado por el que pasó.
 *
 * Exportada aparte de la clase para poder fijarla en pruebas sin Prisma.
 */
export function buildTimeline(input: TimelineInput): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      id: `conversation:${input.conversation.createdAt.getTime()}`,
      kind: "conversation",
      at: input.conversation.createdAt.toISOString(),
      title: "Conversación iniciada",
      detail: input.conversation.externalPhone,
      status: null,
      statusDomain: null,
      amount: null,
      actor: null,
      href: null,
    },
  ];

  for (const q of input.quotes) {
    const at = q.acceptedAt ?? q.issuedAt ?? q.createdAt;
    const title = q.acceptedAt
      ? "Cotización aceptada"
      : q.issuedAt
        ? "Cotización enviada"
        : "Cotización creada";
    events.push({
      id: `quote:${q.id}`,
      kind: "quote",
      at: at.toISOString(),
      title,
      detail: null,
      status: q.status,
      statusDomain: "quote",
      amount: dec(q.total),
      actor: null,
      href: `/quotes/${q.id}`,
    });
  }

  for (const o of input.orders) {
    const at = o.paidAt ?? o.placedAt ?? o.createdAt;
    const title = o.paidAt ? "Pedido pagado" : o.placedAt ? "Pedido levantado" : "Pedido creado";
    events.push({
      id: `order:${o.id}`,
      kind: "order",
      at: at.toISOString(),
      title,
      detail: null,
      status: o.status,
      statusDomain: "order",
      amount: dec(o.total),
      actor: null,
      href: `/orders/${o.id}`,
    });
  }

  for (const p of input.payments) {
    const at = p.capturedAt ?? p.failedAt ?? p.createdAt;
    const title = p.capturedAt ? "Pago cobrado" : p.failedAt ? "Pago rechazado" : "Cobro iniciado";
    events.push({
      id: `payment:${p.id}`,
      kind: "payment",
      at: at.toISOString(),
      title,
      detail: null,
      status: p.status,
      statusDomain: "payment",
      amount: dec(p.amount),
      actor: null,
      href: `/payments/${p.id}`,
    });
  }

  for (const n of input.notes) {
    events.push({
      id: `note:${n.id}`,
      kind: "note",
      at: n.createdAt.toISOString(),
      title: "Nota interna",
      detail: excerpt(n.body),
      status: null,
      statusDomain: null,
      amount: null,
      actor: n.author?.fullName ?? null,
      href: null,
    });
  }

  for (const a of input.audits) {
    events.push({
      id: `audit:${a.id}`,
      kind: "system",
      at: a.createdAt.toISOString(),
      title: AUDIT_TITLES[a.action] ?? a.action,
      detail: auditDetail(a.action, a.metadata),
      status: null,
      statusDomain: null,
      amount: null,
      actor: a.actor?.fullName ?? null,
      href: null,
    });
  }

  return events.sort((x, y) => Date.parse(y.at) - Date.parse(x.at)).slice(0, TIMELINE_TAKE);
}
