import { describe, expect, it } from "vitest";
import "reflect-metadata";
import { SCOPES_KEY } from "../src/auth/guards/role.guard.js";
import { roleHas } from "../src/auth/policies.js";
import { WhatsAppController } from "../src/whatsapp/whatsapp.controller.js";
import { AgentProxyController } from "../src/agent-proxy.controller.js";
import { RequestContext, type Principal } from "../src/common/context/request-context.js";

/**
 * Fronteras de rol que el panel da por hechas al esconder secciones: si el
 * backend las relaja, un VENDOR vuelve a poder desconectar el WhatsApp del
 * negocio aunque la web no le muestre el botón.
 */

function scopesOf(method: keyof WhatsAppController): string[] {
  const fn = (WhatsAppController.prototype as unknown as Record<string, object>)[method as string];
  return (Reflect.getMetadata(SCOPES_KEY, fn) ?? []) as string[];
}

describe("gestión de canales de WhatsApp", () => {
  const channelWrites = [
    "connect",
    "disconnect",
    "rotateWebhookSecret",
    "updateWebhookUrl",
    "provisionEvolution",
    "evolutionQrCode",
    "evolutionQrImage",
    "evolutionState",
    "finalizeEvolution",
    "evolutionCleanup",
  ];

  it("conectar, desconectar, QR y rotar secretos exige integrations.write", () => {
    for (const m of channelWrites) {
      expect(scopesOf(m as keyof WhatsAppController), m).toEqual(["integrations.write"]);
    }
    expect(scopesOf("health" as keyof WhatsAppController)).toEqual(["integrations.read"]);
  });

  it("solo OWNER y ADMIN administran canales", () => {
    for (const role of ["VENDOR", "SUPPORT", "FINANCE", "CATALOG", "VIEWER"]) {
      expect(roleHas(role, "integrations.write"), role).toBe(false);
    }
    expect(roleHas("OWNER", "integrations.write")).toBe(true);
    expect(roleHas("ADMIN", "integrations.write")).toBe(true);
  });

  it("SUPPORT atiende conversaciones y corrige datos del cliente", () => {
    expect(roleHas("SUPPORT", "chat.write")).toBe(true);
    expect(roleHas("SUPPORT", "customers.write")).toBe(true);
    expect(roleHas("SUPPORT", "quotes.write")).toBe(false);
  });
});

function fakeRes() {
  const out: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

function proxyGet(principal: Principal) {
  const controller = new AgentProxyController({ get: () => "" } as never);
  const { res, out } = fakeRes();
  const req = { method: "GET", originalUrl: "/api/v1/agent/settings", headers: {}, body: {} };
  return RequestContext.run(async () => {
    // Sin agente real: basta con saber si el proxy corta antes de reenviar.
    await controller.proxy(req as never, res as never).catch(() => undefined);
    return out;
  }, { principal });
}

describe("proxy del agente: lecturas", () => {
  it("CATALOG, FINANCE y VIEWER no leen configuración ni transcripts del bot", async () => {
    for (const role of ["CATALOG", "FINANCE", "VIEWER"]) {
      const out = await proxyGet({ type: "USER", userId: "u", tenantId: "t1", role });
      expect(out.status, role).toBe(403);
    }
  });

  it("VENDOR y SUPPORT (chat.read) sí pasan el control de lectura", async () => {
    for (const role of ["VENDOR", "SUPPORT", "ADMIN", "OWNER"]) {
      const out = await proxyGet({ type: "USER", userId: "u", tenantId: "t1", role });
      expect(out.status, role).not.toBe(403);
    }
  });
});
