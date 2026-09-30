import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { decryptSecret } from "../src/common/crypto/secret-cipher.js";
import { DomainEventBus, domainEvents } from "../src/hooks/domain-event-bus.js";
import { OutboundHookService } from "../src/hooks/outbound-hook.service.js";
import { SUBSCRIBABLE_EVENTS } from "../src/hooks/event-catalog.js";
import type { OutboundDispatcherService } from "../src/hooks/outbound-dispatcher.service.js";
import type { PrismaService } from "../src/prisma/prisma.service.js";

/**
 * Emisión y configuración de hooks salientes.
 *
 *  - `domainEvents.emit` arma el sobre estándar y no propaga errores de los
 *    suscriptores.
 *  - `fanOut` crea una entrega por hook ACTIVE suscrito al evento, del mismo
 *    tenant; nada más.
 *  - `create` cifra la credencial, devuelve el secreto de firma UNA vez y no
 *    lo expone en el hook público.
 */

process.env.TOKEN_ENCRYPTION_KEY_REF = "clave-de-pruebas";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

interface Row {
  [key: string]: unknown;
  id: string;
  tenantId: string;
  status: string;
  events: string[];
}

function makePrisma(hooks: Row[]) {
  const deliveries: Array<Record<string, unknown>> = [];
  const audit: Array<Record<string, unknown>> = [];
  let created: Record<string, unknown> | null = null;
  const prisma = {
    outboundHook: {
      findMany: async ({ where }: { where: { tenantId: string; status?: string; events?: { has: string } } }) =>
        hooks
          .filter(
            (h) =>
              h.tenantId === where.tenantId &&
              (!where.status || h.status === where.status) &&
              (!where.events || h.events.includes(where.events.has)),
          )
          .map((h) => ({ id: h.id })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created = data;
        return {
          id: "h-new",
          tenantId: data.tenantId,
          name: data.name,
          description: data.description,
          kind: data.kind,
          targetUrl: data.targetUrl,
          authType: data.authType,
          authHeaderName: data.authHeaderName,
          credential: data.credential,
          events: data.events,
          status: data.status,
          headers: data.headers,
          toolName: data.toolName,
          argsTemplate: data.argsTemplate ?? null,
          retryPolicy: data.retryPolicy,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
    outboundHookDelivery: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        deliveries.push(...data);
        return { count: data.length };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audit.push(data);
        return data;
      },
    },
  };
  return { prisma, deliveries, audit, created: () => created };
}

function makeService(hooks: Row[]) {
  const fake = makePrisma(hooks);
  const dispatcher = { dispatchNow: vi.fn() } as unknown as OutboundDispatcherService;
  const service = new OutboundHookService(fake.prisma as unknown as PrismaService, dispatcher);
  service.assertUrl = async (url) => new URL(url);
  return { service, ...fake };
}

describe("DomainEventBus", () => {
  it("arma el sobre estándar y avisa a los suscriptores", async () => {
    const bus = new DomainEventBus();
    const seen: unknown[] = [];
    const off = bus.subscribe((e) => {
      seen.push(e);
    });
    const now = new Date("2026-01-15T17:00:00.000Z");
    const event = await bus.emit(TENANT, "order.created", { orderId: "o-1" }, now);
    expect(event).toMatchObject({
      event: "order.created",
      tenantId: TENANT,
      occurredAt: "2026-01-15T17:00:00.000Z",
      data: { orderId: "o-1" },
      version: 1,
    });
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen).toEqual([event]);
    off();
    await bus.emit(TENANT, "order.created", {});
    expect(seen).toHaveLength(1);
  });

  it("un suscriptor que falla no rompe la emisión", async () => {
    const bus = new DomainEventBus();
    const after = vi.fn();
    bus.subscribe(() => {
      throw new Error("kaput");
    });
    bus.subscribe(after);
    await expect(bus.emit(TENANT, "quote.issued", {})).resolves.toBeDefined();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("el servicio se suscribe al bus global al arrancar y se da de baja al parar", async () => {
    const { service, deliveries } = makeService([
      { id: "h-1", tenantId: TENANT, status: "ACTIVE", events: ["quote.issued"] },
    ]);
    const before = domainEvents.size;
    service.onModuleInit();
    expect(domainEvents.size).toBe(before + 1);
    await domainEvents.emit(TENANT, "quote.issued", { quoteId: "q-1" });
    expect(deliveries).toHaveLength(1);
    service.onModuleDestroy();
    expect(domainEvents.size).toBe(before);
  });
});

describe("fanOut", () => {
  const hooks: Row[] = [
    { id: "h-sub", tenantId: TENANT, status: "ACTIVE", events: ["order.created", "order.paid"] },
    { id: "h-other-event", tenantId: TENANT, status: "ACTIVE", events: ["quote.issued"] },
    { id: "h-disabled", tenantId: TENANT, status: "DISABLED", events: ["order.created"] },
    { id: "h-other-tenant", tenantId: OTHER, status: "ACTIVE", events: ["order.created"] },
  ];

  it("crea una entrega solo para los hooks activos y suscritos del tenant", async () => {
    const { service, deliveries } = makeService(hooks);
    const bus = new DomainEventBus();
    bus.subscribe((e) => service.fanOut(e));
    const event = await bus.emit(TENANT, "order.created", { orderId: "o-1" });

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      tenantId: TENANT,
      hookId: "h-sub",
      eventName: "order.created",
      eventId: event.id,
      status: "PENDING",
      nextAttemptAt: new Date(event.occurredAt),
    });
    expect(deliveries[0]!.payload).toEqual(event);
  });

  it("sin hooks suscritos no escribe nada", async () => {
    const { service, deliveries } = makeService(hooks);
    expect(await service.fanOut(await new DomainEventBus().emit(TENANT, "customer.created", {}))).toBe(0);
    expect(deliveries).toHaveLength(0);
  });
});

describe("create", () => {
  it("cifra la credencial, devuelve el secreto una vez y no lo expone", async () => {
    const { service, created, audit } = makeService([]);
    const result = await service.create(TENANT, "u-1", {
      name: "ERP",
      kind: "REST",
      targetUrl: "https://erp.example.com/hook",
      authType: "BEARER",
      credential: "token-123",
      events: ["order.created"],
      headers: { "X-Custom": "1" },
      retryPolicy: { maxAttempts: 3, backoffSeconds: 10 },
    });

    expect(result.signingSecret).toMatch(/^whsec_[A-Za-z0-9_-]{40,}$/);
    const data = created()!;
    expect(data.credential).not.toBe("token-123");
    expect(decryptSecret(data.credential as string)).toBe("token-123");
    expect(decryptSecret(data.signingSecret as string)).toBe(result.signingSecret);
    expect(data.headers).toEqual({ "X-Custom": "1" });
    expect(data.retryPolicy).toEqual({ maxAttempts: 3, backoffSeconds: 10 });

    expect(result.hook).not.toHaveProperty("signingSecret");
    expect(result.hook).not.toHaveProperty("credential");
    expect(result.hook.hasCredential).toBe(true);
    expect(result.hook.retryPolicy).toEqual({ maxAttempts: 3, backoffSeconds: 10 });
    expect(audit[0]).toMatchObject({ tenantId: TENANT, actorId: "u-1", action: "hook.created", targetId: "h-new" });
  });

  it("exige credencial cuando la autenticación la necesita y toolName en MCP", async () => {
    const { service } = makeService([]);
    await expect(
      service.create(TENANT, null, {
        name: "x",
        kind: "REST",
        targetUrl: "https://erp.example.com/hook",
        authType: "API_KEY_HEADER",
        events: ["order.created"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(TENANT, null, {
        name: "x",
        kind: "MCP",
        targetUrl: "https://mcp.example.com/mcp",
        authType: "NONE",
        events: ["order.created"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(TENANT, null, {
        name: "x",
        kind: "REST",
        targetUrl: "https://erp.example.com/hook",
        authType: "NONE",
        events: ["order.created"],
        headers: { "Bad Header": "x" },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("el catálogo expone los eventos suscribibles con ejemplo", () => {
    const { service } = makeService([]);
    const events = service.events();
    expect(events.filter((e) => e.subscribable).map((e) => e.name)).toEqual([...SUBSCRIBABLE_EVENTS]);
    expect(events.find((e) => e.name === "ping")?.subscribable).toBe(false);
    for (const e of events) expect(e.example).toMatchObject({ event: e.name, version: 1 });
  });
});
