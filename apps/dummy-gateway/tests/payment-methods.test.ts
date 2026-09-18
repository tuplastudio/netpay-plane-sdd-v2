import { describe, expect, it } from "vitest";
import { CheckoutStore, PAYMENT_METHODS, paymentReferenceFor } from "../src/checkout.store.js";
import { CheckoutController } from "../src/checkout.controller.js";
import { WebhookDispatcher } from "../src/webhook.dispatcher.js";
import { oxxoReference, renderHostedCheckout, renderHostedSuccess, speiClabe } from "../src/hosted-page.js";

/**
 * Métodos de pago del gateway: tarjeta (inmediato) y SPEI/OXXO (diferidos con
 * referencia). El comercio decide cuáles acepta por sesión; el gateway
 * rechaza capturas con un método fuera de esa lista.
 */

function makeController(store = new CheckoutStore()) {
  const dispatcher = new WebhookDispatcher();
  return { store, controller: new CheckoutController(store, dispatcher) };
}

describe("CheckoutStore · métodos de pago", () => {
  it("habilita todos los métodos cuando el caller no manda ninguno", () => {
    const store = new CheckoutStore();
    const s = store.create({ amount: "10.00", currency: "MXN", orderId: "o1", serviceApiKey: "k" });
    expect(s.paymentMethods).toEqual([...PAYMENT_METHODS]);
    expect(s.paymentReference).toMatch(/^\d{18}$/);
    expect(s.paymentReference).toBe(paymentReferenceFor(s.id));
  });

  it("respeta la lista del comercio y descarta valores desconocidos", () => {
    const store = new CheckoutStore();
    const s = store.create({
      amount: "10.00",
      currency: "MXN",
      orderId: "o1",
      serviceApiKey: "k",
      paymentMethods: ["SPEI", "PAYPAL" as never],
    });
    expect(s.paymentMethods).toEqual(["SPEI"]);
  });

  it("recuerda el método con el que se cobró", () => {
    const store = new CheckoutStore();
    const s = store.create({ amount: "10.00", currency: "MXN", orderId: "o1", serviceApiKey: "k" });
    store.setStatus(s.id, "CAPTURED", { paymentMethod: "OXXO" });
    expect(store.get(s.id)?.paymentMethod).toBe("OXXO");
  });
});

describe("CheckoutController · captura por método", () => {
  it("captura por SPEI sin datos de tarjeta y lo manda en el webhook", async () => {
    const { store, controller } = makeController();
    const s = store.create({ amount: "10.00", currency: "MXN", orderId: "o1", serviceApiKey: "k" });
    const res = await controller.capture(s.id, { paymentMethod: "SPEI", email: "c@x.mx" });
    expect(res.data.status).toBe("CAPTURED");
    expect(store.get(s.id)?.paymentMethod).toBe("SPEI");
    expect(store.get(s.id)?.card).toBeUndefined();
  });

  it("asume tarjeta cuando no viene método (contrato original)", async () => {
    const { store, controller } = makeController();
    const s = store.create({ amount: "10.00", currency: "MXN", orderId: "o1", serviceApiKey: "k" });
    await controller.capture(s.id, {});
    expect(store.get(s.id)?.paymentMethod).toBe("CARD");
  });

  it("rechaza un método que el comercio no habilitó", async () => {
    const { store, controller } = makeController();
    const s = store.create({
      amount: "10.00",
      currency: "MXN",
      orderId: "o1",
      serviceApiKey: "k",
      paymentMethods: ["CARD"],
    });
    await expect(controller.capture(s.id, { paymentMethod: "OXXO" })).rejects.toMatchObject({
      response: { code: "RULE_VIOLATION" },
    });
    expect(store.get(s.id)?.status).toBe("PENDING");
  });

  it("rechaza un método desconocido", async () => {
    const { store, controller } = makeController();
    const s = store.create({ amount: "10.00", currency: "MXN", orderId: "o1", serviceApiKey: "k" });
    await expect(controller.capture(s.id, { paymentMethod: "BITCOIN" })).rejects.toMatchObject({
      response: { code: "VALIDATION_FAILED" },
    });
  });

  it("exige la service key configurada cuando existe DUMMY_SERVICE_KEY_REF", async () => {
    const previous = process.env.DUMMY_SERVICE_KEY_REF;
    process.env.DUMMY_SERVICE_KEY_REF = "npk_prod_secret";
    try {
      const { controller } = makeController();
      const body = { amount: "1.00", currency: "MXN" as const, orderId: "o1" };
      await expect(controller.create(body, "Bearer otra")).rejects.toMatchObject({
        response: { code: "UNAUTHORIZED" },
      });
      const ok = await controller.create(body, "Bearer npk_prod_secret");
      expect(ok.data.paymentMethods).toEqual([...PAYMENT_METHODS]);
    } finally {
      if (previous === undefined) delete process.env.DUMMY_SERVICE_KEY_REF;
      else process.env.DUMMY_SERVICE_KEY_REF = previous;
    }
  });
});

describe("hosted page", () => {
  it("arma las llamadas relativas al prefijo desde el que se sirve", () => {
    const store = new CheckoutStore();
    const s = store.create({ amount: "10.00", currency: "MXN", orderId: "o1", serviceApiKey: "k" });
    const html = renderHostedCheckout(s);
    // Nunca rutas absolutas desde la raíz: detrás de /pay rompen.
    expect(html).not.toContain("fetch('/checkout/");
    expect(html).not.toContain("replace('/checkout/");
    expect(html).toContain("BASE + '/checkout/sessions/'");
    expect(html).toContain("window.location.pathname.replace(");
  });

  it("muestra el selector solo cuando hay más de un método", () => {
    const store = new CheckoutStore();
    const multi = store.create({ amount: "10.00", currency: "MXN", orderId: "o1", serviceApiKey: "k" });
    const single = store.create({
      amount: "10.00",
      currency: "MXN",
      orderId: "o2",
      serviceApiKey: "k",
      paymentMethods: ["SPEI"],
    });
    expect(renderHostedCheckout(multi)).toContain('role="tablist"');
    expect(renderHostedCheckout(multi)).toContain("Transferencia SPEI");
    expect(renderHostedCheckout(single)).not.toContain('role="tablist"');
    expect(renderHostedCheckout(single)).toContain("Pagar por transferencia");
  });

  it("deriva CLABE y referencia OXXO estables de la referencia de la sesión", () => {
    const ref = "123456789012345678";
    expect(speiClabe(ref)).toBe("646180123456789012");
    expect(oxxoReference(ref)).toBe("1234-5678-9012-34");
  });

  it("el comprobante nombra el método diferido con su referencia", () => {
    const store = new CheckoutStore();
    const s = store.create({ amount: "10.00", currency: "MXN", orderId: "o1", serviceApiKey: "k" });
    store.setStatus(s.id, "CAPTURED", { paymentMethod: "OXXO" });
    const html = renderHostedSuccess(store.get(s.id)!);
    expect(html).toContain("Efectivo en OXXO");
    expect(html).toContain(oxxoReference(s.paymentReference));
  });
});
