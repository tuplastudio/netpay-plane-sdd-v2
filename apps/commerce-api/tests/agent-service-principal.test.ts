import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveAgentServicePrincipal } from "../src/auth/guards/principal.guard.js";

describe("agent service tenant assertion", () => {
  const secret = "shared-secret";
  const timestamp = "1700000000";
  const now = Number(timestamp) * 1000;

  function headers(tenantId: string) {
    return {
      "x-agent-tenant": tenantId,
      "x-agent-timestamp": timestamp,
      "x-agent-signature": createHmac("sha256", secret)
        .update(`${timestamp}.${tenantId}`)
        .digest("hex"),
    };
  }

  it("binds the authenticated service principal to the signed tenant", () => {
    const principal = resolveAgentServicePrincipal(headers("tenant-a"), secret, now);
    expect(principal?.type).toBe("SERVICE");
    expect(principal?.tenantId).toBe("tenant-a");
    expect(principal?.scopes).toContain("catalog.read");
  });

  it("rejects changing the tenant without recomputing the signature", () => {
    expect(
      resolveAgentServicePrincipal({ ...headers("tenant-a"), "x-agent-tenant": "tenant-b" }, secret, now),
    ).toBeNull();
  });

  it("rejects expired assertions", () => {
    expect(resolveAgentServicePrincipal(headers("tenant-a"), secret, now + 61_000)).toBeNull();
  });
});
