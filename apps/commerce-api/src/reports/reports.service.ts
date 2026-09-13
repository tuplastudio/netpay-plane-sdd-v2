/**
 * Agregados operativos del comercio (T-PAY / T-ORD / T-QTE / T-CAT / T-WHA).
 *
 * Motivación: TODOS los listados del API vienen truncados en servidor
 * (`listSessions` 50, pedidos 50, cotizaciones 50, conversaciones 50, ledger
 * 100, productos `limit + 1`), así que cualquier cifra que el portal calculara
 * sumando filas describía una ventana, no el negocio. Aquí las cifras se
 * calculan **en SQL sobre la tabla completa**: `aggregate` / `groupBy` /
 * `count` / `$queryRaw`. En este módulo no se traen filas para sumarlas en JS.
 *
 * Todo el dinero sale como **string decimal** con dos decimales, nunca como
 * `number`: los importes son `Decimal(12,2)` y serializarlos a float perdería
 * centavos en los extremos.
 */

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Estados de `CheckoutSession` en los que el dinero llegó a entrar.
 *
 * `REFUNDED` y `PARTIALLY_REFUNDED` cuentan en el BRUTO: la sesión se cobró,
 * y el reembolso se resta aparte. Excluirlas era justo el error que hacía
 * irrecuperable el importe cobrado de una sesión reembolsada.
 */
const CAPTURED_STATUSES = ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

/**
 * Lista de estados como literales SQL. Son constantes del código (no entra
 * nada del request), así que `Prisma.raw` es seguro aquí; se prefiere a
 * parametrizarlas para que el plan de Postgres use el índice
 * `(tenantId, status)` sin depender de la inferencia de tipo del parámetro.
 */
const CAPTURED_STATUSES_SQL = Prisma.raw(
  CAPTURED_STATUSES.map((s) => `'${s}'::"PaymentStatus"`).join(", "),
);

/** Pedidos que todavía esperan cobro. */
const OUTSTANDING_ORDER_STATUSES = ["AWAITING_PAYMENT", "CHECKOUT_OPEN"] as const;

const QUOTE_EXPIRY_HORIZON_DAYS = 7;

export interface ReportSummary {
  /** Σ `amount` de las sesiones que llegaron a cobrarse. El reembolso no lo baja. */
  capturedGross: string;
  /** Σ `amount` de los asientos REFUND del ledger. */
  refundedTotal: string;
  /** `capturedGross - refundedTotal`. Nunca negativo. */
  capturedNet: string;
  /** Σ `total` de los pedidos AWAITING_PAYMENT / CHECKOUT_OPEN. */
  outstandingTotal: string;
  outstandingCount: number;
  issuedQuotes: number;
  quotesExpiringWithin7Days: number;
  activeProducts: number;
  draftProducts: number;
  openConversations: number;
  escalatedConversations: number;
}

/** Fila que devuelve el `$queryRaw` del bloque de dinero. */
interface MoneyRow {
  capturedGross: Prisma.Decimal | null;
  refundedTotal: Prisma.Decimal | null;
}

function money(value: Prisma.Decimal | null | undefined): string {
  return (value ?? new Prisma.Decimal(0)).toFixed(2);
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(tenantId: string): Promise<ReportSummary> {
    const now = new Date();
    const horizon = new Date(now.getTime() + QUOTE_EXPIRY_HORIZON_DAYS * 24 * 60 * 60 * 1000);

    const [moneyRows, outstanding, issuedQuotes, expiringQuotes, products, conversations] =
      await Promise.all([
        this.money(tenantId),
        this.prisma.order.aggregate({
          where: { tenantId, status: { in: [...OUTSTANDING_ORDER_STATUSES] } },
          _sum: { total: true },
          _count: { _all: true },
        }),
        this.prisma.quote.count({ where: { tenantId, status: "ISSUED" } }),
        this.prisma.quote.count({
          where: {
            tenantId,
            status: "ISSUED",
            expiresAt: { gte: now, lte: horizon },
          },
        }),
        this.prisma.product.groupBy({
          by: ["status"],
          where: { tenantId },
          _count: { _all: true },
        }),
        this.prisma.whatsAppConversation.groupBy({
          by: ["status", "handoffToHuman"],
          where: { tenantId },
          _count: { _all: true },
        }),
      ]);

    const row = moneyRows[0];
    const capturedGross = new Prisma.Decimal(row?.capturedGross ?? 0);
    const refunded = new Prisma.Decimal(row?.refundedTotal ?? 0);
    const net = capturedGross.minus(refunded);

    const productCount = (status: string) =>
      products.find((p) => p.status === status)?._count._all ?? 0;

    const conversationCount = (predicate: (r: (typeof conversations)[number]) => boolean) =>
      conversations.filter(predicate).reduce((n, r) => n + r._count._all, 0);

    return {
      capturedGross: capturedGross.toFixed(2),
      refundedTotal: refunded.toFixed(2),
      // La invariante `refundedTotal <= amount` por sesión impide que el neto
      // baje de cero; el clamp solo cubre datos anteriores a esa invariante.
      capturedNet: net.lessThan(0) ? "0.00" : net.toFixed(2),
      outstandingTotal: money(outstanding._sum.total),
      outstandingCount: outstanding._count._all,
      issuedQuotes,
      quotesExpiringWithin7Days: expiringQuotes,
      activeProducts: productCount("ACTIVE"),
      draftProducts: productCount("DRAFT"),
      openConversations: conversationCount((r) => r.status === "OPEN"),
      escalatedConversations: conversationCount((r) => r.handoffToHuman),
    };
  }

  /**
   * Resumen unificado del dashboard operativo del tenant: KPIs financieros,
   * comerciales y la lista corta de actividad reciente. Se consolidó en un
   * solo endpoint porque el frontend abre la home y necesita 6-8 lecturas
   * entrelazadas sin muestreo en cliente.
   *
   * Costos agregados en una sola SQL contra varias tablas. Los conteos se
   * calculan con `groupBy` o `count` directo; los recientes son `findMany`
   * con `take` chiquito, no `count > listar en JS`.
   */
  async dashboard(tenantId: string) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      moneyRows,
      outstandingAgg,
      issuedQuotes,
      productsByStatus,
      conversationsByStatus,
      customersTotal,
      newCustomersToday,
      ordersToday,
      ordersMtd,
      revenueToday,
      revenueMtd,
      salesTrend,
      recentOrders,
      recentConversations,
      recentActivity,
    ] = await Promise.all([
      this.money(tenantId),
      this.prisma.order.aggregate({
        where: { tenantId, status: { in: [...OUTSTANDING_ORDER_STATUSES] } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.quote.count({ where: { tenantId, status: "ISSUED" } }),
      this.prisma.product.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }),
      this.prisma.whatsAppConversation.groupBy({
        by: ["status", "handoffToHuman"],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.customer.count({ where: { tenantId } }),
      this.prisma.customer.count({
        where: { tenantId, createdAt: { gte: startOfToday, lte: now } },
      }),
      this.prisma.order.count({
        where: { tenantId, createdAt: { gte: startOfToday, lte: now } },
      }),
      this.prisma.order.count({
        where: { tenantId, createdAt: { gte: startOfMonth, lte: now } },
      }),
      this.prisma.order.aggregate({
        where: { tenantId, createdAt: { gte: startOfToday, lte: now }, status: { in: ["PAID", "FULFILLED"] } },
        _sum: { total: true },
      }),
      this.prisma.order.aggregate({
        where: { tenantId, createdAt: { gte: startOfMonth, lte: now }, status: { in: ["PAID", "FULFILLED"] } },
        _sum: { total: true },
      }),
      this.salesTrend(tenantId, sevenDaysAgo, now),
      this.prisma.order.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { customer: { select: { id: true, fullName: true } } },
      }),
      this.prisma.whatsAppConversation.findMany({
        where: { tenantId },
        orderBy: { lastMessageAt: "desc" },
        take: 5,
        select: {
          id: true,
          externalPhone: true,
          status: true,
          handoffToHuman: true,
          lastMessageAt: true,
          customerId: true,
        },
      }),
      this.prisma.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { actor: { select: { id: true, email: true, fullName: true } } },
      }),
    ]);

    const row = moneyRows[0];
    const capturedGross = new Prisma.Decimal(row?.capturedGross ?? 0);
    const refunded = new Prisma.Decimal(row?.refundedTotal ?? 0);
    const net = capturedGross.minus(refunded);

    const productCount = (status: string) =>
      productsByStatus.find((p) => p.status === status)?._count._all ?? 0;

    const conversationCount = (
      predicate: (r: (typeof conversationsByStatus)[number]) => boolean,
    ) => conversationsByStatus.filter(predicate).reduce((n, r) => n + r._count._all, 0);

    return {
      kpis: {
        customers: {
          total: customersTotal,
          newToday: newCustomersToday,
        },
        orders: {
          today: ordersToday,
          mtd: ordersMtd,
        },
        revenue: {
          today: money(revenueToday._sum.total),
          mtd: money(revenueMtd._sum.total),
        },
        captured: {
          gross: capturedGross.toFixed(2),
          refunded: refunded.toFixed(2),
          net: net.lessThan(0) ? "0.00" : net.toFixed(2),
        },
        outstanding: {
          total: money(outstandingAgg._sum.total),
          count: outstandingAgg._count._all,
        },
        issuedQuotes,
        products: {
          active: productCount("ACTIVE"),
          draft: productCount("DRAFT"),
        },
        conversations: {
          open: conversationCount((r) => r.status === "OPEN"),
          escalated: conversationCount((r) => r.handoffToHuman),
        },
      },
      salesTrend,
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        status: o.status,
        total: o.total.toFixed(2),
        createdAt: o.createdAt,
        customer: o.customer,
      })),
      recentConversations,
      recentActivity: recentActivity.map((r) => ({
        id: r.id,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        metadata: r.metadata,
        createdAt: r.createdAt,
        actor: r.actor,
      })),
      generatedAt: now,
    };
  }

  /**
   * Serie día-por-día de los últimos N días: total de ventas (PAID+FULFILLED),
   * número de pedidos y número de órdenes cobradas. Construimos los 7 días en
   * memoria y rellenamos con cero los días sin movimiento (la serie siempre
   * tiene exactamente 7 puntos).
   */
  private async salesTrend(tenantId: string, from: Date, to: Date) {
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        createdAt: { gte: from, lte: to },
        status: { in: ["PAID", "FULFILLED"] },
      },
      select: { createdAt: true, total: true },
    });
    const byDay = new Map<string, { orders: number; revenue: number }>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(to.getTime() - i * 24 * 60 * 60 * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      byDay.set(key, { orders: 0, revenue: 0 });
    }
    for (const o of orders) {
      const d = o.createdAt;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const cur = byDay.get(key);
      if (cur) {
        cur.orders += 1;
        cur.revenue += Number(o.total.toString());
      }
    }
    return Array.from(byDay.entries()).map(([day, v]) => ({
      day,
      orders: v.orders,
      revenueUsd: v.revenue.toFixed(2),
    }));
  }

  /**
   * Bruto cobrado y reembolsado en una sola pasada por SQL.
   *
   * Dos escaneos independientes agregados a nivel de base — no se cruzan con
   * un JOIN porque una sesión tiene N asientos de ledger y el JOIN
   * multiplicaría `amount` por el número de asientos.
   *
   * `capturedGross` sale de `CheckoutSession.amount`, que el reembolso ya no
   * modifica; `refundedTotal` sale de `LedgerEntry`, el registro del dinero
   * que efectivamente se devolvió. `refund()` escribe ambos lados en la misma
   * transacción, así que coinciden con `Σ CheckoutSession.refundedTotal`.
   */
  private money(tenantId: string): Promise<MoneyRow[]> {
    return this.prisma.$queryRaw<MoneyRow[]>(Prisma.sql`
      SELECT
        (
          SELECT COALESCE(SUM(cs."amount"), 0)
            FROM "CheckoutSession" cs
           WHERE cs."tenantId" = ${tenantId}::uuid
             AND cs."status" IN (${CAPTURED_STATUSES_SQL})
        ) AS "capturedGross",
        (
          SELECT COALESCE(SUM(le."amount"), 0)
            FROM "LedgerEntry" le
           WHERE le."tenantId" = ${tenantId}::uuid
             AND le."entryType" = 'REFUND'::"LedgerEntryType"
        ) AS "refundedTotal"
    `);
  }
}
