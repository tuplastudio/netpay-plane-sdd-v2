import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { OrderService } from "../src/orders/order.service.js";
import { QuoteService } from "../src/quotes/quote.service.js";
import { PaymentService } from "../src/payments/payment.service.js";
import { decideRefund } from "../src/payments/refund-math.js";
import type { PrismaService } from "../src/prisma/prisma.service.js";
import type { PricingService } from "../src/pricing/pricing.service.js";
import type { CustomerService } from "../src/customers/customer.service.js";
import type { NotificationService } from "../src/notifications/notification.service.js";

/**
 * Cotización → pedido → checkout → webhook de pago → reembolso, de punta a
 * punta sobre los servicios reales (QuoteService, OrderService,
 * PaymentService) y un Prisma en memoria que respeta lo que da las garantías:
 *
 *  - `Order.quoteId` único (una cotización, un pedido).
 *  - `CheckoutSession.externalId` único (el webhook busca por él).
 *  - `OrderTrackingToken.orderId` único (mint-once del link de seguimiento).
 *  - `updateMany` condicional por estado (idempotencia del webhook).
 *  - el UPDATE condicional de `refund()` (misma semántica que Postgres).
 *
 * Lo que se fija aquí es la LIGA entre entidades: que el pedido apunte a la
 * cotización, que la cotización quede aceptada, que la sesión apunte al
 * pedido, que el pago mueva el pedido, que el reembolso se refleje y que el
 * link de seguimiento sea el mismo en todos los avisos.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const CUSTOMER = "22222222-2222-2222-2222-222222222222";
const VARIANT = "33333333-3333-3333-3333-333333333333";
const ACTOR = "44444444-4444-4444-4444-444444444444";

const D = (v: string | number) => new Prisma.Decimal(v);

type Row = Record<string, unknown>;

class UniqueViolation extends Error {
  readonly code = "P2002";
  constructor(target: string) {
    super(`Unique constraint failed on the fields: (\`${target}\`)`);
  }
}

/** `where` de Prisma reducido a lo que usan los servicios bajo prueba. */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond === null || typeof cond !== "object" || cond instanceof Date || cond instanceof Prisma.Decimal) {
      return v === cond;
    }
    const c = cond as Record<string, unknown>;
    if ("in" in c) return (c.in as unknown[]).includes(v);
    if ("not" in c) {
      const n = c.not;
      if (n === null) return v !== null && v !== undefined;
      return v !== n;
    }
    if ("gt" in c) return (v as Date).getTime() > (c.gt as Date).getTime();
    if ("lt" in c) return (v as Date).getTime() < (c.lt as Date).getTime();
    if ("equals" in c) return v === c.equals;
    return false;
  });
}

/** Columnas Decimal(12,2): los servicios les llaman `.toFixed`/`.mul`, igual que con Prisma real. */
const MONEY = new Set(["subtotal", "discount", "taxBase", "tax", "shipping", "total", "amount", "refundedTotal"]);

function applyData(row: Row, data: Row): void {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as Row)) {
      row[k] = ((row[k] as number) ?? 0) + ((v as Row).increment as number);
    } else if (k !== "lines" && k !== "revisions") {
      row[k] = MONEY.has(k) && v != null && !(v instanceof Prisma.Decimal) ? D(v as string) : v;
    }
  }
}

class FakePrisma {
  private seq = 0;
  private nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, "0")}`;
  }

  quotes: Row[] = [];
  quoteLines: Row[] = [];
  orders: Row[] = [];
  revisions: Row[] = [];
  revisionLines: Row[] = [];
  sessions: Row[] = [];
  ledger: Row[] = [];
  audit: Row[] = [];
  trackingTokens: Row[] = [];
  accessTokens: Row[] = [];
  notifications: Array<{ templateKey: string; vars: Record<string, string> }> = [];

  tenantRow: Row = {
    id: TENANT,
    name: "Ferretería Aglos",
    logoUrl: null,
    primaryColor: "#0f172a",
    configVersion: 3,
    taxRatePct: D("16.00"),
    checkoutReservationMinutes: 15,
    quoteValidityHours: 168,
  };
  customerRow: Row = {
    id: CUSTOMER,
    tenantId: TENANT,
    fullName: "Ana Cliente",
    email: "ana@example.com",
    phone: "+5215512345678",
  };
  variantRow: Row = {
    id: VARIANT,
    tenantId: TENANT,
    sku: "TAL-01",
    title: "Taladro 500W",
    price: D("100.00"),
    product: { id: "prod-1", sku: "TAL", title: "Taladro", description: null, variants: [] },
  };

  // ---- relaciones ---------------------------------------------------------

  private withQuoteRelations(q: Row): Row {
    const order = this.orders.find((o) => o.quoteId === q.id) ?? null;
    return {
      ...q,
      customer: this.customerRow,
      tenant: this.tenantRow,
      lines: this.quoteLines.filter((l) => l.quoteId === q.id),
      order: order
        ? {
            ...order,
            payments: this.sessions
              .filter((s) => s.orderId === order.id)
              .map((s) => ({ id: s.id, status: s.status })),
          }
        : null,
      _count: { shares: 0 },
    };
  }

  private withOrderRelations(o: Row, include?: Row): Row {
    const revisions = this.revisions
      .filter((r) => r.orderId === o.id)
      .map((r) => ({ ...r, lines: this.revisionLines.filter((l) => l.revisionId === r.id) }));
    const out: Row = { ...o, revisions };
    if (include?.customer) out.customer = this.customerRow;
    if (include?.tenant) out.tenant = this.tenantRow;
    if (include?.payments) {
      const inc = include.payments as Row;
      out.payments = this.sessions
        .filter((s) => s.orderId === o.id && matches(s, inc.where as Row | undefined))
        .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
        .map((s) => ({ ...s, ledger: this.ledger.filter((l) => l.sessionId === s.id) }));
    }
    if (include?.quote) {
      const q = this.quotes.find((x) => x.id === o.quoteId);
      out.quote = q ? { id: q.id, status: q.status, issuedAt: q.issuedAt, acceptedAt: q.acceptedAt } : null;
    }
    if (include?.revisionsRel) {
      const cur = revisions.find((r) => r.id === o.currentRevisionId) ?? null;
      out.revisionsRel = cur;
    }
    return out;
  }

  // ---- modelos ------------------------------------------------------------

  tenant = { findUnique: async ({ where }: { where: { id: string } }) => (where.id === TENANT ? this.tenantRow : null) };
  customer = { findUnique: async () => this.customerRow };
  customerAddress = { findFirst: async () => null };
  whatsAppConnection = { findFirst: async () => ({ phoneNumber: "5215500000000@s.whatsapp.net" }) };
  productVariant = {
    findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.includes(VARIANT) ? [this.variantRow] : [],
  };
  quoteLine = {
    findMany: async ({ where }: { where: { quoteId: string } }) => this.quoteLines.filter((l) => l.quoteId === where.quoteId),
    deleteMany: async () => ({ count: 0 }),
  };
  quote = {
    findFirst: async ({ where }: { where: Row }) => {
      const q = this.quotes.find((x) => matches(x, where));
      return q ? this.withQuoteRelations(q) : null;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = this.quotes.filter((x) => matches(x, where));
      rows.forEach((r) => applyData(r, data));
      return { count: rows.length };
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const q = this.quotes.find((x) => x.id === where.id)!;
      applyData(q, data);
      return this.withQuoteRelations(q);
    },
  };
  order = {
    findFirst: async ({ where, include }: { where: Row; include?: Row }) => {
      const o = this.orders.find((x) => matches(x, where));
      return o ? this.withOrderRelations(o, include) : null;
    },
    findUnique: async ({ where, include }: { where: { id: string }; include?: Row }) => {
      const o = this.orders.find((x) => x.id === where.id);
      return o ? this.withOrderRelations(o, include) : null;
    },
    create: async ({ data }: { data: Row }) => {
      if (data.quoteId && this.orders.some((o) => o.quoteId === data.quoteId)) {
        throw new UniqueViolation("quoteId");
      }
      const now = new Date();
      const order: Row = {
        currentRevisionId: null,
        checkoutRevision: 0,
        version: 1,
        placedAt: null,
        paidAt: null,
        fulfilledAt: null,
        cancelledAt: null,
        expiresAt: null,
        description: null,
        requiresInvoice: false,
        invoiceStatus: "NONE",
        invoiceRfc: null,
        invoiceLegalName: null,
        invoicePostalCode: null,
        invoiceCfdiUse: null,
        invoiceNotes: null,
        createdAt: now,
        updatedAt: now,
        id: this.nextId("order"),
      };
      applyData(order, data);
      delete order.revisions;
      this.orders.push(order);
      const rev = (data.revisions as { create: Row } | undefined)?.create;
      if (rev) this.revisions.push({ ...rev, id: this.nextId("rev"), orderId: order.id, createdAt: now });
      return this.withOrderRelations(order);
    },
    update: async ({ where, data, include }: { where: { id: string }; data: Row; include?: Row }) => {
      const o = this.orders.find((x) => x.id === where.id)!;
      applyData(o, data);
      o.updatedAt = new Date();
      return this.withOrderRelations(o, include);
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = this.orders.filter((x) => matches(x, where));
      rows.forEach((r) => {
        applyData(r, data);
        r.updatedAt = new Date();
      });
      return { count: rows.length };
    },
  };
  orderRevision = {
    findMany: async ({ where }: { where: { orderId: string } }) =>
      this.revisions
        .filter((r) => r.orderId === where.orderId)
        .sort((a, b) => (b.revisionNumber as number) - (a.revisionNumber as number)),
    create: async ({ data }: { data: Row }) => {
      const rev: Row = { ...data, id: this.nextId("rev"), createdAt: new Date() };
      delete rev.lines;
      this.revisions.push(rev);
      for (const l of (data.lines as { create: Row[] }).create) {
        this.revisionLines.push({ ...l, id: this.nextId("rl"), revisionId: rev.id, quantity: D(l.quantity as string) });
      }
      return rev;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const r = this.revisions.find((x) => x.id === where.id)!;
      applyData(r, data);
      return r;
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const r = this.revisions.find((x) => x.id === where.id);
      return r ? { ...r, lines: this.revisionLines.filter((l) => l.revisionId === r.id) } : null;
    },
  };
  orderRevisionLine = {
    findMany: async ({ where }: { where: { revisionId: string } }) =>
      this.revisionLines.filter((l) => l.revisionId === where.revisionId),
  };
  checkoutSession = {
    create: async ({ data }: { data: Row }) => {
      if (data.externalId && this.sessions.some((s) => s.externalId === data.externalId)) {
        throw new UniqueViolation("externalId");
      }
      const now = new Date();
      const s: Row = {
        refundedTotal: D("0.00"),
        currency: "MXN",
        livemode: false,
        version: 1,
        failedAt: null,
        paymentMethod: null,
        createdAt: now,
        updatedAt: now,
        ...data,
        amount: D(data.amount as string),
        id: this.nextId("sess"),
      };
      this.sessions.push(s);
      return s;
    },
    findFirst: async ({ where }: { where: Row }) => {
      const rows = this.sessions.filter((s) => matches(s, where));
      rows.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      return rows[0] ?? null;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = this.sessions.filter((s) => matches(s, where));
      rows.forEach((r) => applyData(r, data));
      return { count: rows.length };
    },
  };
  ledgerEntry = {
    create: async ({ data }: { data: Row }) => {
      const row = { ...data, id: this.nextId("led"), recordedAt: new Date() };
      this.ledger.push(row);
      return row;
    },
    findFirst: async ({ where }: { where: Row }) => this.ledger.find((l) => matches(l, where)) ?? null,
  };
  auditLog = {
    create: async ({ data }: { data: Row }) => {
      this.audit.push(data);
      return data;
    },
  };
  orderTrackingToken = {
    findUnique: async ({ where }: { where: { orderId?: string; token?: string } }) => {
      const t = this.trackingTokens.find((x) =>
        where.orderId ? x.orderId === where.orderId : x.token === where.token,
      );
      if (!t) return null;
      const o = this.orders.find((x) => x.id === t.orderId)!;
      return {
        ...t,
        order: this.withOrderRelations(o, {
          customer: true,
          tenant: true,
          revisionsRel: true,
          payments: { where: { status: { not: "CANCELLED" } } },
        }),
      };
    },
    create: async ({ data }: { data: Row }) => {
      if (this.trackingTokens.some((t) => t.orderId === data.orderId)) throw new UniqueViolation("orderId");
      const row = { ...data, id: this.nextId("trk"), createdAt: new Date() };
      this.trackingTokens.push(row);
      return row;
    },
  };
  checkoutAccessToken = {
    findFirst: async ({ where }: { where: Row }) => this.accessTokens.find((t) => matches(t, where)) ?? null,
  };

  /** Mismo UPDATE condicional que Postgres (ver refund.test.ts). */
  $queryRaw = async (sql: Prisma.Sql) => {
    const [money, , sessionId, tenantId] = sql.values as string[];
    const s = this.sessions.find((x) => x.id === sessionId && x.tenantId === tenantId);
    if (!s) return [];
    const decision = decideRefund({
      status: s.status as string,
      amount: s.amount as Prisma.Decimal,
      refundedTotal: s.refundedTotal as Prisma.Decimal,
      refund: D(money),
    });
    if (!decision.ok) return [];
    s.refundedTotal = decision.refundedTotal;
    s.status = decision.status;
    return [{ id: s.id, orderId: s.orderId, amount: s.amount, refundedTotal: s.refundedTotal, status: s.status }];
  };

  $transaction = async <T>(arg: ((tx: FakePrisma) => Promise<T>) | Promise<unknown>[]): Promise<T> =>
    Array.isArray(arg) ? ((await Promise.all(arg)) as unknown as T) : arg(this);
}

function makeServices(prisma: FakePrisma) {
  const notifications = {
    scheduleFromTemplate: async (input: { templateKey: string; vars: Record<string, string> }) => {
      prisma.notifications.push({ templateKey: input.templateKey, vars: input.vars });
      return {};
    },
  } as unknown as NotificationService;
  const pricing = {
    price: async (_t: string, lines: Array<{ variantId: string; quantity: string }>) => {
      const subtotal = lines.reduce((acc, l) => acc + 100 * Number(l.quantity), 0);
      const tax = Math.round(subtotal * 16) / 100;
      return {
        totals: {
          subtotal: subtotal.toFixed(2),
          discount: "0.00",
          taxBase: subtotal.toFixed(2),
          tax: tax.toFixed(2),
          shipping: "0.00",
          total: (subtotal + tax).toFixed(2),
        },
        lines: lines.map((l) => ({
          variantId: l.variantId,
          sku: "TAL-01",
          title: "Taladro 500W",
          quantity: l.quantity,
          unitPrice: "100.00",
          discountPct: 0,
          lineSubtotal: (100 * Number(l.quantity)).toFixed(2),
          satProductCode: "27111500",
          satUnitCode: "H87",
        })),
      };
    },
    reserveStock: async () => ({ reserved: true as const }),
    releaseStock: async () => undefined,
  } as unknown as PricingService;
  const customers = { assertAccess: async () => undefined } as unknown as CustomerService;
  const p = prisma as unknown as PrismaService;
  const quotes = new QuoteService(p, pricing, customers, notifications);
  const orders = new OrderService(p, pricing, customers, quotes, notifications);
  const payments = new PaymentService(p, notifications);
  return { quotes, orders, payments };
}

function seedIssuedQuote(prisma: FakePrisma, status = "ISSUED"): string {
  const id = "quote-0001";
  const now = new Date();
  prisma.quotes.push({
    id,
    tenantId: TENANT,
    customerId: CUSTOMER,
    status,
    configVersion: 3,
    subtotal: D("200.00"),
    discount: D("0.00"),
    taxBase: D("200.00"),
    tax: D("32.00"),
    shipping: D("0.00"),
    total: D("232.00"),
    notes: null,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 7 * 24 * 3_600_000),
    acceptedAt: status === "ACCEPTED" ? now : null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  prisma.quoteLines.push({
    id: "ql-0001",
    quoteId: id,
    variantId: VARIANT,
    sku: "TAL-01",
    title: "Taladro 500W",
    quantity: D("2.000"),
    unitPrice: D("100.00"),
    discountPct: D("0.00"),
    lineSubtotal: D("200.00"),
    satProductCode: "27111500",
    satUnitCode: "H87",
  });
  return id;
}

function signedWebhook(body: Row): [string, string] {
  const raw = JSON.stringify(body);
  return [raw, createHmac("sha256", "dev-webhook-secret").update(raw).digest("hex")];
}

describe("cotización → pedido → checkout → webhook → reembolso", () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof makeServices>;
  let quoteId: string;

  beforeEach(() => {
    prisma = new FakePrisma();
    svc = makeServices(prisma);
    quoteId = seedIssuedQuote(prisma);
    delete process.env.DUMMY_WEBHOOK_SECRET_REF;
    delete process.env.DUMMY_WEBHOOK_SECRET;
    process.env.PUBLIC_BASE_URL = "https://portal.test";
    // Pasarela dummy: crear sesión devuelve id externo + hosted URL.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/checkout/sessions")) {
          return new Response(
            JSON.stringify({
              data: {
                id: "a".repeat(32),
                hostedUrl: `/checkout/${"a".repeat(32)}/hosted`,
                expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
              },
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function runToPaid() {
    const order = await svc.orders.createFromQuote(TENANT, quoteId, ACTOR);
    const lines = [{ variantId: VARIANT, quantity: "2.000", discountPct: 0 }];
    const opened = await svc.orders.startCheckout(TENANT, order.id, { lines, deliveryMode: "PICKUP" });
    const session = await svc.payments.createCheckout({
      tenantId: TENANT,
      orderId: order.id,
      expectedOrderVersion: opened.version as number,
      amount: opened.total.toFixed(2),
    });
    const [raw, sig] = signedWebhook({
      eventName: "payment.captured",
      status: "CAPTURED",
      sessionId: "a".repeat(32),
      orderId: order.id,
      amount: "232.00",
      paymentMethod: "CARD",
      card: { brand: "visa", last4: "4242" },
    });
    await svc.payments.handleWebhook(raw, sig);
    return { order, session, raw, sig };
  }

  it("el pedido apunta a la cotización y la cotización queda aceptada", async () => {
    const order = await svc.orders.createFromQuote(TENANT, quoteId, ACTOR);

    expect(order.quoteId).toBe(quoteId);
    expect(order.source).toBe("QUOTE");
    expect(order.status).toBe("DRAFT");
    expect(order.total.toFixed(2)).toBe("232.00");

    const quote = await svc.quotes.get(TENANT, quoteId);
    expect(quote.status).toBe("ACCEPTED");
    expect(quote.acceptedAt).toBeInstanceOf(Date);
    expect(quote.order?.id).toBe(order.id);

    // Idempotente: repetir la aceptación devuelve el mismo pedido.
    const again = await svc.orders.createFromQuote(TENANT, quoteId, ACTOR);
    expect(again.id).toBe(order.id);
    expect(prisma.orders).toHaveLength(1);
  });

  it("dos aceptaciones simultáneas dejan UN pedido (índice único de quoteId)", async () => {
    const [a, b] = await Promise.all([
      svc.orders.createFromQuote(TENANT, quoteId, ACTOR),
      svc.orders.createFromQuote(TENANT, quoteId, ACTOR),
    ]);
    expect(a.id).toBe(b.id);
    expect(prisma.orders).toHaveLength(1);
  });

  it("una cotización ACCEPTED sin pedido (aceptación a medias) sí se convierte", async () => {
    prisma = new FakePrisma();
    svc = makeServices(prisma);
    quoteId = seedIssuedQuote(prisma, "ACCEPTED");

    const order = await svc.orders.createFromQuote(TENANT, quoteId, ACTOR);
    expect(order.quoteId).toBe(quoteId);
    expect((await svc.quotes.get(TENANT, quoteId)).status).toBe("ACCEPTED");
  });

  it("el aviso de pedido recibido lleva el link de seguimiento", async () => {
    const order = await svc.orders.createFromQuote(TENANT, quoteId, ACTOR);
    const received = prisma.notifications.find((n) => n.templateKey === "ORDER_RECEIVED");
    expect(received).toBeDefined();
    const token = prisma.trackingTokens.find((t) => t.orderId === order.id)?.token as string;
    expect(token).toBeTruthy();
    expect(received!.vars.link).toBe(`https://portal.test/orders/public/track/${token}`);
  });

  it("checkout + webhook CAPTURED: sesión → pedido → cotización quedan ligados y pagados", async () => {
    const { order, session } = await runToPaid();

    const s = prisma.sessions.find((x) => x.id === session.sessionId)!;
    expect(s.orderId).toBe(order.id);
    expect(s.externalId).toBe("a".repeat(32));
    expect(s.status).toBe("CAPTURED");
    expect(s.paymentMethod).toBe("CARD");
    expect(s.capturedAt).toBeInstanceOf(Date);

    const charges = prisma.ledger.filter((l) => l.sessionId === s.id && l.entryType === "CHARGE");
    expect(charges).toHaveLength(1);
    expect(charges[0]!.amount).toBe("232.00");

    const o = prisma.orders.find((x) => x.id === order.id)!;
    expect(o.status).toBe("PAID");
    expect(o.paidAt).toBeInstanceOf(Date);
    expect(o.quoteId).toBe(quoteId);

    // La cotización ve su pedido pagado y deja de ser editable.
    const quote = await svc.quotes.get(TENANT, quoteId);
    expect(quote.order?.status).toBe("PAID");
    expect(quote.editable).toBe(false);

    // El aviso de pago trae el MISMO link de seguimiento que el de "recibido".
    const paid = prisma.notifications.find((n) => n.templateKey === "PAYMENT_SIMULATED_SUCCESS");
    const received = prisma.notifications.find((n) => n.templateKey === "ORDER_RECEIVED");
    expect(paid?.vars.link).toBe(received?.vars.link);
    expect(prisma.trackingTokens).toHaveLength(1);
  });

  it("el webhook repetido no asienta un segundo cargo ni manda otro aviso", async () => {
    const { raw, sig } = await runToPaid();
    const chargesBefore = prisma.ledger.filter((l) => l.entryType === "CHARGE").length;
    const notifsBefore = prisma.notifications.length;

    await svc.payments.handleWebhook(raw, sig);

    expect(prisma.ledger.filter((l) => l.entryType === "CHARGE")).toHaveLength(chargesBefore);
    expect(prisma.notifications).toHaveLength(notifsBefore);
    expect(prisma.orders[0]!.status).toBe("PAID");
  });

  it("un webhook con firma inválida se rechaza sin tocar nada", async () => {
    const order = await svc.orders.createFromQuote(TENANT, quoteId, ACTOR);
    const [raw] = signedWebhook({ sessionId: "a".repeat(32), orderId: order.id, status: "CAPTURED" });
    await expect(svc.payments.handleWebhook(raw, "00".repeat(32))).rejects.toMatchObject({
      response: { code: "VALIDATION_FAILED" },
    });
    expect(prisma.orders[0]!.status).toBe("DRAFT");
  });

  it("reembolso parcial deja el pedido PAID; total lo pasa a REFUNDED", async () => {
    const { order, session } = await runToPaid();

    const partial = await svc.payments.refund(TENANT, session.sessionId, "32.00", "ajuste");
    expect(partial.status).toBe("PARTIALLY_REFUNDED");
    expect(prisma.orders.find((o) => o.id === order.id)!.status).toBe("PAID");

    const full = await svc.payments.refund(TENANT, session.sessionId, "200.00", "devolución");
    expect(full.status).toBe("REFUNDED");
    expect(full.refundedTotal).toBe("232.00");
    expect(prisma.orders.find((o) => o.id === order.id)!.status).toBe("REFUNDED");
    expect(prisma.ledger.filter((l) => l.entryType === "REFUND")).toHaveLength(2);
  });

  it("el link público de seguimiento resume estado, pago y líneas sin ids internos", async () => {
    const { order } = await runToPaid();
    const token = prisma.trackingTokens.find((t) => t.orderId === order.id)!.token as string;

    const view = await svc.orders.resolveTrackingToken(token);
    expect(view).not.toBeNull();
    expect(view!.folio).toBe(order.id.slice(0, 8).toUpperCase());
    expect(view).not.toHaveProperty("id");
    expect(view).not.toHaveProperty("tenantId");
    expect(view!.status).toBe("PAID");
    expect(view!.total).toBe("232.00");
    expect(view!.merchant.name).toBe("Ferretería Aglos");
    expect(view!.customer).toEqual({ fullName: "Ana Cliente" });
    expect(view!.delivery?.mode).toBe("PICKUP");
    expect(view!.payment.lastStatus).toBe("CAPTURED");
    expect(view!.payment.method).toBe("CARD");
    expect(view!.payment.refundedTotal).toBe("0.00");
    expect(view!.payment.checkoutToken).toBeNull();
    expect(view!.lines).toHaveLength(1);
    // Precio pactado en la cotización, no el del catálogo.
    expect(view!.lines[0]).toMatchObject({ title: "Taladro — Taladro 500W", quantity: "2", unitPrice: "100.00", lineTotal: "200.00" });
    expect(view!.timeline.paidAt).toBeInstanceOf(Date);

    await svc.payments.refund(TENANT, prisma.sessions[0]!.id as string, "232.00", "devolución");
    const after = await svc.orders.resolveTrackingToken(token);
    expect(after!.status).toBe("REFUNDED");
    expect(after!.payment.refundedTotal).toBe("232.00");

    expect(await svc.orders.resolveTrackingToken("no-existe")).toBeNull();
  });

  it("pendiente de pago: el seguimiento expone el link de checkout vigente", async () => {
    const order = await svc.orders.createFromQuote(TENANT, quoteId, ACTOR);
    const opened = await svc.orders.startCheckout(TENANT, order.id, {
      lines: [{ variantId: VARIANT, quantity: "2.000", discountPct: 0 }],
      deliveryMode: "PICKUP",
    });
    prisma.accessTokens.push({
      revisionId: opened.currentRevisionId,
      token: "chk-token",
      usedAt: null,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const token = prisma.trackingTokens[0]!.token as string;
    const view = await svc.orders.resolveTrackingToken(token);
    expect(view!.status).toBe("CHECKOUT_OPEN");
    expect(view!.payment.checkoutToken).toBe("chk-token");
  });
});
