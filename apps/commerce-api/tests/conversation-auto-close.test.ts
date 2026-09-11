import { describe, expect, it } from "vitest";
import {
  AUTO_CLOSE_AUDIT_ACTION,
  ConversationAutoCloseService,
  windowSecondsFor,
} from "../src/whatsapp/conversation-auto-close.service.js";
import {
  autoCloseSeconds,
  parseCompactDuration,
  AUTO_CLOSE_MAX_SECONDS,
  AUTO_CLOSE_MIN_SECONDS,
} from "../src/whatsapp/duration.js";
import type { AgentTenantSettings } from "../src/whatsapp/agent-settings.client.js";

/**
 * Autocierre de conversaciones por inactividad.
 *
 * Lo que se fija aquí:
 *  - El formato compacto (`30s`, `15m`, `2h`, `1d`) se interpreta igual que en
 *    `agent_settings.py`, y los topes se recortan en vez de rechazarse.
 *  - Solo entran los tenants que encendieron el check Y dejaron un plazo
 *    válido: apagado, el valor guardado no gobierna nada.
 *  - El cierre es un `updateMany` acotado por tenant + `lastMessageAt` y
 *    excluyendo lo ya cerrado (idempotente, sin N+1), y suelta el handoff.
 *  - Hay una entrada de bitácora por lote, no por hilo, y ninguna cuando no
 *    se cerró nada.
 */

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

const NOW = new Date("2026-09-10T12:00:00.000Z");

function settings(over: Partial<AgentTenantSettings>): AgentTenantSettings {
  return {
    auto_close_enabled: false,
    auto_close_after: "",
    human_reply_filter_enabled: false,
    human_reply_filter_action: "block",
    ...over,
  };
}

interface UpdateManyCall {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}

function makeFakePrisma(opts: { tenants?: string[]; closedPerTenant?: Record<string, number> }) {
  const updates: UpdateManyCall[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const prisma = {
    tenant: {
      findMany: async ({ where }: { where: { status: string } }) => {
        expect(where.status).toBe("ACTIVE");
        return (opts.tenants ?? [TENANT_A]).map((id) => ({ id }));
      },
    },
    whatsAppConversation: {
      updateMany: async (call: UpdateManyCall) => {
        updates.push(call);
        const tenantId = call.where.tenantId as string;
        return { count: opts.closedPerTenant?.[tenantId] ?? 0 };
      },
      findMany: () => {
        throw new Error("no se permiten listados: el cierre va en un solo updateMany");
      },
      update: () => {
        throw new Error("no se permite actualizar hilo por hilo");
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      },
    },
  };
  return { prisma, updates, audits };
}

function makeSettingsClient(byTenant: Record<string, AgentTenantSettings | null>) {
  const asked: string[] = [];
  return {
    asked,
    client: {
      get: async (tenantId: string) => {
        asked.push(tenantId);
        return byTenant[tenantId] ?? null;
      },
    },
  };
}

describe("duraciones compactas", () => {
  it("interpreta número + unidad y rechaza lo demás", () => {
    expect(parseCompactDuration("30s")).toBe(30);
    expect(parseCompactDuration("15m")).toBe(900);
    expect(parseCompactDuration("2h")).toBe(7200);
    expect(parseCompactDuration("1d")).toBe(86400);
    expect(parseCompactDuration(" 2H ")).toBe(7200);
    expect(parseCompactDuration("90m")).toBe(5400);
    expect(parseCompactDuration("")).toBe(0);
    expect(parseCompactDuration(null)).toBe(0);
    expect(parseCompactDuration("2 h")).toBe(0);
    expect(parseCompactDuration("2w")).toBe(0);
    expect(parseCompactDuration("abc")).toBe(0);
    expect(parseCompactDuration("-1h")).toBe(0);
  });

  it("recorta a [30s, 30d] en vez de rechazar", () => {
    expect(autoCloseSeconds("1s")).toBe(AUTO_CLOSE_MIN_SECONDS);
    expect(autoCloseSeconds("30s")).toBe(30);
    expect(autoCloseSeconds("60d")).toBe(AUTO_CLOSE_MAX_SECONDS);
    expect(autoCloseSeconds("0m")).toBe(0);
    expect(autoCloseSeconds("basura")).toBe(0);
  });
});

describe("windowSecondsFor", () => {
  it("solo cuenta con el check encendido y un plazo válido", () => {
    expect(windowSecondsFor(null)).toBe(0);
    expect(windowSecondsFor(settings({ auto_close_after: "2h" }))).toBe(0);
    expect(windowSecondsFor(settings({ auto_close_enabled: true }))).toBe(0);
    expect(windowSecondsFor(settings({ auto_close_enabled: true, auto_close_after: "x" }))).toBe(0);
    expect(windowSecondsFor(settings({ auto_close_enabled: true, auto_close_after: "2h" }))).toBe(
      7200,
    );
  });
});

describe("ConversationAutoCloseService.runOnce", () => {
  it("cierra en lote lo inactivo y suelta el handoff", async () => {
    const fake = makeFakePrisma({ tenants: [TENANT_A], closedPerTenant: { [TENANT_A]: 3 } });
    const settingsClient = makeSettingsClient({
      [TENANT_A]: settings({ auto_close_enabled: true, auto_close_after: "2h" }),
    });
    const svc = new ConversationAutoCloseService(
      fake.prisma as never,
      settingsClient.client as never,
    );

    const run = await svc.runOnce(NOW);

    expect(run).toEqual({ tenantsChecked: 1, tenantsEnabled: 1, closed: 3 });
    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]!.where).toEqual({
      tenantId: TENANT_A,
      status: { not: "CLOSED" },
      lastMessageAt: { lt: new Date("2026-09-10T10:00:00.000Z") },
    });
    expect(fake.updates[0]!.data).toEqual({
      status: "CLOSED",
      handoffToHuman: false,
      handoffUserId: null,
    });
  });

  it("escribe una sola entrada de bitácora por lote", async () => {
    const fake = makeFakePrisma({ tenants: [TENANT_A], closedPerTenant: { [TENANT_A]: 7 } });
    const settingsClient = makeSettingsClient({
      [TENANT_A]: settings({ auto_close_enabled: true, auto_close_after: "45m" }),
    });
    await new ConversationAutoCloseService(
      fake.prisma as never,
      settingsClient.client as never,
    ).runOnce(NOW);

    expect(fake.audits).toHaveLength(1);
    expect(fake.audits[0]).toMatchObject({
      tenantId: TENANT_A,
      actorId: null,
      action: AUTO_CLOSE_AUDIT_ACTION,
      targetType: "WhatsAppConversation",
      metadata: {
        closed: 7,
        inactivitySeconds: 2700,
        cutoff: "2026-09-10T11:15:00.000Z",
      },
    });
  });

  it("no deja bitácora cuando no cerró nada", async () => {
    const fake = makeFakePrisma({ tenants: [TENANT_A], closedPerTenant: { [TENANT_A]: 0 } });
    const settingsClient = makeSettingsClient({
      [TENANT_A]: settings({ auto_close_enabled: true, auto_close_after: "1d" }),
    });
    const run = await new ConversationAutoCloseService(
      fake.prisma as never,
      settingsClient.client as never,
    ).runOnce(NOW);

    expect(run.closed).toBe(0);
    expect(fake.audits).toHaveLength(0);
  });

  it("salta los tenants sin autocierre sin tocar la base", async () => {
    const fake = makeFakePrisma({ tenants: [TENANT_A, TENANT_B], closedPerTenant: { [TENANT_B]: 1 } });
    const settingsClient = makeSettingsClient({
      // A lo tiene apagado con un plazo guardado: no debe cerrarse nada.
      [TENANT_A]: settings({ auto_close_enabled: false, auto_close_after: "5m" }),
      [TENANT_B]: settings({ auto_close_enabled: true, auto_close_after: "30s" }),
    });
    const run = await new ConversationAutoCloseService(
      fake.prisma as never,
      settingsClient.client as never,
    ).runOnce(NOW);

    expect(settingsClient.asked).toEqual([TENANT_A, TENANT_B]);
    expect(run).toEqual({ tenantsChecked: 2, tenantsEnabled: 1, closed: 1 });
    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]!.where.tenantId).toBe(TENANT_B);
  });

  it("salta el tenant si el agente no respondió sus ajustes", async () => {
    const fake = makeFakePrisma({ tenants: [TENANT_A] });
    const settingsClient = makeSettingsClient({ [TENANT_A]: null });
    const run = await new ConversationAutoCloseService(
      fake.prisma as never,
      settingsClient.client as never,
    ).runOnce(NOW);

    expect(run).toEqual({ tenantsChecked: 1, tenantsEnabled: 0, closed: 0 });
    expect(fake.updates).toHaveLength(0);
  });
});
