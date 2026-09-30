import { describe, expect, it, beforeAll } from "vitest";

describe("AccessTokenService", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test_jwt_secret_at_least_32_characters_long";
  });

  it("signs and verifies a real token round-trip (no mocks)", async () => {
    const { AccessTokenService } = await import("../src/auth/jwt.service.js");
    const service = new AccessTokenService();

    const { token, jti, expiresAt } = await service.sign({
      userId: "user-1",
      sessionId: "session-1",
      tenantId: "tenant-1",
      role: "OWNER",
      isSuperAdmin: false,
    });

    expect(typeof token).toBe("string");
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const claims = await service.verify(token);
    expect(claims.sub).toBe("user-1");
    expect(claims.sid).toBe("session-1");
    expect(claims.tid).toBe("tenant-1");
    expect(claims.role).toBe("OWNER");
    expect(claims.sup).toBe(false);
    expect(claims.jti).toBe(jti);
  });

  it("rejects a tampered token", async () => {
    const { AccessTokenService } = await import("../src/auth/jwt.service.js");
    const service = new AccessTokenService();
    const { token } = await service.sign({
      userId: "user-1",
      sessionId: "session-1",
      tenantId: "tenant-1",
      role: "OWNER",
      isSuperAdmin: false,
    });

    await expect(service.verify(`${token}x`)).rejects.toThrow();
  });
});
