import { describe, expect, it, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { CheckoutStore } from "../src/checkout.store.js";
import { WebhookDispatcher } from "../src/webhook.dispatcher.js";

/**
 * El gateway dummy no mueve dinero, pero sí debe comportarse como una pasarela:
 * sesiones con expiración, transiciones versionadas y webhooks firmados.
 */

describe("CheckoutStore", () => {
  it("crea sesiones PENDING con livemode false y expiración", () => {
    const store = new CheckoutStore();
    const session = store.create({
      amount: "199.99",
      currency: "MXN",
      orderId: "order-1",
      serviceApiKey: "svc-key",
    });

    expect(session.status).toBe("PENDING");
    expect(session.livemode).toBe(false);
    expect(session.version).toBe(1);
    expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("versiona cada cambio de estado", () => {
    const store = new CheckoutStore();
    const created = store.create({
      amount: "100.00",
      currency: "MXN",
      orderId: "order-2",
      serviceApiKey: "svc-key",
    });

    const captured = store.setStatus(created.id, "CAPTURED");
    expect(captured?.status).toBe("CAPTURED");
    expect(captured?.version).toBe(2);
    expect(store.get(created.id)?.status).toBe("CAPTURED");
  });

  it("no encuentra sesiones inexistentes", () => {
    const store = new CheckoutStore();
    expect(store.get("no-existe")).toBeUndefined();
    expect(store.setStatus("no-existe", "CAPTURED")).toBeUndefined();
  });
});

describe("WebhookDispatcher", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("firma el cuerpo exacto que envía", async () => {
    const calls: Array<{ body: string; signature: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        calls.push({ body: String(init.body), signature: headers["x-dummy-signature"] });
        return { ok: true, status: 200 } as Response;
      }),
    );

    const store = new CheckoutStore();
    const session = store.create({
      amount: "165.00",
      currency: "MXN",
      orderId: "order-3",
      serviceApiKey: "svc-key",
    });
    const captured = store.setStatus(session.id, "CAPTURED")!;

    await new WebhookDispatcher().dispatch(
      "http://localhost:4000/api/v1/payments/webhook",
      captured,
      "secreto",
    );

    expect(calls).toHaveLength(1);
    const expected = createHmac("sha256", "secreto").update(calls[0].body).digest("hex");
    expect(calls[0].signature).toBe(expected);

    const payload = JSON.parse(calls[0].body);
    expect(payload.eventName).toBe("payment.captured");
    expect(payload.livemode).toBe(false);
    expect(payload.orderId).toBe("order-3");
  });

  it("no propaga el error si el destino falla", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection refused");
    }));

    const store = new CheckoutStore();
    const session = store.create({
      amount: "10.00",
      currency: "MXN",
      orderId: "order-4",
      serviceApiKey: "svc-key",
    });

    await expect(
      new WebhookDispatcher().dispatch("http://localhost:9/none", session, "secreto"),
    ).resolves.toBeUndefined();
  });
});
