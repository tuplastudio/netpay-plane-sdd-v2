import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentBridgeService, HUMAN_ACTIVE_INTENT } from "../src/whatsapp/agent-bridge.service.js";

/**
 * Puente WhatsApp → agente: sincronía del handoff entre la base y el agente.
 *
 * El caso que rompía producción: una persona toma el hilo, el agente marca
 * `handoff=True` en su estado, la persona lo devuelve desde el panel
 * (`handoffToHuman=false` en Postgres) y el agente NO se entera. Al siguiente
 * mensaje el agente contesta `{reply:"", handoff:true, intent:"HUMAN_ACTIVE"}`,
 * el puente volvía a marcar HANDED_OFF y el cliente se quedaba mudo.
 *
 * Lo que se fija:
 *  - Ante ese desfase el puente libera en el agente y reintenta UNA vez con el
 *    mismo `messageId` (idempotente del lado del agente).
 *  - Si la liberación falla, no reintenta (no hay para qué) y no marca
 *    HANDED_OFF por una respuesta vacía de HUMAN_ACTIVE.
 *  - Un handoff REAL (el agente escaló con texto) sigue marcando HANDED_OFF.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";

function makeFakePrisma(handoffToHuman: boolean) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    prisma: {
      whatsAppConversation: {
        findFirst: async () => ({ id: "conv-1", tenantId: TENANT, handoffToHuman }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return data;
        },
      },
    },
  };
}

function makeWa() {
  const sent: Array<Record<string, unknown>> = [];
  return {
    sent,
    wa: {
      send: async (_t: string, msg: Record<string, unknown>) => {
        sent.push(msg);
        return { status: "SENT" };
      },
      sendDocument: async () => ({ status: "SENT" }),
    },
  };
}

function stubChat(replies: Array<Record<string, unknown>>) {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const next = replies.shift() ?? { reply: "", handoff: false, intent: null };
    return new Response(JSON.stringify(next), { status: 200 });
  });
  return bodies;
}

const INPUT = {
  tenantId: TENANT,
  conversationId: "conv-1",
  externalPhone: "5216671234567",
  text: "hola",
  messageId: "msg-1",
};

describe("AgentBridgeService.handleInbound — handoff desfasado", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("libera en el agente y reintenta cuando el agente cree que hay humano", async () => {
    const bodies = stubChat([
      { reply: "", handoff: true, intent: HUMAN_ACTIVE_INTENT },
      { reply: "¡Hola! ¿Qué necesitas?", handoff: false, intent: "DESCUBRIMIENTO" },
    ]);
    const released: string[] = [];
    const lifecycle = { release: async (_t: string, id: string) => (released.push(id), true) };
    const fake = makeFakePrisma(false);
    const { wa, sent } = makeWa();

    const svc = new AgentBridgeService(fake.prisma as never, wa as never, lifecycle as never);
    const payload = await svc.handleInbound(INPUT);

    expect(released).toEqual(["conv-1"]);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.messageId).toBe("msg-1");
    expect(payload?.reply).toBe("¡Hola! ¿Qué necesitas?");
    expect(sent).toHaveLength(1);
    expect(fake.updates).toHaveLength(0);
  });

  it("si liberar falla, no reintenta ni marca HANDED_OFF por la respuesta vacía", async () => {
    const bodies = stubChat([{ reply: "", handoff: true, intent: HUMAN_ACTIVE_INTENT }]);
    const lifecycle = { release: async () => false };
    const fake = makeFakePrisma(false);
    const { wa, sent } = makeWa();

    const svc = new AgentBridgeService(fake.prisma as never, wa as never, lifecycle as never);
    const payload = await svc.handleInbound(INPUT);

    expect(bodies).toHaveLength(1);
    expect(sent).toHaveLength(0);
    expect(payload?.intent).toBe(HUMAN_ACTIVE_INTENT);
    // Conserva el comportamiento previo del puente para un handoff devuelto
    // por el agente: la base se marca HANDED_OFF (una persona debe revisarlo).
    expect(fake.updates).toEqual([{ status: "HANDED_OFF", handoffToHuman: true }]);
  });

  it("un handoff real del agente (con texto) marca HANDED_OFF sin reintentar", async () => {
    const bodies = stubChat([
      { reply: "Te paso con una persona del equipo.", handoff: true, intent: "HUMANO" },
    ]);
    const lifecycle = {
      release: async () => {
        throw new Error("no debía liberar");
      },
    };
    const fake = makeFakePrisma(false);
    const { wa, sent } = makeWa();

    const svc = new AgentBridgeService(fake.prisma as never, wa as never, lifecycle as never);
    await svc.handleInbound(INPUT);

    expect(bodies).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(fake.updates).toEqual([{ status: "HANDED_OFF", handoffToHuman: true }]);
  });

  it("no invoca al agente si la base ya dice que una persona atiende", async () => {
    const bodies = stubChat([]);
    const fake = makeFakePrisma(true);
    const { wa } = makeWa();
    const svc = new AgentBridgeService(fake.prisma as never, wa as never, {} as never);
    expect(await svc.handleInbound(INPUT)).toBeNull();
    expect(bodies).toHaveLength(0);
  });
});
