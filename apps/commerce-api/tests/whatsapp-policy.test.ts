import { describe, expect, it } from "vitest";
import {
  OPT_OUT_FOOTER,
  isOptInMessage,
  isOptOutMessage,
  isWithinServiceWindow,
  phoneDigits,
  samePhone,
} from "../src/whatsapp/service-window.js";
import { resolveApprovedTemplate } from "../src/notifications/whatsapp-template-map.js";
import { templateComponents } from "../src/whatsapp/channels.js";
import { renderTemplate } from "../src/notifications/notification-templates.js";

/**
 * Política Comercial de WhatsApp (Meta), la parte que el código hace cumplir:
 * ventana de servicio de 24 h, opt-out honrado y mensajes que identifican al
 * negocio. Ver `src/whatsapp/service-window.ts`.
 */

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-24T18:00:00.000Z");

describe("ventana de servicio de 24 h", () => {
  it("abierta si el cliente escribió hace menos de 24 h", () => {
    expect(isWithinServiceWindow(new Date(NOW.getTime() - 23 * HOUR), NOW)).toBe(true);
  });

  it("cerrada a las 24 h exactas y después", () => {
    expect(isWithinServiceWindow(new Date(NOW.getTime() - 24 * HOUR), NOW)).toBe(false);
    expect(isWithinServiceWindow(new Date(NOW.getTime() - 48 * HOUR), NOW)).toBe(false);
  });

  it("cerrada si el cliente nunca escribió", () => {
    expect(isWithinServiceWindow(null, NOW)).toBe(false);
  });
});

describe("comparación de teléfonos", () => {
  it("ignora formato y el 1 de los móviles mexicanos", () => {
    expect(samePhone("+52 667 123 4567", "5216671234567")).toBe(true);
    expect(samePhone("526671234567", "6671234567")).toBe(true);
  });

  it("no casa dos números distintos", () => {
    expect(samePhone("526671234567", "526679999999")).toBe(false);
  });

  it("no casa nada con menos de 10 dígitos", () => {
    expect(samePhone("1234", "1234")).toBe(false);
    expect(phoneDigits("+52 (667) 123-4567")).toBe("526671234567");
  });
});

describe("opt-out por palabra clave", () => {
  it("reconoce la baja escrita de varias formas", () => {
    for (const text of ["BAJA", "baja", "Baja por favor", "STOP", "no molestar", "cancelar suscripción"]) {
      expect(isOptOutMessage(text), text).toBe(true);
    }
  });

  it("no confunde la palabra dentro de una frase larga", () => {
    expect(isOptOutMessage("no quiero la baja de mi pedido, solo cambiarlo de fecha")).toBe(false);
    expect(isOptOutMessage("¿me das de baja el producto del carrito y agregas otro?")).toBe(false);
  });

  it("reconoce el alta y no la confunde con la baja", () => {
    expect(isOptInMessage("ALTA")).toBe(true);
    expect(isOptOutMessage("ALTA")).toBe(false);
  });

  it("un mensaje normal no es ni alta ni baja", () => {
    expect(isOptOutMessage("hola, cuánto cuesta la pintura blanca")).toBe(false);
    expect(isOptInMessage("hola, cuánto cuesta la pintura blanca")).toBe(false);
  });
});

describe("plantillas", () => {
  it("los mensajes que inicia el negocio traen el pie de baja", () => {
    const text = renderTemplate("QUOTE_REMINDER", {
      businessName: "Pinturas Aglos",
      customerName: "Laura",
      total: "1200.00",
      link: "https://x/y",
      expiresAt: "30 de septiembre",
    });
    expect(text).toContain(OPT_OUT_FOOTER);
    expect(text).toContain("Pinturas Aglos");
    expect(text).toContain("https://x/y");
  });

  it("los que contestan a una acción del cliente no lo traen", () => {
    const text = renderTemplate("PAYMENT_SIMULATED_SUCCESS", {
      businessName: "Pinturas Aglos",
      customerName: "Laura",
      total: "1200.00",
    });
    expect(text).not.toContain(OPT_OUT_FOOTER);
  });

  it("el aviso al negocio (HANDOFF) no lleva pie de baja", () => {
    expect(renderTemplate("HANDOFF", { customerName: "Laura" })).not.toContain(OPT_OUT_FOOTER);
  });
});

describe("plantillas aprobadas por tenant", () => {
  it("acepta la forma completa y la abreviada", () => {
    expect(
      resolveApprovedTemplate({ QUOTE_REMINDER: { name: "recordatorio", language: "es" } }, "QUOTE_REMINDER"),
    ).toEqual({ name: "recordatorio", language: "es" });
    expect(resolveApprovedTemplate({ QUOTE_REMINDER: "recordatorio" }, "QUOTE_REMINDER")).toEqual({
      name: "recordatorio",
      language: "es_MX",
    });
  });

  it("ignora configuraciones sin nombre útil", () => {
    expect(resolveApprovedTemplate(null, "QUOTE_REMINDER")).toBeNull();
    expect(resolveApprovedTemplate({}, "QUOTE_REMINDER")).toBeNull();
    expect(resolveApprovedTemplate({ QUOTE_REMINDER: { name: "  " } }, "QUOTE_REMINDER")).toBeNull();
    expect(resolveApprovedTemplate([1, 2], "QUOTE_REMINDER")).toBeNull();
  });

  it("los parámetros del cuerpo salen posicionales, con `body` primero", () => {
    expect(templateComponents({ body: "hola" })).toEqual([
      { type: "body", parameters: [{ type: "text", text: "hola" }] },
    ]);
    expect(templateComponents(undefined)).toEqual([]);
    expect(templateComponents({ body: "" })).toEqual([]);
  });
});
