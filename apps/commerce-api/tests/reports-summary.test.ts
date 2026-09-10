import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { ReportsService } from "../src/reports/reports.service.js";

/**
 * `GET /reports/summary` (T-RPT-01).
 *
 * Lo que estas pruebas fijan:
 *
 *  - Las cifras se piden a la base como AGREGADOS. El doble de Prisma no
 *    implementa `findMany`: si alguien vuelve a traer filas para sumarlas en
 *    JS, la prueba revienta con "no se permiten listados".
 *  - El dinero sale como string decimal de dos decimales, nunca como `number`.
 *  - `capturedNet = capturedGross - refundedTotal`, con `capturedGross` sobre
 *    `CheckoutSession` y `refundedTotal` sobre `LedgerEntry`, y el bruto
 *    incluye las sesiones ya reembolsadas (parcial o totalmente): ese era el
 *    error que hacía irrecuperable el importe cobrado.
 *  - Cada consulta va acotada al tenant que pide.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const D = (v: string) => new Prisma.Decimal(v);

interface Scenario {
  capturedGross?: string;
  refundedTotal?: string;
  outstandingSum?: string | null;
  outstandingCount?: number;
  issuedQuotes?: number;
  expiringQuotes?: number;
  products?: Array<{ status: string; count: number }>;
  conversations?: Array<{ status: string; handoffToHuman: boolean; count: number }>;
}

function makeFakePrisma(s: Scenario) {
  const calls: string[] = [];
  const tenants = new Set<string>();
  let quoteCallIndex = 0;
  let rawSql = "";

  const noList = () => {
    throw new Error("no se permiten listados: los agregados se calculan en SQL");
  };

  const prisma = {
    $queryRaw(sql: Prisma.Sql) {
      calls.push("$queryRaw");
      rawSql = sql.strings.join("?");
      for (const v of sql.values) if (typeof v === "string") tenants.add(v);
      return Promise.resolve([
        {
          capturedGross: D(s.capturedGross ?? "0"),
          refundedTotal: D(s.refundedTotal ?? "0"),
        },
      ]);
    },
    order: {
      findMany: noList,
      aggregate: (args: { where: { tenantId: string; status: { in: string[] } } }) => {
        calls.push("order.aggregate");
        tenants.add(args.where.tenantId);
        expect(args.where.status.in.sort()).toEqual(["AWAITING_PAYMENT", "CHECKOUT_OPEN"]);
        return Promise.resolve({
          _sum: { total: s.outstandingSum === null ? null : D(s.outstandingSum ?? "0") },
          _count: { _all: s.outstandingCount ?? 0 },
        });
      },
    },
    quote: {
      findMany: noList,
      count: (args: { where: { tenantId: string; expiresAt?: unknown } }) => {
        calls.push("quote.count");
        tenants.add(args.where.tenantId);
        const isExpiryQuery = args.where.expiresAt !== undefined;
        quoteCallIndex += 1;
        return Promise.resolve(
          isExpiryQuery ? (s.expiringQuotes ?? 0) : (s.issuedQuotes ?? 0),
        );
      },
    },
    product: {
      findMany: noList,
      groupBy: (args: { where: { tenantId: string } }) => {
        calls.push("product.groupBy");
        tenants.add(args.where.tenantId);
        return Promise.resolve(
          (s.products ?? []).map((p) => ({ status: p.status, _count: { _all: p.count } })),
        );
      },
    },
    whatsAppConversation: {
      findMany: noList,
      groupBy: (args: { where: { tenantId: string } }) => {
        calls.push("conversation.groupBy");
        tenants.add(args.where.tenantId);
        return Promise.resolve(
          (s.conversations ?? []).map((c) => ({
            status: c.status,
            handoffToHuman: c.handoffToHuman,
            _count: { _all: c.count },
          })),
        );
      },
    },
    checkoutSession: { findMany: noList },
    ledgerEntry: { findMany: noList },
  };

  return { prisma, calls, tenants, rawSql: () => rawSql, quoteCalls: () => quoteCallIndex };
}

function makeService(fake: ReturnType<typeof makeFakePrisma>) {
  return new ReportsService(fake.prisma as never);
}

describe("ReportsService#summary", () => {
  it("devuelve la forma completa con dinero en string decimal", async () => {
    const fake = makeFakePrisma({
      capturedGross: "12500.75",
      refundedTotal: "1300.25",
      outstandingSum: "4200.00",
      outstandingCount: 7,
      issuedQuotes: 12,
      expiringQuotes: 3,
      products: [
        { status: "ACTIVE", count: 41 },
        { status: "DRAFT", count: 9 },
        { status: "ARCHIVED", count: 4 },
      ],
      conversations: [
        { status: "OPEN", handoffToHuman: false, count: 5 },
        { status: "OPEN", handoffToHuman: true, count: 2 },
        { status: "HANDED_OFF", handoffToHuman: true, count: 3 },
        { status: "CLOSED", handoffToHuman: false, count: 30 },
      ],
    });

    const out = await makeService(fake).summary(TENANT);

    expect(out).toEqual({
      capturedGross: "12500.75",
      refundedTotal: "1300.25",
      capturedNet: "11200.50",
      outstandingTotal: "4200.00",
      outstandingCount: 7,
      issuedQuotes: 12,
      quotesExpiringWithin7Days: 3,
      activeProducts: 41,
      draftProducts: 9,
      // OPEN sin importar el handoff: 5 + 2.
      openConversations: 7,
      // Escaladas sin importar el estado: 2 + 3.
      escalatedConversations: 5,
    });

    // Todo string, ningún float suelto.
    for (const key of [
      "capturedGross",
      "refundedTotal",
      "capturedNet",
      "outstandingTotal",
    ] as const) {
      expect(typeof out[key]).toBe("string");
      expect(out[key]).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("un comercio sin actividad devuelve ceros, no null ni NaN", async () => {
    const out = await makeService(makeFakePrisma({ outstandingSum: null })).summary(TENANT);
    expect(out).toEqual({
      capturedGross: "0.00",
      refundedTotal: "0.00",
      capturedNet: "0.00",
      outstandingTotal: "0.00",
      outstandingCount: 0,
      issuedQuotes: 0,
      quotesExpiringWithin7Days: 0,
      activeProducts: 0,
      draftProducts: 0,
      openConversations: 0,
      escalatedConversations: 0,
    });
  });

  it("el neto es exacto en importes que en flotante derivan", async () => {
    // 0.30 - 0.10 - 0.20 en flotante deja 2.7e-17; con Decimal es 0.00 clavado.
    const out = await makeService(
      makeFakePrisma({ capturedGross: "0.30", refundedTotal: "0.30" }),
    ).summary(TENANT);
    expect(out.capturedNet).toBe("0.00");

    const out2 = await makeService(
      makeFakePrisma({ capturedGross: "1000000.10", refundedTotal: "0.20" }),
    ).summary(TENANT);
    expect(out2.capturedNet).toBe("999999.90");
  });

  it("el bruto no se pierde cuando la sesión ya se reembolsó del todo", async () => {
    // Ese era el bug de origen: la sesión salía del filtro CAPTURED y su
    // importe original dejaba de ser recuperable. El SQL incluye
    // PARTIALLY_REFUNDED y REFUNDED en el bruto.
    const fake = makeFakePrisma({ capturedGross: "500.00", refundedTotal: "500.00" });
    const out = await makeService(fake).summary(TENANT);
    expect(out.capturedGross).toBe("500.00");
    expect(out.capturedNet).toBe("0.00");

    const sql = fake.rawSql().replace(/\s+/g, " ");
    expect(sql).toMatch(/'CAPTURED'::"PaymentStatus"/);
    expect(sql).toMatch(/'PARTIALLY_REFUNDED'::"PaymentStatus"/);
    expect(sql).toMatch(/'REFUNDED'::"PaymentStatus"/);
    expect(sql).toMatch(/SUM\(cs\."amount"\)/i);
    expect(sql).toMatch(/SUM\(le\."amount"\)/i);
    expect(sql).toMatch(/FROM "LedgerEntry" le/i);
  });

  it("todo se calcula con agregados, nunca trayendo filas", async () => {
    const fake = makeFakePrisma({});
    await makeService(fake).summary(TENANT);
    expect(fake.calls.sort()).toEqual([
      "$queryRaw",
      "conversation.groupBy",
      "order.aggregate",
      "product.groupBy",
      "quote.count",
      "quote.count",
    ]);
    // Dos `count` de cotizaciones: emitidas y las que vencen en 7 días.
    expect(fake.quoteCalls()).toBe(2);
  });

  it("cada consulta va acotada al tenant que pide", async () => {
    const fake = makeFakePrisma({});
    await makeService(fake).summary(TENANT);
    expect([...fake.tenants]).toEqual([TENANT]);
  });

  it("la ventana de vencimiento son 7 días a futuro desde ahora", async () => {
    let where: { expiresAt?: { gte: Date; lte: Date } } | undefined;
    const fake = makeFakePrisma({});
    const original = fake.prisma.quote.count;
    fake.prisma.quote.count = (args: { where: { tenantId: string; expiresAt?: unknown } }) => {
      if (args.where.expiresAt) {
        where = args.where as { expiresAt: { gte: Date; lte: Date } };
      }
      return original(args);
    };

    const before = Date.now();
    await makeService(fake).summary(TENANT);

    expect(where?.expiresAt).toBeDefined();
    const { gte, lte } = where!.expiresAt!;
    expect(gte.getTime()).toBeGreaterThanOrEqual(before);
    expect(lte.getTime() - gte.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
