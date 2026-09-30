import { describe, expect, it } from "vitest";
import {
  BACKOFF_CAP_SECONDS,
  computeBackoffSeconds,
  DEFAULT_RETRY_POLICY,
  nextAttemptAt,
  parseRetryPolicy,
} from "../src/hooks/retry-policy.js";

describe("política de reintentos", () => {
  it("normaliza el JSON guardado con defaults y topes", () => {
    expect(parseRetryPolicy(null)).toEqual(DEFAULT_RETRY_POLICY);
    expect(parseRetryPolicy({})).toEqual(DEFAULT_RETRY_POLICY);
    expect(parseRetryPolicy({ maxAttempts: 3, backoffSeconds: 10 })).toEqual({ maxAttempts: 3, backoffSeconds: 10 });
    expect(parseRetryPolicy({ maxAttempts: 99, backoffSeconds: 1 })).toEqual({ maxAttempts: 10, backoffSeconds: 5 });
    expect(parseRetryPolicy({ maxAttempts: "x", backoffSeconds: "60" })).toEqual({ maxAttempts: 5, backoffSeconds: 60 });
  });

  it("backoff exponencial: base · 2^(intento-1), con tope de una hora", () => {
    const policy = { maxAttempts: 5, backoffSeconds: 30 };
    expect(computeBackoffSeconds(1, policy)).toBe(30);
    expect(computeBackoffSeconds(2, policy)).toBe(60);
    expect(computeBackoffSeconds(3, policy)).toBe(120);
    expect(computeBackoffSeconds(4, policy)).toBe(240);
    expect(computeBackoffSeconds(10, policy)).toBe(BACKOFF_CAP_SECONDS);
    expect(computeBackoffSeconds(0, policy)).toBe(30);
  });

  it("programa el siguiente intento a partir de `now`", () => {
    const now = new Date("2026-01-15T17:00:00.000Z");
    expect(nextAttemptAt(2, { maxAttempts: 5, backoffSeconds: 30 }, now).toISOString()).toBe(
      "2026-01-15T17:01:00.000Z",
    );
  });
});
