import { describe, expect, it } from "vitest";
import {
  CONVERSATION_AUDIT,
  MAX_BULK_IDS,
  WhatsAppService,
  type ConversationListFilters,
} from "../src/whatsapp/whatsapp.service.js";

/**
 * Help desk sobre la bandeja (migración 0025): prioridad, "pendiente" y
 * acciones masivas.
 *
 *  - La prioridad es idempotente (misma prioridad = sin escritura ni bitácora)
 *    y deja `from`/`to` en la bitácora.
 *  - "Pendiente" no aplica a hilos cerrados; quitar la marca es su propia
 *    entrada de bitácora; un mensaje entrante la limpia en el mismo upsert.
 *  - Los filtros nuevos viajan al `where` (prioridad, pendiente) y "sin
 *    responder" se resuelve con una subconsulta de ids, no en memoria.
 *  - `sort=priority` ordena por el enum en la base, urgente primero.
 *  - La acción masiva no es atómica: reporta ok/failed por hilo.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const CONV = "22222222-2222-2222-2222-222222222222";
const CONV2 = "66666666-6666-6666-6666-666666666666";
const USER = "33333333-3333-3333-3333-333333333333";

const NO_MODERATION = { enforce: async () => ({ allowed: true, action: "off" }) } as never;
const AGENT_LIFECYCLE = {
  release: async () => true,
  close: async () => ({ ok: true, episodeCaptured: true }),
} as never;

type Call = Record<string, unknown>;

function makeService(prisma: Record<string, unknown>) {
  return new WhatsAppService(prisma as never, NO_MODERATION, undefined as never, AGENT_LIFECYCLE);
}

function fakePrisma(conv: Call) {
  const updates: Call[] = [];
  const audits: Call[] = [];
  const prisma = {
    whatsAppConversation: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        where.id === conv.id ? conv : null,
      update: async (call: Call) => {
        updates.push(call);
        return { ...conv, ...(call.data as object) };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Call }) => {
        audits.push(data);
        return data;
      },
    },
  };
  return { prisma, updates, audits };
}

describe("setPriority", () => {
  it("cambia la prioridad y deja from/to en la bitácora", async () => {
    const fake = fakePrisma({ id: CONV, tenantId: TENANT, status: "OPEN", priority: "NORMAL" });
    await makeService(fake.prisma).setPriority(TENANT, CONV, "URGENT", USER);
    expect(fake.updates[0]!.data).toEqual({ priority: "URGENT" });
    expect(fake.audits[0]).toMatchObject({
      action: CONVERSATION_AUDIT.priorityChanged,
      actorId: USER,
      targetId: CONV,
      metadata: { from: "NORMAL", to: "URGENT" },
    });
  });

  it("la misma prioridad no escribe ni deja bitácora", async () => {
    const fake = fakePrisma({ id: CONV, tenantId: TENANT, status: "OPEN", priority: "HIGH" });
    await makeService(fake.prisma).setPriority(TENANT, CONV, "HIGH", USER);
    expect(fake.updates).toHaveLength(0);
    expect(fake.audits).toHaveLength(0);
  });
});

describe("setPending", () => {
  it("marca pendiente con fecha y lo anota", async () => {
    const fake = fakePrisma({ id: CONV, tenantId: TENANT, status: "HANDED_OFF", pendingAt: null, handoffUserId: USER });
    await makeService(fake.prisma).setPending(TENANT, CONV, true, { userId: USER });
    expect(fake.updates[0]!.data).toEqual({ pendingAt: expect.any(Date) });
    expect(fake.audits[0]).toMatchObject({ action: CONVERSATION_AUDIT.pendingSet, actorId: USER });
  });

  it("quitar la marca es su propia entrada de bitácora", async () => {
    const fake = fakePrisma({ id: CONV, tenantId: TENANT, status: "OPEN", pendingAt: new Date(), handoffUserId: null });
    await makeService(fake.prisma).setPending(TENANT, CONV, false, { userId: USER });
    expect(fake.updates[0]!.data).toEqual({ pendingAt: null });
    expect(fake.audits[0]).toMatchObject({ action: CONVERSATION_AUDIT.pendingCleared });
  });

  it("un hilo cerrado no puede quedar pendiente", async () => {
    const fake = fakePrisma({ id: CONV, tenantId: TENANT, status: "CLOSED", pendingAt: null, handoffUserId: null });
    await expect(
      makeService(fake.prisma).setPending(TENANT, CONV, true, { userId: USER }),
    ).rejects.toMatchObject({ response: { code: "RULE_VIOLATION" } });
    expect(fake.updates).toHaveLength(0);
  });

  it("solo su dueño (o quien administra) mueve un hilo asignado", async () => {
    const fake = fakePrisma({ id: CONV, tenantId: TENANT, status: "HANDED_OFF", pendingAt: null, handoffUserId: USER });
    await expect(
      makeService(fake.prisma).setPending(TENANT, CONV, true, { userId: "otro" }),
    ).rejects.toMatchObject({ response: { code: "FORBIDDEN" } });
    await makeService(fake.prisma).setPending(TENANT, CONV, true, { userId: "otro", canManage: true });
    expect(fake.updates).toHaveLength(1);
  });
});

describe("ingestInbound limpia la marca de pendiente", () => {
  it("el upsert pone pendingAt en null al llegar un mensaje del cliente", async () => {
    const upserts: Call[] = [];
    const prisma = {
      whatsAppMessage: {
        findUnique: async () => null,
        create: async ({ data }: { data: Call }) => ({ id: "m1", ...data }),
      },
      whatsAppConnection: { findUnique: async () => ({ id: "c1", tenantId: TENANT }) },
      whatsAppConversation: {
        upsert: async (call: Call) => {
          upserts.push(call);
          return { id: CONV, status: "OPEN" };
        },
      },
    };
    await makeService(prisma).ingestInbound({
      tenantId: TENANT,
      provider: "EVOLUTION",
      connectionId: "c1",
      externalPhone: "+5215500000000",
      body: "ya pagué",
      externalId: "wamid.9",
    });
    expect(upserts[0]!.update).toEqual({ lastMessageAt: expect.any(Date), pendingAt: null });
  });
});

describe("listConversations: filtros y orden del help desk", () => {
  function makeFake() {
    const findManyCalls: Call[] = [];
    const rawCalls: unknown[] = [];
    const prisma = {
      whatsAppConversation: {
        findMany: async (call: Call) => {
          findManyCalls.push(call);
          return [];
        },
      },
      whatsAppMessage: { groupBy: async () => [] },
      customer: { findMany: async () => [] },
      $queryRaw: async (query: unknown) => {
        rawCalls.push(query);
        return [{ id: CONV }, { id: CONV2 }];
      },
    };
    return { prisma, findManyCalls, rawCalls };
  }

  async function whereFor(filters: ConversationListFilters) {
    const fake = makeFake();
    await makeService(fake.prisma).listConversations(TENANT, filters);
    return { call: fake.findManyCalls[0]!, raw: fake.rawCalls };
  }

  it("prioridad y pendiente van al where", async () => {
    expect((await whereFor({ priority: "URGENT" })).call.where).toMatchObject({ priority: "URGENT" });
    expect((await whereFor({ pending: true })).call.where).toMatchObject({ pendingAt: { not: null } });
    expect((await whereFor({ pending: false })).call.where).toMatchObject({ pendingAt: null });
  });

  it("sin responder: ids de una subconsulta, acotados en el where", async () => {
    const { call, raw } = await whereFor({ unanswered: true });
    expect(raw).toHaveLength(1);
    expect(call.where).toMatchObject({ AND: [{ id: { in: [CONV, CONV2] } }] });
  });

  it("sort=priority ordena por el enum (urgente primero) y luego por espera", async () => {
    const { call } = await whereFor({ sort: "priority" });
    expect(call.orderBy).toEqual([{ priority: "desc" }, { lastMessageAt: "asc" }, { id: "desc" }]);
  });
});

describe("bulk", () => {
  it("aplica por hilo y reporta los que fallan sin detener el resto", async () => {
    const convs: Record<string, Call> = {
      [CONV]: { id: CONV, tenantId: TENANT, status: "OPEN", priority: "NORMAL" },
      [CONV2]: { id: CONV2, tenantId: TENANT, status: "CLOSED", priority: "NORMAL" },
    };
    const updates: Call[] = [];
    const prisma = {
      whatsAppConversation: {
        findFirst: async ({ where }: { where: { id: string } }) => convs[where.id] ?? null,
        update: async (call: Call) => {
          updates.push(call);
          return { ...convs[(call.where as { id: string }).id], ...(call.data as object) };
        },
      },
      auditLog: { create: async ({ data }: { data: Call }) => data },
    };
    const result = await makeService(prisma).bulk(
      TENANT,
      { ids: [CONV, CONV2, "no-existe"], action: "pending" },
      { userId: USER, canManage: true },
    );
    expect(result.ok).toEqual([CONV]);
    expect(result.failed.map((f) => f.id)).toEqual([CONV2, "no-existe"]);
    expect(result.failed[0]!.message).toContain("cerrada");
    expect(updates).toHaveLength(1);
  });

  it("etiquetar SUMA a las etiquetas existentes", async () => {
    const updates: Call[] = [];
    const prisma = {
      whatsAppConversation: {
        findFirst: async () => ({ id: CONV, tenantId: TENANT, status: "OPEN", tags: ["vip"] }),
        update: async (call: Call) => {
          updates.push(call);
          return { id: CONV, ...(call.data as object) };
        },
      },
      auditLog: { create: async ({ data }: { data: Call }) => data },
    };
    await makeService(prisma).bulk(TENANT, { ids: [CONV], action: "tag", tags: ["Reclamo"] }, { userId: USER });
    expect(updates[0]!.data).toEqual({ tags: ["vip", "reclamo"] });
  });

  it("valida lote vacío/excesivo y parámetros obligatorios", async () => {
    const svc = makeService({});
    await expect(svc.bulk(TENANT, { ids: [], action: "resolve" }, {})).rejects.toMatchObject({
      response: { code: "VALIDATION_FAILED" },
    });
    const tooMany = Array.from({ length: MAX_BULK_IDS + 1 }, (_, i) => `id-${i}`);
    await expect(svc.bulk(TENANT, { ids: tooMany, action: "resolve" }, {})).rejects.toMatchObject({
      response: { code: "VALIDATION_FAILED" },
    });
    await expect(svc.bulk(TENANT, { ids: [CONV], action: "assign" }, {})).rejects.toMatchObject({
      response: { code: "VALIDATION_FAILED" },
    });
    await expect(svc.bulk(TENANT, { ids: [CONV], action: "priority" }, {})).rejects.toMatchObject({
      response: { code: "VALIDATION_FAILED" },
    });
  });
});
