import { describe, expect, it, vi } from "vitest";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { WhatsAppService } from "../src/whatsapp/whatsapp.service.js";
import {
  MAX_ATTENTION_DAYS,
  dayKeys,
  resolveRange,
} from "../src/reports/attention.service.js";

/**
 * Atención multi-agente: quién puede tomar/contestar un hilo, y el rango del
 * reporte de atención.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const CONV = "22222222-2222-2222-2222-222222222222";
const ANA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BETO = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

interface Conv {
  id: string;
  tenantId: string;
  status: string;
  handoffToHuman: boolean;
  handoffUserId: string | null;
  connection: { provider: "META" | "EVOLUTION" };
  connectionId: string;
  externalPhone: string;
}

function makeService(opts: { conv: Partial<Conv>; agents: string[]; takeCount?: number }) {
  const conv: Conv = {
    id: CONV,
    tenantId: TENANT,
    status: "HANDED_OFF",
    handoffToHuman: true,
    handoffUserId: null,
    connection: { provider: "EVOLUTION" },
    connectionId: "c1",
    externalPhone: "5216671234567",
    ...opts.conv,
  };
  const updateMany = vi.fn().mockResolvedValue({ count: opts.takeCount ?? 1 });
  const prisma = {
    whatsAppConversation: {
      findFirst: vi.fn().mockResolvedValue(conv),
      findUnique: vi.fn().mockResolvedValue(conv),
      updateMany,
      update: vi.fn().mockResolvedValue(conv),
    },
    membership: {
      findFirst: vi.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(opts.agents.includes(where.userId) ? { id: "m" } : null),
      ),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const svc = Object.create(WhatsAppService.prototype) as WhatsAppService;
  Object.assign(svc, { prisma });
  return { svc, prisma, updateMany };
}

describe("claim", () => {
  it("un agente activo toma un hilo de la cola con updateMany condicionado", async () => {
    const { svc, updateMany } = makeService({ conv: {}, agents: [ANA] });
    await svc.claim(TENANT, CONV, ANA);
    const arg = updateMany.mock.calls[0]![0];
    expect(arg.where.OR).toEqual([{ handoffUserId: null }, { handoffUserId: ANA }]);
    expect(arg.data.handoffUserId).toBe(ANA);
    expect(arg.data.assignedAt).toBeInstanceOf(Date);
  });

  it("quien no es agente recibe 403", async () => {
    const { svc } = makeService({ conv: {}, agents: [] });
    await expect(svc.claim(TENANT, CONV, ANA)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("si otro se adelantó (count 0) responde 409", async () => {
    const { svc } = makeService({ conv: {}, agents: [ANA], takeCount: 0 });
    await expect(svc.claim(TENANT, CONV, ANA)).rejects.toBeInstanceOf(ConflictException);
  });

  it("no toma un hilo ya asignado a otra persona", async () => {
    const { svc } = makeService({ conv: { handoffUserId: BETO }, agents: [ANA] });
    await expect(svc.claim(TENANT, CONV, ANA)).rejects.toThrow(/asignada a otra persona/);
  });
});

describe("regla de dueño al contestar", () => {
  const attend = (
    svc: WhatsAppService,
    actor: { userId?: string; canManage?: boolean },
  ): Promise<unknown> =>
    (svc as unknown as {
      requireAttendant: (t: string, c: string, a: typeof actor) => Promise<unknown>;
    }).requireAttendant(TENANT, CONV, actor);

  it("el dueño contesta sin más", async () => {
    const { svc, updateMany } = makeService({ conv: { handoffUserId: ANA }, agents: [ANA] });
    await expect(attend(svc, { userId: ANA })).resolves.toBeTruthy();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("otro agente no puede contestar un hilo ajeno", async () => {
    const { svc } = makeService({ conv: { handoffUserId: BETO }, agents: [ANA, BETO] });
    await expect(attend(svc, { userId: ANA })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("un admin sí puede intervenir un hilo ajeno", async () => {
    const { svc } = makeService({ conv: { handoffUserId: BETO }, agents: [BETO] });
    await expect(attend(svc, { userId: ANA, canManage: true })).resolves.toBeTruthy();
  });

  it("en cola: el agente que contesta lo toma", async () => {
    const { svc, updateMany } = makeService({ conv: {}, agents: [ANA] });
    const conv = (await attend(svc, { userId: ANA })) as Conv;
    expect(updateMany).toHaveBeenCalledOnce();
    expect(conv.handoffUserId).toBe(ANA);
  });

  it("en cola: si otro lo tomó primero, 409", async () => {
    const { svc } = makeService({ conv: {}, agents: [ANA], takeCount: 0 });
    await expect(attend(svc, { userId: ANA })).rejects.toBeInstanceOf(ConflictException);
  });

  it("en cola: quien no es agente ni admin recibe 403", async () => {
    const { svc } = makeService({ conv: {}, agents: [] });
    await expect(attend(svc, { userId: ANA })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("rango del reporte de atención", () => {
  const NOW = new Date("2026-09-28T12:00:00Z");

  it("por defecto son los últimos 30 días, incluyendo ahora", () => {
    const r = resolveRange(undefined, undefined, NOW);
    expect(r.to.getTime()).toBeGreaterThan(NOW.getTime());
    expect(Math.round((r.to.getTime() - r.from.getTime()) / 86_400_000)).toBe(30);
  });

  it("rechaza from >= to y rangos de más de un año", () => {
    expect(() => resolveRange(new Date("2026-09-10"), new Date("2026-09-01"))).toThrow(RangeError);
    expect(() =>
      resolveRange(new Date("2025-01-01"), new Date(`2026-09-01`)),
    ).toThrow(new RegExp(String(MAX_ATTENTION_DAYS)));
  });

  it("dayKeys cubre cada día en la zona del tenant sin huecos ni repetidos", () => {
    const keys = dayKeys(
      new Date("2026-09-26T08:00:00Z"),
      new Date("2026-09-29T02:00:00Z"),
      "America/Mexico_City",
    );
    expect(keys).toEqual(["2026-09-26", "2026-09-27", "2026-09-28"]);
  });
});
