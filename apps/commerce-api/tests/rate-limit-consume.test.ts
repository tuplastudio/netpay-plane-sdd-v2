import { describe, expect, it } from "vitest";
import { RateLimitService } from "../src/auth/rate-limit.service.js";

/**
 * El throttling de forgot-password es silencioso: debe contar pero NO bloquear
 * como hace `recordFailure` para login (que grow hasta deny). Aquí un spike
 * devuelve `false` y el caller decide no emitir token, manteniendo la
 * respuesta uniforme.
 */
describe("RateLimitService.consume — throttling silencioso", () => {
  it("permite hasta el límite, luego rechaza", () => {
    const rl = new RateLimitService();
    expect(rl.consume("k", 3, 60_000)).toBe(true);
    expect(rl.consume("k", 3, 60_000)).toBe(true);
    expect(rl.consume("k", 3, 60_000)).toBe(true);
    expect(rl.consume("k", 3, 60_000)).toBe(false);
  });

  it("resetea cuando expira la ventana", async () => {
    const rl = new RateLimitService();
    expect(rl.consume("k", 1, 1)).toBe(true);
    expect(rl.consume("k", 1, 1)).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    expect(rl.consume("k", 1, 1)).toBe(true);
  });

  it("keys distintas no comparten bucket", () => {
    const rl = new RateLimitService();
    expect(rl.consume("a", 1, 60_000)).toBe(true);
    expect(rl.consume("b", 1, 60_000)).toBe(true);
    expect(rl.consume("a", 1, 60_000)).toBe(false);
    expect(rl.consume("b", 1, 60_000)).toBe(false);
  });
});