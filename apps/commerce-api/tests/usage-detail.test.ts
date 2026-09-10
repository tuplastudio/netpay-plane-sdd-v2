import { describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { UsageService, mapUsageDetailRows } from "../src/usage/usage.service.js";

/**
 * `GET /super-admin/usage/detail?tenantId&from&to` (drill-down día × modelo).
 *
 * Lo que se fija aquí:
 *  - La agregación se hace en la base (`$queryRaw` con GROUP BY): el doble no
 *    implementa `agentUsageEvent.findMany`, así que sumar filas en JS revienta.
 *  - La consulta va acotada al tenant y al rango pedido, y agrupa por la fecha
 *    local del tenant (`Tenant.timezone`), con caída a America/Mexico_City si
 *    el valor guardado no es una zona IANA válida.
 *  - Los enteros salen como `number` aunque Postgres devuelva bigint, y el
 *    costo como string decimal de 6 posiciones, igual que `summaryForTenant`.
 *  - Un tenant inexistente es 404, no "sin consumo".
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const D = (v: string) => new Prisma.Decimal(v);

function makeFakePrisma(opts: { timezone?: string | null; tenantExists?: boolean } = {}) {
  const calls: string[] = [];
  let lastSql: Prisma.Sql | undefined;
  const prisma = {
    tenant: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        calls.push("tenant.findUnique");
        if (opts.tenantExists === false || where.id !== TENANT) return null;
        return { id: TENANT, timezone: opts.timezone === undefined ? "America/Mexico_City" : opts.timezone };
      },
    },
    agentUsageEvent: {
      findMany: () => {
        throw new Error("no se permiten listados: agrega en la base");
      },
    },
    $queryRaw(sql: Prisma.Sql) {
      calls.push("$queryRaw");
      lastSql = sql;
      return Promise.resolve([
        { day: "2026-09-01", model: "gpt-4o-mini", events: 2n, inputTokens: 1000n, outputTokens: 500n, costUsd: D("0.012345") },
        { day: "2026-09-01", model: "gpt-4o", events: 1n, inputTokens: 300n, outputTokens: 100n, costUsd: D("0.05") },
        { day: "2026-09-02", model: "gpt-4o-mini", events: 3n, inputTokens: 2000n, outputTokens: 900n, costUsd: D("0.02") },
      ]);
    },
  };
  return { prisma, calls, sql: () => lastSql };
}

describe("UsageService.detailForTenant", () => {
  it("agrega en la base y normaliza tipos (bigint → number, Decimal → string)", async () => {
    const fake = makeFakePrisma();
    const svc = new UsageService(fake.prisma as never);
    const out = await svc.detailForTenant(TENANT, "2026-09-01T00:00:00Z", "2026-09-30T23:59:59Z");

    expect(fake.calls).toEqual(["tenant.findUnique", "$queryRaw"]);
    expect(out.timeZone).toBe("America/Mexico_City");
    expect(out.byDayAndModel).toEqual([
      { day: "2026-09-01", model: "gpt-4o-mini", events: 2, inputTokens: 1000, outputTokens: 500, costUsd: "0.012345" },
      { day: "2026-09-01", model: "gpt-4o", events: 1, inputTokens: 300, outputTokens: 100, costUsd: "0.050000" },
      { day: "2026-09-02", model: "gpt-4o-mini", events: 3, inputTokens: 2000, outputTokens: 900, costUsd: "0.020000" },
    ]);
    expect(out.totalCostUsd).toBe("0.082345");
    expect(out.totalTokens).toBe(4800);
    expect(out.from).toEqual(new Date("2026-09-01T00:00:00Z"));
    expect(out.to).toEqual(new Date("2026-09-30T23:59:59Z"));
  });

  it("acota la consulta al tenant, al rango y a la zona horaria del tenant", async () => {
    const fake = makeFakePrisma({ timezone: "America/Monterrey" });
    await new UsageService(fake.prisma as never).detailForTenant(TENANT, "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z");
    const sql = fake.sql();
    expect(sql).toBeDefined();
    const text = sql!.strings.join("?");
    expect(text).toMatch(/"tenantId" = \?::uuid/);
    expect(text).toMatch(/AT TIME ZONE \?::text/);
    expect(text).toMatch(/GROUP BY/);
    expect(sql!.values).toEqual([
      "America/Monterrey",
      TENANT,
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-09-02T00:00:00Z"),
    ]);
  });

  it("cae a America/Mexico_City si la zona del tenant no es IANA válida", async () => {
    for (const bad of ["", "Marte/Olympus", "'; DROP TABLE x; --", null]) {
      const fake = makeFakePrisma({ timezone: bad });
      const out = await new UsageService(fake.prisma as never).detailForTenant(TENANT);
      expect(out.timeZone).toBe("America/Mexico_City");
      expect(fake.sql()!.values[0]).toBe("America/Mexico_City");
    }
  });

  it("404 si la empresa no existe (no se consulta el consumo)", async () => {
    const fake = makeFakePrisma({ tenantExists: false });
    await expect(new UsageService(fake.prisma as never).detailForTenant(TENANT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fake.calls).toEqual(["tenant.findUnique"]);
  });

  it("from/to inválidos son 400 antes de tocar la base", async () => {
    const fake = makeFakePrisma();
    await expect(
      new UsageService(fake.prisma as never).detailForTenant(TENANT, "ayer"),
    ).rejects.toMatchObject({ status: 400 });
    expect(fake.calls).toEqual([]);
  });
});

describe("mapUsageDetailRows", () => {
  it("tolera nulos de SUM y cost como number o string", () => {
    expect(
      mapUsageDetailRows([
        { day: "2026-09-03", model: "m", events: 0, inputTokens: null, outputTokens: null, costUsd: null },
        { day: "2026-09-04", model: "m", events: 1, inputTokens: 5, outputTokens: 7, costUsd: "0.1" },
        { day: "2026-09-05", model: "m", events: 1, inputTokens: 5, outputTokens: 7, costUsd: 0.25 },
      ]),
    ).toEqual([
      { day: "2026-09-03", model: "m", events: 0, inputTokens: 0, outputTokens: 0, costUsd: "0.000000" },
      { day: "2026-09-04", model: "m", events: 1, inputTokens: 5, outputTokens: 7, costUsd: "0.100000" },
      { day: "2026-09-05", model: "m", events: 1, inputTokens: 5, outputTokens: 7, costUsd: "0.250000" },
    ]);
  });
});
