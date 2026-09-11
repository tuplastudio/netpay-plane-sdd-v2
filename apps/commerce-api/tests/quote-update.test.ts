import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { QuoteService } from "../src/quotes/quote.service.js";
import type { PrismaService } from "../src/prisma/prisma.service.js";
import type { PricingService } from "../src/pricing/pricing.service.js";
import type { CustomerService } from "../src/customers/customer.service.js";
import type { NotificationService } from "../src/notifications/notification.service.js";

/**
 * Edición de cotizaciones no pagadas (QuoteService#update).
 *
 * Lo que se fija aquí es el contrato de negocio, no el SQL:
 *  - una cotización cerrada o ya pagada NO se edita;
 *  - editar recalcula totales, reemplaza líneas y sube `version`;
 *  - si el cliente ya la vio (ACCEPTED, o ISSUED y compartida) se le manda
 *    un link nuevo con la plantilla QUOTE_UPDATED;
 *  - si ya tenía pedido sin pagar, ese pedido vuelve a DRAFT, se libera la
 *    reserva de stock del checkout anterior y se cancelan las sesiones
 *    pendientes.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const D = (v: string) => new Prisma.Decimal(v);

type Row = Record<string, unknown>;

function makeFake(seed: {
  quote: Row;
  order?: Row | null;
  payments?: Row[];
  shares?: number;
  reservedLines?: Row[];
}) {
  const writes: Array<{ table: string; op: string; args: unknown }> = [];
  const quote = { ...seed.quote };
  const order = seed.order ? { ...seed.order, payments: seed.payments ?? [] } : null;
  const tx = {
    quoteLine: {
      deleteMany: async (args: unknown) => {
        writes.push({ table: "quoteLine", op: "deleteMany", args });
        return { count: 1 };
      },
    },
    quote: {
      update: async (args: { data: Row }) => {
        writes.push({ table: "quote", op: "update", args });
        const data = args.data as Row & { version?: { increment: number } };
        Object.assign(quote, {
          ...data,
          version: (quote.version as number) + (data.version?.increment ?? 0),
          lines: (data.lines as { create: Row[] } | undefined)?.create ?? quote.lines,
        });
        return { ...quote, customer: { fullName: "Cliente" } };
      },
    },
    orderRevision: {
      update: async (args: unknown) => {
        writes.push({ table: "orderRevision", op: "update", args });
      },
    },
    checkoutSession: {
      updateMany: async (args: unknown) => {
        writes.push({ table: "checkoutSession", op: "updateMany", args });
        return { count: 1 };
      },
    },
    order: {
      update: async (args: unknown) => {
        writes.push({ table: "order", op: "update", args });
      },
    },
    auditLog: {
      create: async (args: unknown) => {
        writes.push({ table: "auditLog", op: "create", args });
      },
    },
  };
  const prisma = {
    quote: {
      findFirst: async () => ({
        ...quote,
        customer: { fullName: "Cliente", phone: "+5215555555555", email: null },
        lines: quote.lines ?? [],
        order,
        tenant: { id: TENANT },
        _count: { shares: seed.shares ?? 0 },
      }),
    },
    orderRevisionLine: {
      findMany: async () => seed.reservedLines ?? [],
    },
    quoteShareToken: {
      create: async (args: { data: Row }) => {
        writes.push({ table: "quoteShareToken", op: "create", args });
        return { ...args.data, id: "share-1" };
      },
    },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return { prisma, writes, quote };
}

function makeService(fake: ReturnType<typeof makeFake>) {
  const released: unknown[] = [];
  const scheduled: Row[] = [];
  const pricing = {
    price: async (_t: string, lines: Array<{ variantId: string; quantity: string }>) => ({
      totals: {
        subtotal: D("200.00"),
        discount: D("0.00"),
        taxBase: D("200.00"),
        tax: D("32.00"),
        shipping: D("0.00"),
        total: D("232.00"),
      },
      lines: lines.map((l) => ({
        variantId: l.variantId,
        sku: `SKU-${l.variantId}`,
        title: "Producto",
        quantity: l.quantity,
        unitPrice: D("100.00"),
        discountPct: D("0"),
        lineSubtotal: D("200.00"),
        satProductCode: "01010101",
        satUnitCode: "H87",
      })),
    }),
    releaseStock: async (_t: string, lines: unknown) => {
      released.push(lines);
    },
  };
  const notifications = {
    scheduleFromTemplate: async (input: Row) => {
      scheduled.push(input);
    },
  };
  const service = new QuoteService(
    fake.prisma as unknown as PrismaService,
    pricing as unknown as PricingService,
    {} as unknown as CustomerService,
    notifications as unknown as NotificationService,
  );
  return { service, released, scheduled };
}

const baseQuote: Row = {
  id: "quote-1",
  tenantId: TENANT,
  customerId: "cust-1",
  status: "ISSUED",
  total: D("116.00"),
  version: 1,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  notes: null,
  lines: [],
};

const newLines = [{ variantId: "var-1", quantity: "2.000", discountPct: 0 }];

describe("QuoteService#update — reglas", () => {
  let fake: ReturnType<typeof makeFake>;
  beforeEach(() => {
    fake = makeFake({ quote: baseQuote });
  });

  it("rechaza editar una cotización cancelada", async () => {
    fake = makeFake({ quote: { ...baseQuote, status: "CANCELLED" } });
    const { service } = makeService(fake);
    await expect(service.update(TENANT, "quote-1", null, { lines: newLines })).rejects.toMatchObject({
      response: { code: "RULE_VIOLATION" },
    });
    expect(fake.writes).toHaveLength(0);
  });

  it("rechaza editar si el pedido ya se pagó", async () => {
    fake = makeFake({
      quote: { ...baseQuote, status: "ACCEPTED" },
      order: { id: "order-1", status: "PAID", currentRevisionId: null },
    });
    const { service } = makeService(fake);
    await expect(service.update(TENANT, "quote-1", null, { lines: newLines })).rejects.toMatchObject({
      response: { message: "El pedido de esta cotización ya se pagó" },
    });
  });

  it("rechaza editar si ya hay un cobro capturado aunque el pedido siga abierto", async () => {
    fake = makeFake({
      quote: { ...baseQuote, status: "ACCEPTED" },
      order: { id: "order-1", status: "AWAITING_PAYMENT", currentRevisionId: "rev-2" },
      payments: [{ id: "s1", status: "CAPTURED" }],
    });
    const { service } = makeService(fake);
    await expect(service.update(TENANT, "quote-1", null, { lines: newLines })).rejects.toMatchObject({
      response: { code: "RULE_VIOLATION" },
    });
  });

  it("exige al menos un cambio y al menos una línea", async () => {
    const { service } = makeService(fake);
    await expect(service.update(TENANT, "quote-1", null, {})).rejects.toMatchObject({
      response: { code: "VALIDATION_FAILED" },
    });
    await expect(service.update(TENANT, "quote-1", null, { lines: [] })).rejects.toMatchObject({
      response: { code: "VALIDATION_FAILED" },
    });
  });

  it("`get` expone `editable` calculado", async () => {
    const { service } = makeService(fake);
    const q = await service.get(TENANT, "quote-1");
    expect(q.editable).toBe(true);
  });
});

describe("QuoteService#update — efectos", () => {
  it("reemplaza líneas, recalcula totales, sube version y audita", async () => {
    const fake = makeFake({ quote: baseQuote });
    const { service, scheduled } = makeService(fake);
    const result = await service.update(TENANT, "quote-1", "user-1", {
      lines: newLines,
      notes: "Entrega en 3 días",
    });

    expect(fake.writes.map((w) => `${w.table}.${w.op}`)).toEqual([
      "quoteLine.deleteMany",
      "quote.update",
      "auditLog.create",
    ]);
    const update = fake.writes[1]!.args as { data: Row };
    expect((update.data.total as Prisma.Decimal).toFixed(2)).toBe("232.00");
    expect(update.data.notes).toBe("Entrega en 3 días");
    expect(update.data.version).toEqual({ increment: 1 });
    expect(result.customerNotified).toBe(false); // ISSUED sin compartir: nadie la vio
    expect(result.orderReset).toBe(false);
    expect(scheduled).toHaveLength(0);
  });

  it("solo notas: no toca líneas ni notifica", async () => {
    const fake = makeFake({ quote: { ...baseQuote, status: "ACCEPTED" } });
    const { service, scheduled } = makeService(fake);
    const result = await service.update(TENANT, "quote-1", "user-1", { notes: "x" });
    expect(fake.writes.map((w) => `${w.table}.${w.op}`)).toEqual(["quote.update", "auditLog.create"]);
    expect(result.customerNotified).toBe(false);
    expect(scheduled).toHaveLength(0);
  });

  it("ISSUED y compartida: reenvía link con QUOTE_UPDATED", async () => {
    const fake = makeFake({ quote: baseQuote, shares: 1 });
    const { service, scheduled } = makeService(fake);
    const result = await service.update(TENANT, "quote-1", "user-1", { lines: newLines });
    expect(result.customerNotified).toBe(true);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({
      templateKey: "QUOTE_UPDATED",
      recipientId: "cust-1",
      vars: { previousTotal: "116.00", total: "232.00" },
    });
    expect((scheduled[0]!.vars as Row).link).toMatch(/\/quotes\/public\//);
    expect(fake.writes.some((w) => w.table === "quoteShareToken")).toBe(true);
  });

  it("ACCEPTED con pedido en checkout: libera reserva, cancela sesiones y regresa el pedido a DRAFT", async () => {
    const fake = makeFake({
      quote: { ...baseQuote, status: "ACCEPTED" },
      order: { id: "order-1", status: "CHECKOUT_OPEN", currentRevisionId: "rev-2" },
      payments: [{ id: "s1", status: "PENDING" }],
      reservedLines: [{ variantId: "var-old", quantity: D("1.000") }],
    });
    const { service, released, scheduled } = makeService(fake);
    const result = await service.update(TENANT, "quote-1", "user-1", { lines: newLines });

    expect(result.orderReset).toBe(true);
    expect(result.customerNotified).toBe(true);
    // Decimal(18,3) → toString() quita ceros a la derecha, igual que en OrderService.
    expect(released).toEqual([[{ variantId: "var-old", quantity: "1" }]]);

    const ops = fake.writes.map((w) => `${w.table}.${w.op}`);
    expect(ops).toContain("orderRevision.update");
    expect(ops).toContain("checkoutSession.updateMany");
    expect(ops).toContain("order.update");

    const orderUpdate = fake.writes.find((w) => w.table === "order")!.args as { data: Row };
    expect(orderUpdate.data.status).toBe("DRAFT");
    expect(orderUpdate.data.currentRevisionId).toBeNull();
    expect((orderUpdate.data.total as Prisma.Decimal).toFixed(2)).toBe("232.00");

    const sessions = fake.writes.find((w) => w.table === "checkoutSession")!.args as {
      where: Row;
      data: Row;
    };
    expect(sessions.where).toMatchObject({ orderId: "order-1", status: "PENDING" });
    expect(sessions.data).toMatchObject({ status: "CANCELLED" });
    expect(scheduled[0]).toMatchObject({ templateKey: "QUOTE_UPDATED" });
  });

  it("pedido DRAFT sin reserva: actualiza totales sin liberar stock", async () => {
    const fake = makeFake({
      quote: { ...baseQuote, status: "ACCEPTED" },
      order: { id: "order-1", status: "DRAFT", currentRevisionId: "rev-1" },
      reservedLines: [],
    });
    const { service, released } = makeService(fake);
    const result = await service.update(TENANT, "quote-1", "user-1", { lines: newLines });
    expect(result.orderReset).toBe(true);
    expect(released).toHaveLength(0);
  });
});

/**
 * Hallazgo M7: el token del link público se generaba con `Math.random()`.
 * Es una credencial portadora sin sesión —expone datos del cliente y precios—
 * así que tiene que venir de un CSPRNG, igual que los CheckoutAccessToken.
 */
describe("token del link público de cotización", () => {
  function tokensFromWrites(fake: ReturnType<typeof makeFake>): string[] {
    return fake.writes
      .filter((w) => w.table === "quoteShareToken")
      .map((w) => ((w.args as { data: Row }).data.token as string));
  }

  it("no sale del alfabeto de 36 caracteres del PRNG anterior", async () => {
    const fake = makeFake({ quote: baseQuote, shares: 1 });
    const { service } = makeService(fake);
    await service.update(TENANT, "quote-1", "user-1", { lines: newLines });

    const [token] = tokensFromWrites(fake);
    expect(token).toBeTruthy();
    // base64url: incluye mayúsculas, que el alfabeto viejo (a-z0-9) no tenía.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token!.length).toBeGreaterThanOrEqual(32);
  });

  it("dos tokens seguidos no se repiten", async () => {
    const tokens: string[] = [];
    for (let i = 0; i < 25; i++) {
      const fake = makeFake({ quote: baseQuote, shares: 1 });
      const { service } = makeService(fake);
      await service.update(TENANT, "quote-1", "user-1", { lines: newLines });
      tokens.push(...tokensFromWrites(fake));
    }
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
