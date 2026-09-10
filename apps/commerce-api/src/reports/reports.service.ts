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
