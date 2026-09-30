import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitMiddleware } from "../src/ops/security.middleware.js";

/**
 * Los buckets del rate limit global son por `ip|path` y antes no se
 * borraban nunca: cada URL distinta dejaba una entrada viva para siempre.
 * Se fija que, pasada la ventana, los vencidos se barren y el límite sigue
 * aplicando igual.
 */
function request(ip: string, path: string) {
  const headers: Record<string, string> = {};
  let status = 200;
  const req = { ip, path, headers: {} } as never;
  const res = {
    setHeader: (k: string, v: string) => (headers[k] = v),
    status: (s: number) => {
      status = s;
      return res;
    },
    json: () => res,
  };
  return { req, res: res as never, headers, status: () => status };
}

describe("RateLimitMiddleware", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function bucketCount(mw: RateLimitMiddleware): number {
    return (mw as unknown as { buckets: Map<string, unknown> }).buckets.size;
  }

  it("barre los buckets vencidos al cambiar de ventana", () => {
    const mw = new RateLimitMiddleware();
    for (let i = 0; i < 50; i++) {
      const r = request("10.0.0.1", `/api/v1/orders/public/tok-${i}`);
      mw.use(r.req, r.res, () => undefined);
    }
    expect(bucketCount(mw)).toBe(50);

    vi.advanceTimersByTime(61_000);
    const r = request("10.0.0.1", "/api/v1/orders");
    mw.use(r.req, r.res, () => undefined);
    // Quedan solo el nuevo (los 50 anteriores ya vencieron).
    expect(bucketCount(mw)).toBe(1);
  });

  it("sigue limitando a 120 por minuto por ip|path", () => {
    const mw = new RateLimitMiddleware();
    let passed = 0;
    let lastStatus = 200;
    for (let i = 0; i < 125; i++) {
      const r = request("10.0.0.2", "/api/v1/orders");
      mw.use(r.req, r.res, () => {
        passed += 1;
      });
      lastStatus = r.status();
    }
    expect(passed).toBe(120);
    expect(lastStatus).toBe(429);
  });
});
