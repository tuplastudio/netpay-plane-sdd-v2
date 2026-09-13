import { describe, expect, it } from "vitest";
import {
  CONVERSATION_AUDIT,
  WhatsAppService,
  type ConversationListFilters,
} from "../src/whatsapp/whatsapp.service.js";
import {
  buildTimeline,
  type TimelineInput,
} from "../src/whatsapp/conversation-context.service.js";

/**
 * Bandeja como CRM: ciclo de vida del hilo (cerrar/reabrir a mano y reabrir
 * solo cuando el cliente vuelve a escribir), triage de la cola (orden y
 * asignado, resueltos en el `where`, no en memoria) y la línea de tiempo.
 *
 * Lo que se fija aquí:
 *  - Cerrar suelta el handoff, igual que el autocierre; cerrar lo ya cerrado
 *    (o abrir lo ya abierto) es una violación de regla, no un no-op silencioso.
 *  - Un mensaje entrante sobre un hilo `CLOSED` lo regresa a `OPEN` con un
 *    `updateMany` acotado, y no toca nada cuando el hilo ya venía abierto.
 *  - `sort=oldest` y `assignee` viajan al `where`/`orderBy` de Prisma: la cola
 *    se ordena en la base, no recortando una página ya truncada.
 *  - El nombre del cliente en la lista sale de UNA consulta por página.
 *  - La línea de tiempo emite un evento por recurso, fechado en su hito más
 *    avanzado, y sale ordenada de lo más reciente a lo más viejo.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const CONV = "22222222-2222-2222-2222-222222222222";
const USER = "33333333-3333-3333-3333-333333333333";
const CUSTOMER = "44444444-4444-4444-4444-444444444444";
const CONNECTION = "55555555-5555-5555-5555-555555555555";

/** El filtro de moderación no participa en nada de lo que se prueba aquí. */
const NO_MODERATION = {
  enforce: async () => ({ allowed: true, action: "off" }),
} as never;

type Call = Record<string, unknown>;

/** Lo que el servicio le avisa al agente al cerrar/reabrir/devolver un hilo. */
const agentCalls: Array<{ op: "release" | "close"; conversationId: string }> = [];
const AGENT_LIFECYCLE = {
  release: async (_tenantId: string, conversationId: string) => {
    agentCalls.push({ op: "release", conversationId });
    return true;
  },
  close: async (_tenantId: string, conversationId: string) => {
    agentCalls.push({ op: "close", conversationId });
    return { ok: true, episodeCaptured: true };
  },
} as never;

function makeService(prisma: Record<string, unknown>) {
  agentCalls.length = 0;
  return new WhatsAppService(prisma as never, NO_MODERATION, undefined as never, AGENT_LIFECYCLE);
}

describe("setStatus: cerrar y reabrir a mano", () => {
  function prismaWith(status: string) {
    const updates: Call[] = [];
    const audits: Call[] = [];
    return {
      audits,
      updates,
      prisma: {
        whatsAppConversation: {
          findFirst: async () => ({ id: CONV, tenantId: TENANT, status }),
          update: async (call: Call) => {
            updates.push(call);
            return { id: CONV, ...(call.data as object) };
          },
        },
        auditLog: {
          create: async ({ data }: { data: Call }) => {
            audits.push(data);
            return data;
          },
        },
      },
    };
  }

  it("cierra, suelta el handoff y deja bitácora con el hilo como objetivo", async () => {
    const fake = prismaWith("HANDED_OFF");
    await makeService(fake.prisma).setStatus(TENANT, CONV, "CLOSED", USER);

    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]!.data).toEqual({
      status: "CLOSED",
      handoffToHuman: false,
      handoffUserId: null,
    });
    expect(fake.audits).toHaveLength(1);
    expect(fake.audits[0]).toMatchObject({
      tenantId: TENANT,
      actorId: USER,
      action: CONVERSATION_AUDIT.closed,
      targetType: "WhatsAppConversation",
      targetId: CONV,
    });
    // El agente cierra su hilo (memoria episódica + borrado del checkpoint).
    expect(agentCalls).toEqual([{ op: "close", conversationId: CONV }]);
  });

  it("reabre un hilo cerrado y lo deja con el agente", async () => {
    const fake = prismaWith("CLOSED");
    await makeService(fake.prisma).setStatus(TENANT, CONV, "OPEN", USER);

    expect(fake.updates[0]!.data).toEqual({
      status: "OPEN",
      handoffToHuman: false,
      handoffUserId: null,
    });
    expect(fake.audits[0]).toMatchObject({ action: CONVERSATION_AUDIT.reopened });
    // Reabrir suelta el handoff también en el agente, no solo en la base.
    expect(agentCalls).toEqual([{ op: "release", conversationId: CONV }]);
  });

  it("rechaza cerrar lo ya cerrado y abrir lo ya abierto, sin escribir", async () => {
    const closed = prismaWith("CLOSED");
    await expect(makeService(closed.prisma).setStatus(TENANT, CONV, "CLOSED")).rejects.toThrow();
    expect(closed.updates).toHaveLength(0);

    const open = prismaWith("HANDED_OFF");
    await expect(makeService(open.prisma).setStatus(TENANT, CONV, "OPEN")).rejects.toThrow();
    expect(open.updates).toHaveLength(0);
  });
});

describe("ingestInbound: un cliente que vuelve a escribir reabre su ticket", () => {
  function prismaWith(conversationStatus: string) {
    const updateManys: Call[] = [];
    const audits: Call[] = [];
    return {
      updateManys,
      audits,
      prisma: {
        whatsAppMessage: {
          findUnique: async () => null,
          create: async ({ data }: { data: Call }) => ({ id: "msg-1", ...data }),
        },
        whatsAppConnection: {
          findUnique: async () => ({ id: CONNECTION, tenantId: TENANT, provider: "EVOLUTION" }),
        },
        whatsAppConversation: {
          upsert: async () => ({ id: CONV, status: conversationStatus }),
          updateMany: async (call: Call) => {
            updateManys.push(call);
            return { count: 1 };
          },
        },
        auditLog: {
          create: async ({ data }: { data: Call }) => {
            audits.push(data);
            return data;
          },
        },
      },
    };
  }

  const inbound = {
    tenantId: TENANT,
    provider: "EVOLUTION" as const,
    connectionId: CONNECTION,
    externalPhone: "+5216674922953",
    body: "sigo esperando mi pedido",
    externalId: "wamid.1",
  };

  it("regresa a OPEN un hilo CLOSED, acotando el updateMany al estado cerrado", async () => {
    const fake = prismaWith("CLOSED");
    await makeService(fake.prisma).ingestInbound(inbound);

    expect(fake.updateManys).toHaveLength(1);
    expect(fake.updateManys[0]!.where).toEqual({ id: CONV, status: "CLOSED" });
    expect(fake.updateManys[0]!.data).toEqual({ status: "OPEN" });
    expect(fake.audits[0]).toMatchObject({
      action: CONVERSATION_AUDIT.reopened,
      targetId: CONV,
      actorId: null,
    });
    // Y suelta cualquier handoff viejo del agente (sin bloquear el webhook).
    expect(agentCalls).toEqual([{ op: "release", conversationId: CONV }]);
  });

  it("no toca el estado cuando el hilo ya venía abierto", async () => {
    const fake = prismaWith("OPEN");
    await makeService(fake.prisma).ingestInbound(inbound);
    expect(fake.updateManys).toHaveLength(0);
    expect(fake.audits).toHaveLength(0);
    expect(agentCalls).toHaveLength(0);
  });

  it("tampoco lo reabre si el mensaje era un duplicado del webhook", async () => {
    const fake = prismaWith("CLOSED");
    const prisma = {
      ...fake.prisma,
      whatsAppMessage: { ...fake.prisma.whatsAppMessage, findUnique: async () => ({ id: "dup" }) },
    };
    await makeService(prisma).ingestInbound(inbound);
    expect(fake.updateManys).toHaveLength(0);
  });
});

describe("listConversations: triage de la cola", () => {
  function makeFake() {
    const findManyCalls: Call[] = [];
    const customerFindMany: Call[] = [];
    const prisma = {
      whatsAppConversation: {
        findMany: async (call: Call) => {
          findManyCalls.push(call);
          return [
            {
              id: CONV,
              customerId: CUSTOMER,
              tenantId: TENANT,
              messages: [{ direction: "INBOUND", body: "hola", messageType: "TEXT" }],
            },
            {
              id: "otro",
              customerId: null,
              tenantId: TENANT,
              messages: [],
            },
          ];
        },
      },
      whatsAppMessage: {
        groupBy: async () => [
          { conversationId: CONV, _max: { createdAt: new Date("2026-09-10T09:00:00Z") } },
        ],
      },
      customer: {
        findMany: async (call: Call) => {
          customerFindMany.push(call);
          return [{ id: CUSTOMER, fullName: "Ana Ruiz" }];
        },
        findFirst: () => {
          throw new Error("nada de una consulta por fila");
        },
      },
    };
    return { prisma, findManyCalls, customerFindMany };
  }

  async function list(filters: ConversationListFilters) {
    const fake = makeFake();
    const rows = await makeService(fake.prisma).listConversations(TENANT, filters);
    return { ...fake, rows };
  }

  it("ordena por lastMessageAt asc con sort=oldest y desc por omisión", async () => {
    const oldest = await list({ sort: "oldest" });
    expect(oldest.findManyCalls[0]!.orderBy).toEqual({ lastMessageAt: "asc" });

    const recent = await list({});
    expect(recent.findManyCalls[0]!.orderBy).toEqual({ lastMessageAt: "desc" });
  });

  it("traduce assignee=unassigned a la cola sin dueño, en el where", async () => {
    const queue = await list({ assignee: "unassigned" });
    expect(queue.findManyCalls[0]!.where).toMatchObject({
      tenantId: TENANT,
      handoffToHuman: true,
      handoffUserId: null,
    });
  });

  it("acota por dueño cuando assignee es una persona", async () => {
    const mine = await list({ assignee: USER });
    expect(mine.findManyCalls[0]!.where).toMatchObject({ handoffUserId: USER });
  });

  it("resuelve el nombre del cliente en UNA consulta por página", async () => {
    const result = await list({});
    expect(result.customerFindMany).toHaveLength(1);
    expect(result.customerFindMany[0]!.where).toEqual({
      tenantId: TENANT,
      id: { in: [CUSTOMER] },
    });
    expect(result.rows[0]).toMatchObject({
      customer: { id: CUSTOMER, fullName: "Ana Ruiz" },
      unanswered: true,
      lastMessagePreview: "hola",
    });
    // El hilo sin ficha no inventa un cliente ni dispara otra consulta.
    expect(result.rows[1]!.customer).toBeNull();
  });

  it("no consulta clientes cuando ningún hilo tiene ficha", async () => {
    const fake = makeFake();
    fake.prisma.whatsAppConversation.findMany = async () => [
      { id: CONV, customerId: null, tenantId: TENANT, messages: [] },
    ];
    await makeService(fake.prisma).listConversations(TENANT, {});
    expect(fake.customerFindMany).toHaveLength(0);
  });
});

describe("buildTimeline", () => {
  const base: TimelineInput = {
    conversation: { externalPhone: "+5216674922953", createdAt: new Date("2026-09-01T10:00:00Z") },
    orders: [],
    quotes: [],
    payments: [],
    notes: [],
    audits: [],
  };

  const money = (v: string) => ({ toString: () => v }) as never;

  it("siempre abre con el inicio de la conversación", () => {
    const events = buildTimeline(base);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "conversation",
      title: "Conversación iniciada",
      detail: "+5216674922953",
      at: "2026-09-01T10:00:00.000Z",
    });
  });

  it("emite UN evento por recurso, fechado en su hito más avanzado", () => {
    const events = buildTimeline({
      ...base,
      quotes: [
        {
          id: "q1",
          status: "ACCEPTED",
          total: money("1200.00"),
          createdAt: new Date("2026-09-02T10:00:00Z"),
          issuedAt: new Date("2026-09-03T10:00:00Z"),
          acceptedAt: new Date("2026-09-04T10:00:00Z"),
          expiresAt: new Date("2026-09-30T10:00:00Z"),
        },
      ],
      orders: [
        {
          id: "o1",
          status: "AWAITING_PAYMENT",
          source: "QUOTE",
          total: money("1200.00"),
          createdAt: new Date("2026-09-05T10:00:00Z"),
          placedAt: new Date("2026-09-05T11:00:00Z"),
          paidAt: null,
        },
      ],
    });

    const quote = events.filter((e) => e.kind === "quote");
    expect(quote).toHaveLength(1);
    expect(quote[0]).toMatchObject({
      id: "quote:q1",
      title: "Cotización aceptada",
      at: "2026-09-04T10:00:00.000Z",
      statusDomain: "quote",
      amount: "1200.00",
      href: "/quotes/q1",
    });

    const order = events.filter((e) => e.kind === "order");
    expect(order[0]).toMatchObject({
      title: "Pedido levantado",
      at: "2026-09-05T11:00:00.000Z",
      href: "/orders/o1",
    });
  });

  it("fusiona todo en orden descendente y traduce la bitácora", () => {
    const events = buildTimeline({
      ...base,
      notes: [
        {
          id: "n1",
          body: "  ojo:\n  cliente molesto por el envío pasado ",
          createdAt: new Date("2026-09-06T10:00:00Z"),
          author: { id: USER, fullName: "Luis Pérez", email: "luis@x.mx" },
        },
      ],
      payments: [
        {
          id: "p1",
          orderId: "o1",
          status: "CAPTURED",
          amount: money("1200.00"),
          refundedTotal: money("0.00"),
          currency: "MXN",
          createdAt: new Date("2026-09-07T09:00:00Z"),
          capturedAt: new Date("2026-09-07T10:00:00Z"),
          failedAt: null,
        },
      ],
      audits: [
        {
          id: "a1",
          action: "whatsapp.conversation.tags_changed",
          metadata: { tags: ["vip", "reclamo"] },
          createdAt: new Date("2026-09-08T10:00:00Z"),
          actor: { fullName: "Luis Pérez" },
        },
      ],
    });

    expect(events.map((e) => e.id)).toEqual([
      "audit:a1",
      "payment:p1",
      "note:n1",
      `conversation:${base.conversation.createdAt.getTime()}`,
    ]);
    expect(events[0]).toMatchObject({
      kind: "system",
      title: "Etiquetas actualizadas",
      detail: "vip, reclamo",
      actor: "Luis Pérez",
    });
    // La nota se normaliza a una línea para caber en la barra lateral.
    expect(events[2]!.detail).toBe("ojo: cliente molesto por el envío pasado");
  });
});
