import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  PaymentService,
  dummyServiceKey,
  enabledPaymentMethods,
} from "../src/payments/payment.service.js";
import { isAllowedDummyProxyPath } from "../src/payments/payment.controller.js";

/**
 * Métodos de pago (CARD | SPEI | OXXO) de punta a punta dentro del API:
 * qué se le pide al gateway, qué se persiste cuando el webhook confirma y
 * qué rutas del gateway se dejan pasar al navegador. Prisma es un fake.
 */

const SECRET = "test-webhook-secret";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PAYMENT_METHODS;
  delete process.env.DUMMY_SERVICE_KEY_REF;
  delete process.env.DUMMY_SERVICE_KEY;
  delete process.env.DUMMY_WEBHOOK_SECRET_REF;
});

describe("enabledPaymentMethods", () => {
  it("habilita los tres métodos sin PAYMENT_METHODS", () => {
    expect(enabledPaymentMethods(undefined)).toEqual(["CARD", "SPEI", "OXXO"]);
    expect(enabledPaymentMethods("")).toEqual(["CARD", "SPEI", "OXXO"]);
  });

  it("acota a la lista configurada, ignorando basura y duplicados", () => {
    expect(enabledPaymentMethods(" spei, CARD ,card,paypal")).toEqual(["SPEI", "CARD"]);
  });

  it("si nada de la lista es válido vuelve al default en vez de dejar el checkout sin métodos", () => {
    expect(enabledPaymentMethods("paypal")).toEqual(["CARD", "SPEI", "OXXO"]);
  });
});

describe("dummyServiceKey", () => {
  it("lee la convención _REF del .env antes que el literal de pruebas", () => {
    process.env.DUMMY_SERVICE_KEY_REF = "npk_real";
    expect(dummyServiceKey()).toBe("npk_real");
    delete process.env.DUMMY_SERVICE_KEY_REF;
    expect(dummyServiceKey()).toBe("npk_test_local");
  });
});

describe("isAllowedDummyProxyPath", () => {
  const id = "a".repeat(32);
  it("deja pasar solo lo que usa la página hosted", () => {
    expect(isAllowedDummyProxyPath("GET", `/checkout/${id}/hosted`)).toBe(true);
    expect(isAllowedDummyProxyPath("HEAD", `/checkout/${id}/hosted`)).toBe(true);
    expect(isAllowedDummyProxyPath("POST", `/checkout/sessions/${id}/capture`)).toBe(true);
    expect(isAllowedDummyProxyPath("POST", `/checkout/sessions/${id}/fail`)).toBe(true);
  });
  it("bloquea crear/leer sesiones y cualquier otra ruta del gateway", () => {
    expect(isAllowedDummyProxyPath("POST", "/checkout/sessions")).toBe(false);
    expect(isAllowedDummyProxyPath("GET", `/checkout/sessions/${id}`)).toBe(false);
    expect(isAllowedDummyProxyPath("GET", "/healthz")).toBe(false);
    expect(isAllowedDummyProxyPath("GET", `/checkout/${id}/hosted/../../healthz`)).toBe(false);
    expect(isAllowedDummyProxyPath("DELETE", `/checkout/${id}/hosted`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createCheckout: qué se le manda al gateway
// ---------------------------------------------------------------------------

function fakePrismaForCreate() {
  const order = {
    id: "order-1",
    tenantId: "t1",
    version: 3,
    currentRevisionId: "rev-1",
    description: null,
    requiresInvoice: false,
    subtotal: new Prisma.Decimal("100.00"),
    discount: new Prisma.Decimal("0.00"),
    tax: new Prisma.Decimal("16.00"),
    shipping: new Prisma.Decimal("0.00"),
    total: new Prisma.Decimal("116.00"),
    tenant: { name: "Tienda Demo" },
    customer: { fullName: "Ana", email: "ana@x.mx" },
    revisions: [{ id: "rev-1", deliveryMode: "PICKUP", lines: [] }],
  };
  const sessions: Array<Record<string, unknown>> = [];
  return {
    sessions,
    order: {
      findFirst: async () => order,
      update: async () => order,
    },
    orderRevision: { findUnique: async () => null },
    productVariant: { findMany: async () => [] },
    checkoutAccessToken: { findFirst: async () => ({ token: "tok123" }) },
    checkoutSession: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "sess-1", ...data };
        sessions.push(row);
        return row;
      },
    },
  };
}

describe("PaymentService.createCheckout", () => {
  it("manda al gateway los métodos habilitados y arma el checkoutUrl con DUMMY_PUBLIC_URL", async () => {
    process.env.PAYMENT_METHODS = "CARD,SPEI";
    process.env.DUMMY_SERVICE_KEY_REF = "npk_real";
    process.env.DUMMY_BASE_URL = "http://dummy-gateway:4100";
    process.env.DUMMY_PUBLIC_URL = "https://easysell.web.tupla.dev/pay/";
    process.env.API_SELF_URL = "http://commerce-api:4000";
    process.env.PUBLIC_BASE_URL = "https://easysell.web.tupla.dev";

    const calls: Array<{ url: string; body: Record<string, unknown>; auth: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
          auth: (init.headers as Record<string, string>).authorization,
        });
        return new Response(
          JSON.stringify({
            data: { id: "deadbeef", hostedUrl: "/checkout/deadbeef/hosted", expiresAt: new Date().toISOString() },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const prisma = fakePrismaForCreate();
    const service = new PaymentService(prisma as never, { scheduleFromTemplate: async () => undefined } as never);
    const result = await service.createCheckout({
      tenantId: "t1",
      orderId: "order-1",
      expectedOrderVersion: 0,
      amount: "116.00",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://dummy-gateway:4100/checkout/sessions");
    expect(calls[0]!.auth).toBe("Bearer npk_real");
    expect(calls[0]!.body.paymentMethods).toEqual(["CARD", "SPEI"]);
    expect(calls[0]!.body.webhookUrl).toBe("http://commerce-api:4000/api/v1/payments/webhook");
    expect(calls[0]!.body.successUrl).toBe("https://easysell.web.tupla.dev/checkout/tok123/gracias");
    // Sin doble barra aunque DUMMY_PUBLIC_URL termine en "/".
    expect(result.checkoutUrl).toBe("https://easysell.web.tupla.dev/pay/checkout/deadbeef/hosted");
    expect(result.paymentMethods).toEqual(["CARD", "SPEI"]);

    delete process.env.DUMMY_BASE_URL;
    delete process.env.DUMMY_PUBLIC_URL;
    delete process.env.API_SELF_URL;
    delete process.env.PUBLIC_BASE_URL;
  });
});

// ---------------------------------------------------------------------------
// handleWebhook: qué se persiste cuando el gateway confirma
// ---------------------------------------------------------------------------

function fakePrismaForWebhook() {
  const order = {
    id: "order-1",
    tenantId: "t1",
    status: "AWAITING_PAYMENT",
    requiresInvoice: false,
    invoiceStatus: "NONE",
    invoiceRfc: null,
    invoiceLegalName: null,
    invoicePostalCode: null,
    invoiceCfdiUse: null,
    invoiceNotes: null,
    customerId: "c1",
    customer: { fullName: "Ana", email: null, phone: null },
  };
  const session = {
    id: "sess-1",
    tenantId: "t1",
    orderId: "order-1",
    status: "PENDING",
    amount: new Prisma.Decimal("116.00"),
    refundedTotal: new Prisma.Decimal("0.00"),
  };
  const writes: { session: Record<string, unknown>[]; ledger: Record<string, unknown>[]; order: Record<string, unknown>[] } = {
    session: [],
    ledger: [],
    order: [],
  };
  const tx = {
    checkoutSession: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.session.push(data);
        return { ...session, ...data };
      },
    },
    ledgerEntry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.ledger.push(data);
        return data;
      },
    },
    order: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.order.push(data);
        return { ...order, ...data };
      },
    },
  };
  const prisma = {
    writes,
    order: {
      findFirst: async () => order,
      findUnique: async () => order,
    },
    checkoutSession: {
      findFirst: async ({ where }: { where: { status?: string } }) =>
        where.status === "PENDING" ? session : null,
      update: tx.checkoutSession.update,
    },
    $transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
  };
  return prisma;
}

function signed(payload: Record<string, unknown>) {
  const raw = JSON.stringify(payload);
  return { raw, signature: createHmac("sha256", SECRET).update(raw).digest("hex") };
}

describe("PaymentService.handleWebhook · método de pago", () => {
  it("guarda SPEI en la sesión y nombra el método y la referencia en el ledger", async () => {
    process.env.DUMMY_WEBHOOK_SECRET_REF = SECRET;
    const prisma = fakePrismaForWebhook();
    const service = new PaymentService(prisma as never, { scheduleFromTemplate: async () => undefined } as never);
    const { raw, signature } = signed({
      sessionId: "deadbeef",
      orderId: "order-1",
      status: "CAPTURED",
      amount: "116.00",
      paymentMethod: "SPEI",
      paymentReference: "123456789012345678",
    });
    await service.handleWebhook(raw, signature);

    expect(prisma.writes.session[0]).toMatchObject({ status: "CAPTURED", paymentMethod: "SPEI" });
    expect(prisma.writes.ledger[0]!.description).toContain("Transferencia SPEI");
    expect(prisma.writes.ledger[0]!.description).toContain("ref 12345678901234");
    expect(prisma.writes.order[0]).toMatchObject({ status: "PAID" });
  });

  it("un webhook con tarjeta (sin paymentMethod explícito) queda como CARD", async () => {
    process.env.DUMMY_WEBHOOK_SECRET_REF = SECRET;
    const prisma = fakePrismaForWebhook();
    const service = new PaymentService(prisma as never, { scheduleFromTemplate: async () => undefined } as never);
    const { raw, signature } = signed({
      sessionId: "deadbeef",
      orderId: "order-1",
      status: "CAPTURED",
      card: { brand: "visa", last4: "4242" },
    });
    await service.handleWebhook(raw, signature);
    expect(prisma.writes.session[0]).toMatchObject({ paymentMethod: "CARD" });
    expect(prisma.writes.ledger[0]!.description).toContain("Visa •••• 4242");
  });

  it("ignora un método desconocido en vez de persistir basura", async () => {
    process.env.DUMMY_WEBHOOK_SECRET_REF = SECRET;
    const prisma = fakePrismaForWebhook();
    const service = new PaymentService(prisma as never, { scheduleFromTemplate: async () => undefined } as never);
    const { raw, signature } = signed({
      sessionId: "deadbeef",
      orderId: "order-1",
      status: "FAILED",
      paymentMethod: "BITCOIN",
    });
    await service.handleWebhook(raw, signature);
    expect(prisma.writes.session[0]).toMatchObject({ status: "FAILED" });
    expect(prisma.writes.session[0]).not.toHaveProperty("paymentMethod");
  });
});
