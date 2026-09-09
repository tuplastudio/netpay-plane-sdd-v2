import { describe, expect, it } from "vitest";
import { RequestContext } from "../src/common/context/request-context.js";

/**
 * El tenant y el principal vienen del contexto de la petición, nunca del body
 * (T-FND-05). Fuera de una petición el contexto está vacío, no "abierto".
 */

describe("RequestContext", () => {
  it("aísla el principal por petición", () => {
    RequestContext.run(() => {
      RequestContext.setPrincipal({ type: "USER", userId: "u1", tenantId: "t1", role: "OWNER" });
      expect(RequestContext.tenantId).toBe("t1");
      expect(RequestContext.userId).toBe("u1");
    });

    RequestContext.run(() => {
      expect(RequestContext.principal.type).toBe("ANONYMOUS");
      expect(RequestContext.tenantId).toBeUndefined();
    });
  });

  it("un principal de API key no tiene userId", () => {
    RequestContext.run(() => {
      RequestContext.setPrincipal({
        type: "API_KEY",
        tenantId: "t1",
        scopes: ["quotes.write"],
        apiKeyId: "k1",
      });
      expect(RequestContext.userId).toBeUndefined();
      expect(RequestContext.tenantId).toBe("t1");
    });
  });

  it("fuera de una petición no hay tenant", () => {
    expect(RequestContext.tenantId).toBeUndefined();
    expect(RequestContext.principal.type).toBe("ANONYMOUS");
  });
});
