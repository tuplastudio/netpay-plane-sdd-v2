import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  CustomerProfileService,
  csvCell,
  normalizeTags,
} from "../src/customers/customer-profile.service.js";

/**
 * Perfil 360°: resumen de por vida y línea de tiempo unificada. Prisma es un
 * fake en memoria (mismo enfoque que `customer-resolve-channel.test.ts`);
 * aquí importa la aritmética (ticket promedio, totales) y el merge/paginado
 * de la línea de tiempo, no el SQL.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const CUSTOMER = "22222222-2222-2222-2222-222222222222";

const d = (s: string) => new Date(s);

function makeFakePrisma() {
  const customer = { id: CUSTOMER, tenantId: TENANT, createdAt: d("2026-01-10T10:00:00Z") };
  const orders = [
    { id: "o1", status: "PAID", total: new Prisma.Decimal("100.00"), paidAt: d("2026-02-01T10:00:00Z"), createdAt: d("2026-02-01T09:00:00Z") },
    { id: "o2", status: "FULFILLED", total: new Prisma.Decimal("300.00"), paidAt: d("2026-03-01T10:00:00Z"), createdAt: d("2026-03-01T09:00:00Z") },
    { id: "o3", status: "AWAITING_PAYMENT", total: new Prisma.Decimal("50.00"), paidAt: null, createdAt: d("2026-03-05T09:00:00Z") },
    { id: "o4", status: "REFUNDED", total: new Prisma.Decimal("20.00"), paidAt: null, createdAt: d("2026-01-20T09:00:00Z") },
  ];
  const quotes = [
    { id: "q1", status: "ISSUED", total: new Prisma.Decimal("120.00"), createdAt: d("2026-03-10T09:00:00Z"), issuedAt: null, expiresAt: d("2026-03-17T09:00:00Z"), acceptedAt: null, order: null },
    { id: "q2", status: "ACCEPTED", total: new Prisma.Decimal("300.00"), createdAt: d("2026-02-28T09:00:00Z"), issuedAt: null, expiresAt: d("2026-03-07T09:00:00Z"), acceptedAt: null, order: { id: "o2" } },
  ];
  const conversations = [
    { id: "c1", status: "OPEN", handoffToHuman: false, externalPhone: "+5215500000000", tags: [], lastMessageAt: d("2026-03-12T09:00:00Z"), createdAt: d("2026-01-05T09:00:00Z"), closedAt: null, connection: { provider: "META" } },
  ];
  const notes = [
    { id: "n1", body: "Prefiere entrega en la tarde", createdAt: d("2026-03-11T09:00:00Z"), author: null },
  ];

  const statusIn = (row: { status: string }, where: { status?: unknown }) => {
    const st = where.status as { in?: string[]; not?: string } | string | undefined;
    if (!st) return true;
    if (typeof st === "string") return row.status === st;
    if (st.in) return st.in.includes(row.status);
    if (st.not) return row.status !== st.not;
    return true;
  };

  return {
    customer: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
        where.id === CUSTOMER && where.tenantId === TENANT ? customer : null,
    },
    order: {
      count: async ({ where }: { where: { status?: unknown } }) =>
        orders.filter((o) => statusIn(o, where)).length,
      aggregate: async ({ where }: { where: { status?: unknown } }) => {
        const rows = orders.filter((o) => statusIn(o, where));
        const sum = rows.reduce((acc, o) => acc.add(o.total), new Prisma.Decimal(0));
        const paidAts = rows.map((o) => o.paidAt).filter((x): x is Date => !!x);
        const createdAts = rows.map((o) => o.createdAt);
        const max = (xs: Date[]) => (xs.length ? new Date(Math.max(...xs.map((x) => x.getTime()))) : null);
        const min = (xs: Date[]) => (xs.length ? new Date(Math.min(...xs.map((x) => x.getTime()))) : null);
        return {
          _sum: { total: rows.length ? sum : null },
          _count: { _all: rows.length },
          _max: { paidAt: max(paidAts), createdAt: max(createdAts) },
          _min: { paidAt: min(paidAts), createdAt: min(createdAts) },
        };
      },
      findMany: async ({ take }: { take: number }) =>
        [...orders]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, take)
          .map((o) => ({ ...o, source: "DIRECT", fulfilledAt: null, description: null, requiresInvoice: false, invoiceStatus: "NONE", quoteId: null })),
    },
    quote: {
      count: async ({ where }: { where: { status?: unknown } }) =>
        quotes.filter((q) => statusIn(q, where)).length,
      findFirst: async () => quotes[0],
      findMany: async ({ take }: { take: number }) =>
        [...quotes].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take),
    },
    checkoutSession: {
      count: async () => 0,
      findMany: async () => [],
    },
    whatsAppConversation: {
      count: async ({ where }: { where: { status?: unknown } }) =>
        conversations.filter((c) => statusIn(c, where)).length,
      aggregate: async () => ({
        _min: { createdAt: conversations[0]!.createdAt },
        _max: { lastMessageAt: conversations[0]!.lastMessageAt },
      }),
      findFirst: async () => ({ id: conversations[0]!.id }),
      findMany: async ({ take }: { take: number }) => conversations.slice(0, take),
    },
    customerNote: {
      count: async () => notes.length,
      findMany: async ({ take }: { take: number }) => notes.slice(0, take),
    },
    customerAddress: { count: async () => 2 },
    customerIdentity: { count: async () => 1 },
  };
}

function makeService() {
  return new CustomerProfileService(makeFakePrisma() as never);
}

describe("CustomerProfileService.summary", () => {
  it("suma solo pedidos pagados/entregados y calcula ticket promedio", async () => {
    const s = await makeService().summary(TENANT, CUSTOMER);
    expect(s.ordersCount).toBe(4);
    expect(s.paidOrdersCount).toBe(2);
    expect(s.totalPaid).toBe("400.00");
    expect(s.averageTicket).toBe("200.00");
    expect(s.refundedOrdersCount).toBe(1);
    expect(s.lastPurchaseAt).toBe("2026-03-01T10:00:00.000Z");
    expect(s.firstPurchaseAt).toBe("2026-02-01T10:00:00.000Z");
  });

  it("cuenta cobros pendientes y cotizaciones abiertas", async () => {
    const s = await makeService().summary(TENANT, CUSTOMER);
    expect(s.pendingPaymentsCount).toBe(1);
    expect(s.pendingPaymentsAmount).toBe("50.00");
    expect(s.quotesCount).toBe(2);
    expect(s.openQuotesCount).toBe(1);
  });

  it("primer contacto es la conversación más vieja aunque la ficha sea posterior", async () => {
    const s = await makeService().summary(TENANT, CUSTOMER);
    expect(s.firstContactAt).toBe("2026-01-05T09:00:00.000Z");
    expect(s.lastContactAt).toBe("2026-03-12T09:00:00.000Z");
    expect(s.lastConversationId).toBe("c1");
    expect(s.conversationsCount).toBe(1);
    expect(s.notesCount).toBe(1);
    expect(s.addressesCount).toBe(2);
  });

  it("404 para un cliente de otro tenant", async () => {
    await expect(makeService().summary("33333333-3333-3333-3333-333333333333", CUSTOMER)).rejects.toMatchObject({
      response: { code: "NOT_FOUND" },
    });
  });
});

describe("CustomerProfileService.timeline", () => {
  it("funde todas las fuentes ordenadas de más reciente a más antigua", async () => {
    const { items, total } = await makeService().timeline(TENANT, CUSTOMER, "all", {
      limit: 25,
      offset: 0,
    });
    expect(total).toBe(4 + 2 + 1 + 1);
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      "conversation:c1",
      "note:n1",
      "quote:q1",
      "order:o3",
      "order:o2",
      "quote:q2",
      "order:o1",
      "order:o4",
    ]);
    const quote = items.find((i) => i.id === "q2");
    expect(quote?.meta.orderId).toBe("o2");
  });

  it("pagina por offset sobre el merge", async () => {
    const page2 = await makeService().timeline(TENANT, CUSTOMER, "all", { limit: 3, offset: 3 });
    expect(page2.items.map((i) => i.id)).toEqual(["o3", "o2", "q2"]);
    expect(page2.total).toBe(8);
  });

  it("filtra por tipo", async () => {
    const onlyOrders = await makeService().timeline(TENANT, CUSTOMER, "order", {
      limit: 10,
      offset: 0,
    });
    expect(onlyOrders.total).toBe(4);
    expect(onlyOrders.items.every((i) => i.kind === "order")).toBe(true);
    expect(onlyOrders.items[0]?.amount).toBe("50.00");
  });
});

describe("helpers", () => {
  it("normalizeTags: minúsculas, sin duplicados ni vacíos", () => {
    expect(normalizeTags([" VIP ", "vip", "Mayoreo  grande", "", "  "])).toEqual([
      "vip",
      "mayoreo grande",
    ]);
    expect(normalizeTags(undefined)).toBeUndefined();
  });

  it("csvCell escapa comas, comillas y saltos", () => {
    expect(csvCell("Pérez, S.A.")).toBe('"Pérez, S.A."');
    expect(csvCell('di "hola"')).toBe('"di ""hola"""');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12)).toBe("12");
  });
});
