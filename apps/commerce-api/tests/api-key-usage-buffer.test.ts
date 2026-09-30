import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiKeyUsageBuffer,
  LastUsedThrottle,
  type ApiKeyUsageEntry,
} from "../src/auth/usage/api-key-usage.buffer.js";

/**
 * Buffer de la bitácora de uso: la petición nunca espera a la base. Se vacía
 * por tamaño, por tiempo o en shutdown, y un fallo del escritor descarta el
 * lote sin propagar.
 */

function entry(n: number): ApiKeyUsageEntry {
  return {
    tenantId: "t1",
    apiKeyId: "k1",
    occurredAt: new Date(1_700_000_000_000 + n),
    method: "GET",
    path: "/api/v1/products",
    statusCode: 200,
    durationMs: n,
    ip: "10.0.0.1",
    userAgent: "vitest",
    scopeUsed: "catalog.read",
    errorCode: null,
  };
}

describe("ApiKeyUsageBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("vacía por tamaño sin esperar al temporizador", async () => {
    const batches: ApiKeyUsageEntry[][] = [];
    const buffer = new ApiKeyUsageBuffer(async (b) => void batches.push(b), { maxSize: 3, flushIntervalMs: 60_000 });
    buffer.push(entry(1));
    buffer.push(entry(2));
    expect(batches).toHaveLength(0);
    buffer.push(entry(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((e) => e.durationMs)).toEqual([1, 2, 3]);
    expect(buffer.size).toBe(0);
  });

  it("vacía por tiempo cuando no se llena", async () => {
    const batches: ApiKeyUsageEntry[][] = [];
    const buffer = new ApiKeyUsageBuffer(async (b) => void batches.push(b), { maxSize: 100, flushIntervalMs: 5_000 });
    buffer.push(entry(1));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(batches).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
  });

  it("stop() escribe lo pendiente y deja de aceptar registros", async () => {
    const batches: ApiKeyUsageEntry[][] = [];
    const buffer = new ApiKeyUsageBuffer(async (b) => void batches.push(b));
    buffer.push(entry(1));
    buffer.push(entry(2));
    await buffer.stop();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    buffer.push(entry(3));
    expect(buffer.size).toBe(0);
  });

  it("un fallo del escritor descarta el lote, avisa y no rompe el siguiente", async () => {
    const errors: Array<{ dropped: number }> = [];
    let fail = true;
    const batches: ApiKeyUsageEntry[][] = [];
    const buffer = new ApiKeyUsageBuffer(
      async (b) => {
        if (fail) throw new Error("db down");
        batches.push(b);
      },
      { maxSize: 2, onError: (_e, dropped) => errors.push({ dropped }) },
    );
    buffer.push(entry(1));
    buffer.push(entry(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toEqual([{ dropped: 2 }]);
    fail = false;
    buffer.push(entry(3));
    await buffer.flush();
    expect(batches).toEqual([[entry(3)]]);
  });

  it("con la base caída no acumula memoria sin límite: descarta lo más viejo", async () => {
    const buffer = new ApiKeyUsageBuffer(
      async () => {
        throw new Error("db down");
      },
      { maxSize: 1_000, maxPending: 3, flushIntervalMs: 60_000 },
    );
    for (let i = 1; i <= 5; i += 1) buffer.push(entry(i));
    expect(buffer.size).toBe(3);
  });

  it("serializa los vaciados: un flush durante otro en vuelo espera y no duplica", async () => {
    const batches: ApiKeyUsageEntry[][] = [];
    let release: () => void = () => undefined;
    const buffer = new ApiKeyUsageBuffer(
      (b) =>
        new Promise<void>((resolve) => {
          batches.push(b);
          release = resolve;
        }),
    );
    buffer.push(entry(1));
    const first = buffer.flush();
    buffer.push(entry(2));
    const second = buffer.flush();
    expect(batches).toHaveLength(1);
    release();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    release();
    await second;
    expect(batches.map((b) => b.map((e) => e.durationMs))).toEqual([[1], [2]]);
  });
});

describe("LastUsedThrottle", () => {
  it("permite una actualización por key y por minuto", () => {
    const t = new LastUsedThrottle(60_000);
    expect(t.shouldTouch("k1", 0)).toBe(true);
    expect(t.shouldTouch("k1", 30_000)).toBe(false);
    expect(t.shouldTouch("k1", 59_999)).toBe(false);
    expect(t.shouldTouch("k1", 60_000)).toBe(true);
    expect(t.shouldTouch("k1", 60_001)).toBe(false);
  });

  it("las keys son independientes entre sí", () => {
    const t = new LastUsedThrottle(60_000);
    expect(t.shouldTouch("k1", 0)).toBe(true);
    expect(t.shouldTouch("k2", 0)).toBe(true);
    expect(t.shouldTouch("k1", 1)).toBe(false);
  });

  it("acota el mapa desechando la entrada más vieja", () => {
    const t = new LastUsedThrottle(60_000, 2);
    expect(t.shouldTouch("k1", 0)).toBe(true);
    expect(t.shouldTouch("k2", 1)).toBe(true);
    expect(t.shouldTouch("k3", 2)).toBe(true);
    // k1 salió del mapa: vuelve a permitirse aunque no haya pasado el minuto.
    expect(t.shouldTouch("k1", 3)).toBe(true);
  });
});
