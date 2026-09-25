import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { QuoteReminderService } from "../src/quotes/quote-reminder.service.js";
import type { PrismaService } from "../src/prisma/prisma.service.js";
import type { NotificationService } from "../src/notifications/notification.service.js";

/**
 * Barrido de cotizaciones (QuoteReminderService).
 *
 * Lo que se fija aquí es la política, no el SQL:
 *  - una cotización vencida deja de figurar como vigente;
 *  - el recordatorio respeta la cadencia y el tope que configuró el dueño;
 *  - sin canal (ni teléfono ni correo) no se intenta nada;
 *  - el turno se "reserva" con un update condicionado, así que dos instancias
 *    del API barriendo a la vez no mandan el mensaje dos veces;
 *  - se reusa el link público vigente en vez de emitir uno nuevo cada vez.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const D = (v: string) => new Prisma.Decimal(v);
const HOUR = 60 * 60 * 1000;

const NOW = new Date("2026-09-24T18:00:00.000Z");

interface Seed {
  quotes: Array<Record<string, unknown>>;
  /** Filas que `updateMany` dice haber tocado al reservar el turno. */
  claimCount?: number;
}

function tenantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TENANT,
    status: "ACTIVE",
    timezone: "America/Mexico_City",
    quoteReminderEnabled: true,
    quoteReminderEveryHours: 24,
    quoteReminderMaxCount: 2,
    ...overrides,
  };
}

function quoteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "q-1",
    tenantId: TENANT,
    customerId: "c-1",
    status: "ISSUED",
    total: D("1200.00"),
    issuedAt: new Date(NOW.getTime() - 48 * HOUR),
    createdAt: new Date(NOW.getTime() - 48 * HOUR),
    expiresAt: new Date(NOW.getTime() + 72 * HOUR),
    remindersSent: 0,
    lastReminderAt: null,
    customer: { id: "c-1", fullName: "Laura Martínez", phone: "526671234567", email: null },
    tenant: tenantRow(),
    shares: [],
    ...overrides,
  };
}

function makeFake(seed: Seed) {
  const calls: Array<{ table: string; op: string; args: any }> = [];
  const prisma = {
    quote: {
      updateMany: async (args: any) => {
        calls.push({ table: "quote", op: "updateMany", args });
        if (args.where?.status === "ISSUED" && args.where?.expiresAt?.lte) {
          return { count: 1 };
        }
        return { count: seed.claimCount ?? 1 };
      },
      findMany: async (args: any) => {
        calls.push({ table: "quote", op: "findMany", args });
        return seed.quotes;
      },
    },
    quoteShareToken: {
      create: async (args: any) => {
        calls.push({ table: "quoteShareToken", op: "create", args });
        return { ...args.data, token: args.data.token };
      },
    },
  } as unknown as PrismaService;

  const scheduled: any[] = [];
  const notifications = {
    scheduleFromTemplate: async (input: any) => {
      scheduled.push(input);
      return input;
    },
  } as unknown as NotificationService;

  return { service: new QuoteReminderService(prisma, notifications), calls, scheduled };
}

describe("QuoteReminderService", () => {
  beforeEach(() => {
    process.env.PUBLIC_BASE_URL = "https://easysell.web.tupla.dev";
  });

  it("vence las cotizaciones ISSUED cuya vigencia ya pasó", async () => {
    const { service, calls } = makeFake({ quotes: [] });
    const expired = await service.expireDueQuotes(NOW);
    expect(expired).toBe(1);
    const update = calls.find((c) => c.op === "updateMany");
    expect(update?.args.where.status).toBe("ISSUED");
    expect(update?.args.where.expiresAt.lte).toEqual(NOW);
    expect(update?.args.data.status).toBe("EXPIRED");
  });

  it("manda el recordatorio con el link público y el vencimiento", async () => {
    const { service, scheduled, calls } = makeFake({ quotes: [quoteRow()] });
    expect(await service.remindUnpaid(NOW)).toBe(1);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].templateKey).toBe("QUOTE_REMINDER");
    expect(scheduled[0].channel).toBe("WHATSAPP");
    expect(scheduled[0].to).toBe("526671234567");
    expect(scheduled[0].vars.total).toBe("1200.00");
    expect(scheduled[0].vars.link).toContain("https://easysell.web.tupla.dev/quotes/public/");
    expect(scheduled[0].vars.expiresAt).toBeTruthy();
    // Se reservó el turno y se contó.
    const claim = calls.find((c) => c.op === "updateMany" && c.args.where.id === "q-1");
    expect(claim?.args.data.remindersSent).toEqual({ increment: 1 });
    expect(claim?.args.data.lastReminderAt).toEqual(NOW);
  });

  it("no manda antes de que pase la cadencia configurada", async () => {
    const { service, scheduled } = makeFake({
      quotes: [
        quoteRow({
          remindersSent: 1,
          lastReminderAt: new Date(NOW.getTime() - 3 * HOUR),
        }),
      ],
    });
    expect(await service.remindUnpaid(NOW)).toBe(0);
    expect(scheduled).toHaveLength(0);
  });

  it("respeta el tope de recordatorios del tenant", async () => {
    const { service, scheduled } = makeFake({
      quotes: [
        quoteRow({
          remindersSent: 2,
          lastReminderAt: new Date(NOW.getTime() - 48 * HOUR),
        }),
      ],
    });
    expect(await service.remindUnpaid(NOW)).toBe(0);
    expect(scheduled).toHaveLength(0);
  });

  it("un tope en 0 apaga los recordatorios sin apagar el barrido", async () => {
    const { service, scheduled } = makeFake({
      quotes: [quoteRow({ tenant: tenantRow({ quoteReminderMaxCount: 0 }) })],
    });
    expect(await service.remindUnpaid(NOW)).toBe(0);
    expect(scheduled).toHaveLength(0);
  });

  it("sin teléfono ni correo no hay a quién recordarle", async () => {
    const { service, scheduled } = makeFake({
      quotes: [quoteRow({ customer: { id: "c-1", fullName: "Sin canal", phone: null, email: null } })],
    });
    expect(await service.remindUnpaid(NOW)).toBe(0);
    expect(scheduled).toHaveLength(0);
  });

  it("si otra instancia ya tomó el turno, esta no encola nada", async () => {
    const { service, scheduled } = makeFake({ quotes: [quoteRow()], claimCount: 0 });
    expect(await service.remindUnpaid(NOW)).toBe(0);
    expect(scheduled).toHaveLength(0);
  });

  it("reusa un token de compartición vigente en vez de emitir otro", async () => {
    const { service, scheduled, calls } = makeFake({
      quotes: [
        quoteRow({
          shares: [{ token: "token-vivo", expiresAt: new Date(NOW.getTime() + 72 * HOUR) }],
        }),
      ],
    });
    await service.remindUnpaid(NOW);
    expect(scheduled[0].vars.link).toContain("/quotes/public/token-vivo");
    expect(calls.some((c) => c.table === "quoteShareToken")).toBe(false);
  });

  it("emite un token nuevo si los anteriores ya vencieron", async () => {
    const { service, scheduled, calls } = makeFake({
      quotes: [
        quoteRow({
          shares: [{ token: "token-muerto", expiresAt: new Date(NOW.getTime() - HOUR) }],
        }),
      ],
    });
    await service.remindUnpaid(NOW);
    expect(scheduled[0].vars.link).not.toContain("token-muerto");
    expect(calls.some((c) => c.table === "quoteShareToken" && c.op === "create")).toBe(true);
  });
});
