import { describe, expect, it } from "vitest";
import { ConflictException } from "@nestjs/common";
import { LOCK_TTL_MS, computeNextRun, isDue, isValidCron, nextCronRun } from "../src/data-sources/schedule.js";
import { DataSourceSchedulerService } from "../src/data-sources/data-source-scheduler.service.js";
import type { DataSourceService } from "../src/data-sources/data-source.service.js";

const at = (iso: string) => new Date(iso);

describe("cron simple", () => {
  it("valida expresiones", () => {
    expect(isValidCron("*/15 * * * *")).toBe(true);
    expect(isValidCron("0 3 * * 1-5")).toBe(true);
    expect(isValidCron("0 3 * *")).toBe(false);
    expect(isValidCron("60 * * * *")).toBe(false);
    expect(isValidCron("a b c d e")).toBe(false);
  });

  it("calcula la siguiente ejecución estrictamente posterior", () => {
    expect(nextCronRun("*/15 * * * *", at("2026-09-29T10:07:30Z"))).toEqual(at("2026-09-29T10:15:00Z"));
    expect(nextCronRun("*/15 * * * *", at("2026-09-29T10:15:00Z"))).toEqual(at("2026-09-29T10:30:00Z"));
    expect(nextCronRun("0 3 * * *", at("2026-09-29T10:00:00Z"))).toEqual(at("2026-09-30T03:00:00Z"));
    // 2026-10-03 es sábado: lunes a viernes salta al lunes 5.
    expect(nextCronRun("30 6 * * 1-5", at("2026-10-02T07:00:00Z"))).toEqual(at("2026-10-05T06:30:00Z"));
    // Domingo como 7.
    expect(nextCronRun("0 0 * * 7", at("2026-10-01T00:00:00Z"))).toEqual(at("2026-10-04T00:00:00Z"));
    // Día 31 de un mes de 30 días: pasa al siguiente mes con 31.
    expect(nextCronRun("0 0 31 * *", at("2026-09-01T00:00:00Z"))).toEqual(at("2026-10-31T00:00:00Z"));
  });
});

describe("computeNextRun / isDue", () => {
  const now = at("2026-09-29T12:00:00Z");

  it("el cron manda sobre el intervalo; sin programación es solo manual", () => {
    expect(computeNextRun({ scheduleEveryMinutes: 30, scheduleCron: null }, now)).toEqual(at("2026-09-29T12:30:00Z"));
    expect(computeNextRun({ scheduleEveryMinutes: 30, scheduleCron: "0 * * * *" }, now)).toEqual(at("2026-09-29T13:00:00Z"));
    expect(computeNextRun({ scheduleEveryMinutes: null, scheduleCron: null }, now)).toBeNull();
  });

  it("solo vence lo ACTIVE/ERROR con nextRunAt pasado y sin lock vigente", () => {
    const base = { status: "ACTIVE", nextRunAt: at("2026-09-29T11:59:00Z"), lockedAt: null };
    expect(isDue(base, now)).toBe(true);
    expect(isDue({ ...base, status: "ERROR" }, now)).toBe(true);
    expect(isDue({ ...base, status: "PAUSED" }, now)).toBe(false);
    expect(isDue({ ...base, nextRunAt: at("2026-09-29T12:00:01Z") }, now)).toBe(false);
    expect(isDue({ ...base, nextRunAt: null }, now)).toBe(false);
    expect(isDue({ ...base, lockedAt: at("2026-09-29T11:50:00Z") }, now)).toBe(false);
    // Lock huérfano (más viejo que el TTL): vuelve a estar disponible.
    expect(isDue({ ...base, lockedAt: new Date(now.getTime() - LOCK_TTL_MS - 1) }, now)).toBe(true);
  });
});

describe("scheduler: tick", () => {
  function makeScheduler(due: Array<{ id: string; tenantId: string }>, failing: Set<string> = new Set()) {
    const triggered: string[] = [];
    const service = {
      findDue: async () => due,
      triggerSync: async (_tenantId: string, id: string, trigger: string) => {
        if (failing.has(id)) throw new ConflictException({ code: "CONFLICT", message: "en curso" });
        triggered.push(`${id}:${trigger}`);
        return { runId: `run-${id}` };
      },
    };
    return { scheduler: new DataSourceSchedulerService(service as unknown as DataSourceService), triggered };
  }

  it("lanza cada fuente vencida como SCHEDULE y tolera que otra réplica gane el lock", async () => {
    const { scheduler, triggered } = makeScheduler(
      [
        { id: "a", tenantId: "t1" },
        { id: "b", tenantId: "t1" },
        { id: "c", tenantId: "t2" },
      ],
      new Set(["b"]),
    );
    const tick = await scheduler.runOnce();
    expect(tick).toEqual({ due: 3, started: 2, skipped: 1 });
    expect(triggered).toEqual(["a:SCHEDULE", "c:SCHEDULE"]);
  });

  it("no encima dos ticks en el mismo proceso", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = {
      findDue: async () => {
        await gate;
        return [];
      },
      triggerSync: async () => ({ runId: "x" }),
    };
    const scheduler = new DataSourceSchedulerService(service as unknown as DataSourceService);
    const first = scheduler.runOnce();
    const second = await scheduler.runOnce();
    expect(second).toEqual({ due: 0, started: 0, skipped: 0 });
    release();
    expect(await first).toEqual({ due: 0, started: 0, skipped: 0 });
  });
});
