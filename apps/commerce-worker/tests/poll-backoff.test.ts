import { describe, expect, it } from "vitest";
import { POLL_IDLE_MAX_MS, POLL_MIN_MS, nextPollDelay } from "../src/poll-backoff.js";

/**
 * Sondeo del outbox: 1 s con trabajo, y se relaja duplicando hasta 5 s cuando
 * la cola viene vacía; una fila nueva lo regresa al mínimo.
 */
describe("nextPollDelay", () => {
  it("con trabajo vuelve al mínimo", () => {
    expect(nextPollDelay(POLL_IDLE_MAX_MS, true)).toBe(POLL_MIN_MS);
    expect(nextPollDelay(POLL_MIN_MS, true)).toBe(POLL_MIN_MS);
  });

  it("sin trabajo duplica hasta el tope", () => {
    expect(nextPollDelay(1_000, false)).toBe(2_000);
    expect(nextPollDelay(2_000, false)).toBe(4_000);
    expect(nextPollDelay(4_000, false)).toBe(POLL_IDLE_MAX_MS);
    expect(nextPollDelay(POLL_IDLE_MAX_MS, false)).toBe(POLL_IDLE_MAX_MS);
  });

  it("un valor por debajo del mínimo no lo baja más", () => {
    expect(nextPollDelay(0, false)).toBe(2_000);
  });
});
