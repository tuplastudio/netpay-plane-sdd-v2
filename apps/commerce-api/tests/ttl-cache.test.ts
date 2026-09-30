import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/common/ttl-cache.js";

/**
 * `TtlCache` respalda las cachés de sesión y de API key: lo que se fija aquí
 * es que expira por entrada, respeta el tope de tamaño, no cachea negativos y
 * deduplica cargas concurrentes de la misma clave.
 */
function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, tick: (ms: number) => (now += ms) };
}

describe("TtlCache", () => {
  it("devuelve el valor mientras no venza y lo olvida al vencer", () => {
    const c = clock();
    const cache = new TtlCache<string, number>({ ttlMs: 100, now: c.now });
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    c.tick(99);
    expect(cache.get("a")).toBe(1);
    c.tick(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("acepta un TTL por entrada distinto al global", () => {
    const c = clock();
    const cache = new TtlCache<string, number>({ ttlMs: 100, now: c.now });
    cache.set("largo", 1, 1_000);
    c.tick(500);
    expect(cache.get("largo")).toBe(1);
  });

  it("expulsa la entrada más antigua al rebasar maxEntries", () => {
    const cache = new TtlCache<string, number>({ ttlMs: 1_000, maxEntries: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("reinsertar una clave la vuelve la más reciente", () => {
    const cache = new TtlCache<string, number>({ ttlMs: 1_000, maxEntries: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10);
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(10);
  });

  it("deleteWhere / clear / sweep", () => {
    const c = clock();
    const cache = new TtlCache<string, { user: string }>({ ttlMs: 100, now: c.now });
    cache.set("s1", { user: "ana" });
    cache.set("s2", { user: "ana" });
    cache.set("s3", { user: "beto" });
    expect(cache.deleteWhere((_k, v) => v.user === "ana")).toBe(2);
    expect(cache.size).toBe(1);
    c.tick(200);
    expect(cache.sweep()).toBe(1);
    cache.set("s4", { user: "x" });
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("getOrLoad: carga una vez, cachea el positivo y no cachea undefined", async () => {
    const cache = new TtlCache<string, string>({ ttlMs: 1_000 });
    let loads = 0;
    const loader = async () => {
      loads += 1;
      return "v";
    };
    expect(await cache.getOrLoad("k", loader)).toBe("v");
    expect(await cache.getOrLoad("k", loader)).toBe("v");
    expect(loads).toBe(1);

    let negatives = 0;
    const negative = async () => {
      negatives += 1;
      return undefined;
    };
    expect(await cache.getOrLoad("no", negative)).toBeUndefined();
    expect(await cache.getOrLoad("no", negative)).toBeUndefined();
    expect(negatives).toBe(2);
  });

  it("getOrLoad: cargas concurrentes de la misma clave comparten una sola carga", async () => {
    const cache = new TtlCache<string, number>({ ttlMs: 1_000 });
    let loads = 0;
    let release: (v: number) => void = () => undefined;
    const loader = () =>
      new Promise<number>((resolve) => {
        loads += 1;
        release = resolve;
      });
    const p1 = cache.getOrLoad("k", loader);
    const p2 = cache.getOrLoad("k", loader);
    const p3 = cache.getOrLoad("k", loader);
    release(7);
    expect(await Promise.all([p1, p2, p3])).toEqual([7, 7, 7]);
    expect(loads).toBe(1);
  });

  it("getOrLoad: si la carga falla, la siguiente vuelve a intentar", async () => {
    const cache = new TtlCache<string, number>({ ttlMs: 1_000 });
    let attempts = 0;
    const loader = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("db down");
      return 1;
    };
    await expect(cache.getOrLoad("k", loader)).rejects.toThrow("db down");
    expect(await cache.getOrLoad("k", loader)).toBe(1);
    expect(attempts).toBe(2);
  });

  it("rechaza un ttl inválido", () => {
    expect(() => new TtlCache({ ttlMs: 0 })).toThrow();
  });
});
