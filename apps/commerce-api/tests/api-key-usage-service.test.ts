import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import {
  ApiKeyUsageService,
  decodeUsageCursor,
  encodeUsageCursor,
  fillDaySeries,
  statusFilterToRange,
} from "../src/auth/usage/api-key-usage.service.js";
import type { ApiKeyUsageEntry } from "../src/auth/usage/api-key-usage.buffer.js";

/**
 * Servicio de bitácora de uso: escritura en lote, throttle de `lastUsedAt`,
 * listado por cursor y resumen agregado. Prisma es un fake en memoria que
 * registra las llamadas; no hay base de datos.
 */

const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function entry(overrides: Partial<ApiKeyUsageEntry> = {}): ApiKeyUsageEntry {
  return {
    tenantId: "t1",
    apiKeyId: KEY,
    occurredAt: new Date("2026-09-29T12:00:00.000Z"),
    method: "GET",
    path: "/api/v1/products",
    statusCode: 200,
    durationMs: 12,
    ip: "10.0.0.1",
    userAgent: "vitest",
    scopeUsed: "catalog.read",
    errorCode: null,
    ...overrides,
  };
}

interface Call {
  method: string;
  args: unknown;
}

function makePrisma(rows: Array<Record<string, unknown>> = []) {
  const calls: Call[] = [];
  const prisma = {
    apiKey: {
      updateMany: async (args: unknown) => {
        calls.push({ method: "apiKey.updateMany", args });
        return { count: 1 };
      },
    },
    apiKeyUsage: {
      createMany: async (args: { data: ApiKeyUsageEntry[] }) => {
        calls.push({ method: "createMany", args });
        return { count: args.data.length };
      },
      deleteMany: async (args: unknown) => {
        calls.push({ method: "deleteMany", args });
        return { count: 7 };
      },
      findMany: async (args: { take: number }) => {
        calls.push({ method: "findMany", args });
        return rows.slice(0, args.take);
      },
      count: async (args: { where: { statusCode?: unknown; occurredAt: { gte: Date; lte: Date } } }) => {
        calls.push({ method: "count", args });
        if (args.where.statusCode) return 3;
        // La ventana de 7 días es la más ancha que pide el resumen (days=3 en
        // el test): se distingue por su anchura, no por el reloj real.
        const width = args.where.occurredAt.lte.getTime() - args.where.occurredAt.gte.getTime();
        return width >= 7 * 86_400_000 ? 5 : 20;
      },
      aggregate: async () => ({ _avg: { durationMs: 41.6 } }),
      findFirst: async () => ({ occurredAt: new Date("2026-09-29T11:59:00.000Z"), ip: "10.0.0.9" }),
      groupBy: async (args: { by: string[]; where: { statusCode?: unknown } }) => {
        calls.push({ method: "groupBy", args });
        if (args.by[0] === "statusCode") {
          return [
            { statusCode: 200, _count: { _all: 17 } },
            { statusCode: 404, _count: { _all: 3 } },
          ];
        }
        if (args.where.statusCode) {
          return [{ method: "GET", path: "/api/v1/orders/:id", _count: { _all: 3 } }];
        }
        return [
          { method: "GET", path: "/api/v1/products", _count: { _all: 12 } },
          { method: "GET", path: "/api/v1/orders/:id", _count: { _all: 8 } },
        ];
      },
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      calls.push({ method: "$queryRaw", args: sql });
      if (sql.includes("COUNT(DISTINCT")) return [{ ips: 2n }];
      return [{ day: "2026-09-29", total: 15n, errors: 3n }, { day: "2026-09-27", total: 5n, errors: 0n }];
    },
  };
  return { prisma, calls };
}

describe("ApiKeyUsageService: escritura y lastUsedAt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("record() no escribe en el acto; flush() manda el lote en un createMany", async () => {
    const { prisma, calls } = makePrisma();
    const service = new ApiKeyUsageService(prisma as never);
    service.record(entry({ durationMs: 1 }));
    service.record(entry({ durationMs: 2 }));
    expect(calls.filter((c) => c.method === "createMany")).toHaveLength(0);
    await service.flush();
    const writes = calls.filter((c) => c.method === "createMany");
    expect(writes).toHaveLength(1);
    expect((writes[0]!.args as { data: ApiKeyUsageEntry[] }).data.map((e) => e.durationMs)).toEqual([1, 2]);
  });

  it("lastUsedAt se actualiza una vez por minuto por key, no por petición", async () => {
    const { prisma, calls } = makePrisma();
    const service = new ApiKeyUsageService(prisma as never);
    const t0 = new Date("2026-09-29T12:00:00.000Z");
    service.record(entry({ occurredAt: t0 }));
    service.record(entry({ occurredAt: new Date(t0.getTime() + 10_000) }));
    service.record(entry({ occurredAt: new Date(t0.getTime() + 59_000) }));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter((c) => c.method === "apiKey.updateMany")).toHaveLength(1);
    expect(calls[0]!.args).toEqual({ where: { id: KEY }, data: { lastUsedAt: t0 } });

    service.record(entry({ occurredAt: new Date(t0.getTime() + 60_000) }));
    service.record(entry({ apiKeyId: "other", occurredAt: new Date(t0.getTime() + 60_000) }));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter((c) => c.method === "apiKey.updateMany")).toHaveLength(3);
    await service.onModuleDestroy();
  });

  it("onModuleDestroy vacía lo pendiente (shutdown limpio)", async () => {
    const { prisma, calls } = makePrisma();
    const service = new ApiKeyUsageService(prisma as never);
    service.record(entry());
    await service.onModuleDestroy();
    expect(calls.filter((c) => c.method === "createMany")).toHaveLength(1);
  });

  it("purgeOlderThan borra por fecha de corte y devuelve el conteo", async () => {
    const { prisma, calls } = makePrisma();
    const service = new ApiKeyUsageService(prisma as never);
    vi.setSystemTime(new Date("2026-09-29T00:00:00.000Z"));
    const deleted = await service.purgeOlderThan(90);
    expect(deleted).toBe(7);
    expect(calls[0]).toEqual({
      method: "deleteMany",
      args: { where: { occurredAt: { lt: new Date("2026-07-01T00:00:00.000Z") } } },
    });
  });

  it("la retención sale de API_KEY_USAGE_RETENTION_DAYS con default 90", () => {
    const { prisma } = makePrisma();
    const service = new ApiKeyUsageService(prisma as never);
    const prev = process.env.API_KEY_USAGE_RETENTION_DAYS;
    delete process.env.API_KEY_USAGE_RETENTION_DAYS;
    expect(service.retentionDays()).toBe(90);
    process.env.API_KEY_USAGE_RETENTION_DAYS = "30";
    expect(service.retentionDays()).toBe(30);
    process.env.API_KEY_USAGE_RETENTION_DAYS = "abc";
    expect(service.retentionDays()).toBe(90);
    if (prev === undefined) delete process.env.API_KEY_USAGE_RETENTION_DAYS;
    else process.env.API_KEY_USAGE_RETENTION_DAYS = prev;
  });
});

describe("ApiKeyUsageService.list: cursor y filtros", () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({
    id: `id-${9 - i}`,
    occurredAt: new Date(Date.UTC(2026, 8, 29, 12, 0, 59 - i)),
    path: "/api/v1/products",
    statusCode: 200,
  }));

  it("pide limit+1 y devuelve nextCursor solo cuando hay más", async () => {
    const { prisma, calls } = makePrisma(rows);
    const service = new ApiKeyUsageService(prisma as never);
    const page = await service.list(KEY, { limit: 3 });
    expect((calls[0]!.args as { take: number }).take).toBe(4);
    expect(page.items).toHaveLength(3);
    expect(page.pageInfo.nextCursor).toBe(encodeUsageCursor(rows[2]!));

    const last = await service.list(KEY, { limit: 10 });
    expect(last.pageInfo.nextCursor).toBeNull();
  });

  it("traduce cursor, path y status al where", async () => {
    const { prisma, calls } = makePrisma(rows);
    const service = new ApiKeyUsageService(prisma as never);
    const cursor = encodeUsageCursor(rows[1]!);
    await service.list(KEY, { cursor, path: "products", status: "4xx", from: new Date("2026-09-01T00:00:00Z") });
    const where = (calls[0]!.args as { where: Record<string, unknown> }).where;
    expect(where.apiKeyId).toBe(KEY);
    expect(where.path).toEqual({ contains: "products" });
    expect(where.statusCode).toEqual({ gte: 400, lt: 500 });
    expect(where.occurredAt).toEqual({ gte: new Date("2026-09-01T00:00:00Z") });
    expect(where.AND).toEqual([
      {
        OR: [
          { occurredAt: { lt: rows[1]!.occurredAt } },
          { occurredAt: rows[1]!.occurredAt, id: { lt: rows[1]!.id } },
        ],
      },
    ]);
  });

  it("un cursor corrupto responde 400", async () => {
    const { prisma } = makePrisma(rows);
    const service = new ApiKeyUsageService(prisma as never);
    await expect(service.list(KEY, { cursor: "%%%" })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("ApiKeyUsageService.summary: agregación", () => {
  it("arma totales, serie diaria rellena, rutas con errores y status", async () => {
    const { prisma } = makePrisma();
    const service = new ApiKeyUsageService(prisma as never);
    const now = new Date("2026-09-29T20:00:00.000Z");
    const summary = await service.summary(KEY, 3, now);

    expect(summary.days).toBe(3);
    expect(summary.totals).toEqual({ requests: 20, errors: 3, requests7d: 5, avgDurationMs: 42 });
    expect(summary.lastUsedAt).toBe("2026-09-29T11:59:00.000Z");
    expect(summary.lastIp).toBe("10.0.0.9");
    expect(summary.distinctIps).toBe(2);
    expect(summary.byDay).toEqual([
      { day: "2026-09-27", total: 5, errors: 0 },
      { day: "2026-09-28", total: 0, errors: 0 },
      { day: "2026-09-29", total: 15, errors: 3 },
    ]);
    expect(summary.byPath).toEqual([
      { method: "GET", path: "/api/v1/products", count: 12, errors: 0 },
      { method: "GET", path: "/api/v1/orders/:id", count: 8, errors: 3 },
    ]);
    expect(summary.byStatus).toEqual([
      { statusCode: 200, count: 17 },
      { statusCode: 404, count: 3 },
    ]);
  });

  it("acota days a [1, 365]", async () => {
    const { prisma } = makePrisma();
    const service = new ApiKeyUsageService(prisma as never);
    expect((await service.summary(KEY, 0)).days).toBe(1);
    expect((await service.summary(KEY, 9_999)).days).toBe(365);
  });
});

describe("helpers puros", () => {
  it("cursor: ida y vuelta, y rechaza basura", () => {
    const row = { occurredAt: new Date("2026-09-29T12:00:00.123Z"), id: "abc" };
    expect(decodeUsageCursor(encodeUsageCursor(row))).toEqual(row);
    expect(decodeUsageCursor("")).toBeNull();
    expect(decodeUsageCursor(Buffer.from("no-sep").toString("base64url"))).toBeNull();
    expect(decodeUsageCursor(Buffer.from("not-a-date|id").toString("base64url"))).toBeNull();
  });

  it("statusFilterToRange: código exacto o clase", () => {
    expect(statusFilterToRange("404")).toEqual({ gte: 404, lt: 405 });
    expect(statusFilterToRange("5xx")).toEqual({ gte: 500, lt: 600 });
    expect(statusFilterToRange("2XX")).toEqual({ gte: 200, lt: 300 });
    expect(() => statusFilterToRange("ok")).toThrow(BadRequestException);
  });

  it("fillDaySeries rellena con ceros los días sin tráfico, en la zona del portal", () => {
    // 2026-09-30T04:30Z todavía es 29 de septiembre en Ciudad de México.
    const now = new Date("2026-09-30T04:30:00.000Z");
    const series = fillDaySeries([{ day: "2026-09-28", total: 2, errors: 1 }], 3, now);
    expect(series).toEqual([
      { day: "2026-09-27", total: 0, errors: 0 },
      { day: "2026-09-28", total: 2, errors: 1 },
      { day: "2026-09-29", total: 0, errors: 0 },
    ]);
  });
});
