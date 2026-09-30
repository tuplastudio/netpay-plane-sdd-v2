import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { isWriteAction, writeNotifierMiddleware } from "../src/prisma/prisma.service.js";

/**
 * El middleware de escrituras es el único punto por el que pasan TODAS las
 * mutaciones (también dentro de `$transaction`): las cachés con TTL dependen
 * de que avise solo tras una escritura exitosa y solo a quien se suscribió
 * al modelo tocado.
 */
function params(model: string | undefined, action: string, args?: unknown): Prisma.MiddlewareParams {
  return { model, action, args, dataPath: [], runInTransaction: false } as unknown as Prisma.MiddlewareParams;
}

describe("isWriteAction", () => {
  it("distingue mutaciones de lecturas", () => {
    for (const a of ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]) {
      expect(isWriteAction(a)).toBe(true);
    }
    for (const a of ["findUnique", "findMany", "findFirst", "count", "aggregate", "groupBy", "queryRaw"]) {
      expect(isWriteAction(a)).toBe(false);
    }
  });
});

describe("writeNotifierMiddleware", () => {
  it("avisa solo a los suscritos al modelo, después de la escritura, con los args", async () => {
    const seen: string[] = [];
    const subs = [
      { models: new Set(["Session"]), listener: (e: { model: string; action: string }) => seen.push(`S:${e.model}.${e.action}`) },
      { models: new Set(["Order"]), listener: (e: { model: string; action: string }) => seen.push(`O:${e.model}.${e.action}`) },
    ];
    const mw = writeNotifierMiddleware(() => subs);
    let executed = false;
    const result = await mw(params("Session", "updateMany", { data: { revokedAt: new Date() } }), async () => {
      executed = true;
      expect(seen).toEqual([]);
      return { count: 1 };
    });
    expect(executed).toBe(true);
    expect(result).toEqual({ count: 1 });
    expect(seen).toEqual(["S:Session.updateMany"]);
  });

  it("no avisa en lecturas ni en operaciones sin modelo", async () => {
    const seen: string[] = [];
    const mw = writeNotifierMiddleware(() => [
      { models: new Set(["Session"]), listener: (e: { model: string }) => seen.push(e.model) },
    ]);
    await mw(params("Session", "findUnique"), async () => null);
    await mw(params(undefined, "executeRaw"), async () => 1);
    expect(seen).toEqual([]);
  });

  it("si la escritura falla no avisa; si el listener falla la escritura sigue bien", async () => {
    const seen: string[] = [];
    const mw = writeNotifierMiddleware(() => [
      {
        models: new Set(["Session"]),
        listener: () => {
          seen.push("called");
          throw new Error("cache boom");
        },
      },
    ]);
    await expect(
      mw(params("Session", "update"), async () => {
        throw new Error("db down");
      }),
    ).rejects.toThrow("db down");
    expect(seen).toEqual([]);

    const ok = await mw(params("Session", "update"), async () => "row");
    expect(ok).toBe("row");
    expect(seen).toEqual(["called"]);
  });
});
