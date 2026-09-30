import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { ApiKeyUsageMiddleware } from "../src/auth/usage/api-key-usage.middleware.js";
import type { ApiKeyUsageEntry } from "../src/auth/usage/api-key-usage.buffer.js";
import { RequestContext } from "../src/common/context/request-context.js";

/**
 * El middleware engancha `finish` ANTES de que exista el principal (lo fija
 * PrincipalGuard después) y lo lee al terminar la respuesta, conservando el
 * contexto de la petición. Aquí se simula ese orden: middleware → guard →
 * handler → finish.
 */

function makeReq(headers: Record<string, string>, url = "/api/v1/products/42?x=1") {
  return { headers, method: "GET", originalUrl: url, url, ip: "203.0.113.7" };
}

function makeRes(statusCode: number) {
  const res = new EventEmitter() as EventEmitter & { statusCode: number };
  res.statusCode = statusCode;
  return res;
}

function run(headers: Record<string, string>, statusCode: number, setPrincipal: () => void) {
  const recorded: ApiKeyUsageEntry[] = [];
  const middleware = new ApiKeyUsageMiddleware({ record: (e: ApiKeyUsageEntry) => recorded.push(e) } as never);
  const res = makeRes(statusCode);
  let nextCalled = false;
  RequestContext.run(
    () => {
      middleware.use(makeReq(headers) as never, res as never, () => {
        nextCalled = true;
      });
      // Lo que harían PrincipalGuard/RoleGuard después del middleware.
      setPrincipal();
    },
    { requestId: "req-1" },
  );
  // `finish` lo emite Node fuera del run(): el listener debe seguir viendo el store.
  res.emit("finish");
  return { recorded, nextCalled, listeners: res.listenerCount("finish") };
}

describe("ApiKeyUsageMiddleware", () => {
  it("registra la petición con el principal fijado por el guard después del middleware", () => {
    const { recorded, nextCalled } = run({ authorization: "Bearer npk_abc_def", "user-agent": "curl/8" }, 404, () => {
      RequestContext.setPrincipal({ type: "API_KEY", tenantId: "t1", apiKeyId: "k1", scopes: ["catalog.read"] });
      RequestContext.setRequiredScopes(["catalog.read"]);
    });
    expect(nextCalled).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      tenantId: "t1",
      apiKeyId: "k1",
      method: "GET",
      path: "/api/v1/products/:id",
      statusCode: 404,
      ip: "203.0.113.7",
      userAgent: "curl/8",
      scopeUsed: "catalog.read",
      errorCode: "NOT_FOUND",
    });
    expect(recorded[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(recorded[0]!.occurredAt).toBeInstanceOf(Date);
  });

  it("una key global sin X-Tenant-Id se registra con tenantId null", () => {
    const { recorded } = run({ authorization: "Bearer npk_abc_def" }, 200, () => {
      RequestContext.setPrincipal({ type: "API_KEY", apiKeyId: "kg", scopes: [], isSuperAdmin: true });
    });
    expect(recorded[0]).toMatchObject({ tenantId: null, apiKeyId: "kg", errorCode: null, scopeUsed: null });
  });

  it("sin Bearer de API key ni siquiera engancha el listener (sesiones cookie)", () => {
    const { recorded, nextCalled, listeners } = run({ cookie: "session=abc" }, 200, () => {
      RequestContext.setPrincipal({ type: "USER", userId: "u1", tenantId: "t1", role: "OWNER" });
    });
    expect(nextCalled).toBe(true);
    expect(listeners).toBe(0);
    expect(recorded).toHaveLength(0);
  });

  it("una key inválida (el guard no fijó principal) no deja rastro", () => {
    const { recorded } = run({ authorization: "Bearer npk_bad_key" }, 401, () => undefined);
    expect(recorded).toHaveLength(0);
  });
});
