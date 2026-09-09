import { beforeEach, describe, expect, it, vi } from "vitest";
import { HANDLERS, handleEvent, registerHandler } from "../src/handlers.js";

describe("registro de manejadores del inbox", () => {
  beforeEach(() => {
    for (const key of Object.keys(HANDLERS)) delete HANDLERS[key];
  });

  it("ejecuta el manejador registrado con el sobre completo", async () => {
    const seen: unknown[] = [];
    registerHandler("quote.issued", async (envelope) => {
      seen.push(envelope);
    });

    await handleEvent({
      eventName: "quote.issued",
      tenantId: "t1",
      eventId: "e1",
      payload: { quoteId: "q1" },
    });

    expect(seen).toEqual([
      { eventName: "quote.issued", tenantId: "t1", eventId: "e1", payload: { quoteId: "q1" } },
    ]);
  });

  it("un evento sin manejador no rompe el consumo", async () => {
    await expect(
      handleEvent({ eventName: "desconocido", tenantId: "t1", eventId: "e2", payload: {} }),
    ).resolves.toBeUndefined();
  });

  it("propaga el error del manejador para que el inbox marque FAILED", async () => {
    registerHandler("order.paid", async () => {
      throw new Error("efecto falló");
    });

    await expect(
      handleEvent({ eventName: "order.paid", tenantId: "t1", eventId: "e3", payload: {} }),
    ).rejects.toThrow("efecto falló");
  });

  it("registrar dos veces el mismo evento reemplaza al anterior", async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    registerHandler("payment.captured", first);
    registerHandler("payment.captured", second);

    await handleEvent({ eventName: "payment.captured", tenantId: "t1", eventId: "e4", payload: {} });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
