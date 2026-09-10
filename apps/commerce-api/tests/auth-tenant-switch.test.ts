import { beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/auth.service.js";
import { SessionService } from "../src/auth/session.service.js";
import { hashToken } from "../src/auth/rate-limit.service.js";

/**
 * Un usuario en varias empresas: `GET /auth/me` lista todas sus membresías
 * activas, `POST /auth/switch-tenant` mueve la sesión a otra (solo si tiene
 * membresía ACTIVE en un tenant ACTIVE) y login entra por defecto a la última
 * que usó. Prisma en memoria, igual que membership.test.ts.
 */

const ACME = "11111111-1111-1111-1111-111111111111";
const GLOBEX = "22222222-2222-2222-2222-222222222222";
const INITECH = "33333333-3333-3333-3333-333333333333";
const CLOSED = "44444444-4444-4444-4444-444444444444";

interface Row {
  [key: string]: unknown;
}

function makePrisma() {
  const tenants: Row[] = [
    { id: ACME, slug: "acme", name: "Acme", status: "ACTIVE", logoUrl: null, primaryColor: "#000000", secondaryColor: "#111111", accentColor: "#222222" },
    { id: GLOBEX, slug: "globex", name: "Globex", status: "ACTIVE", logoUrl: "https://cdn/globex.png", primaryColor: "#000000", secondaryColor: "#111111", accentColor: "#222222" },
    { id: INITECH, slug: "initech", name: "Initech", status: "ACTIVE", logoUrl: null, primaryColor: "#000000", secondaryColor: "#111111", accentColor: "#222222" },
    { id: CLOSED, slug: "cerrada", name: "Cerrada", status: "DISABLED", logoUrl: null, primaryColor: "#000000", secondaryColor: "#111111", accentColor: "#222222" },
  ];
  const users: Row[] = [
    { id: "u-ana", email: "ana@correo.mx", fullName: "Ana", passwordHash: "h", totpEnabled: false, isSuperAdmin: false },
  ];
  const memberships: Row[] = [
    { id: "m-acme", tenantId: ACME, userId: "u-ana", role: "ADMIN", status: "ACTIVE", joinedAt: new Date("2024-01-01") },
    { id: "m-globex", tenantId: GLOBEX, userId: "u-ana", role: "VENDOR", status: "ACTIVE", joinedAt: new Date("2024-03-01") },
    { id: "m-initech", tenantId: INITECH, userId: "u-ana", role: "OWNER", status: "DISABLED", joinedAt: new Date("2024-02-01") },
    { id: "m-closed", tenantId: CLOSED, userId: "u-ana", role: "OWNER", status: "ACTIVE", joinedAt: new Date("2023-01-01") },
  ];
  const sessions: Row[] = [
    { id: "s-1", tenantId: ACME, userId: "u-ana", tokenHash: hashToken("token-ana"), revokedAt: null, expiresAt: new Date(Date.now() + 3600_000), lastActivityAt: new Date("2024-05-01") },
  ];
  const auditLog: Row[] = [];
  const tenantOf = (id: unknown) => tenants.find((t) => t.id === id) as Row;

  const matches = (m: Row, where: Row) =>
    (where.userId === undefined || m.userId === where.userId) &&
    (where.status === undefined || m.status === where.status) &&
    (where.tenant === undefined ||
      tenantOf(m.tenantId).status === (where.tenant as { status: string }).status);

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Row }) =>
        users.find((u) => u.id === where.id || u.email === where.email) ?? null,
    },
    tenant: {
      findUnique: async ({ where }: { where: Row }) => tenantOf(where.id) ?? null,
    },
    membership: {
      findMany: async ({ where, orderBy }: { where: Row; orderBy?: Row }) => {
        const rows = memberships
          .filter((m) => matches(m, where))
          .map((m) => ({ ...m, tenant: tenantOf(m.tenantId) }));
        if (orderBy && "tenant" in orderBy) {
          rows.sort((a, b) => String(a.tenant.name).localeCompare(String(b.tenant.name)));
        }
        return rows;
      },
      findUnique: async ({ where }: { where: Row }) => {
        const key = where.tenantId_userId as { tenantId: string; userId: string };
        const found = memberships.find(
          (m) => m.tenantId === key.tenantId && m.userId === key.userId,
        );
        return found ? { ...found, tenant: tenantOf(found.tenantId) } : null;
      },
    },
    session: {
      findUnique: async ({ where }: { where: Row }) => {
        const found = sessions.find((s) => s.id === where.id || s.tokenHash === where.tokenHash);
        return found
          ? { ...found, tenant: tenantOf(found.tenantId), user: users.find((u) => u.id === found.userId) }
          : null;
      },
      findFirst: async ({ where }: { where: Row }) =>
        [...sessions]
          .filter((s) => s.userId === where.userId)
          .sort(
            (a, b) => (b.lastActivityAt as Date).getTime() - (a.lastActivityAt as Date).getTime(),
          )[0] ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const found = sessions.find((s) => s.id === where.id);
        if (!found) throw new Error("no such session");
        Object.assign(found, data);
        return found;
      },
      create: async ({ data }: { data: Row }) => {
        const row = { id: `s-${sessions.length + 1}`, revokedAt: null, ...data };
        sessions.push(row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        auditLog.push({ ...data });
        return data;
      },
    },
  };

  return { prisma, sessions, auditLog, memberships };
}

function serviceOf(db: ReturnType<typeof makePrisma>) {
  const sessions = new SessionService(db.prisma as never);
  const passwords = { verify: async () => true, hash: async (p: string) => p };
  const rateLimit = { allow: () => true, recordFailure: () => {}, reset: () => {} };
  return new AuthService(db.prisma as never, passwords as never, rateLimit as never, sessions, {} as never);
}

let db: ReturnType<typeof makePrisma>;
let auth: AuthService;

beforeEach(() => {
  db = makePrisma();
  auth = serviceOf(db);
});

describe("GET /auth/me con varias empresas", () => {
  it("lista solo las membresías ACTIVE de tenants ACTIVE y marca la activa", async () => {
    const me = await auth.me("u-ana", ACME);
    expect(me.tenantId).toBe(ACME);
    expect(me.tenantName).toBe("Acme");
    expect(me.role).toBe("ADMIN");
    expect(me.memberships).toEqual([
      { tenantId: ACME, slug: "acme", name: "Acme", role: "ADMIN", status: "ACTIVE", logoUrl: null },
      { tenantId: GLOBEX, slug: "globex", name: "Globex", role: "VENDOR", status: "ACTIVE", logoUrl: "https://cdn/globex.png" },
    ]);
  });
});

describe("POST /auth/switch-tenant", () => {
  it("mueve la sesión a otra empresa con membresía activa y lo audita", async () => {
    const result = await auth.switchTenant({ userId: "u-ana", sessionId: "s-1", tenantId: GLOBEX });

    expect(result).toEqual({ tenantId: GLOBEX, slug: "globex", name: "Globex", role: "VENDOR" });
    expect(db.sessions[0]!.tenantId).toBe(GLOBEX);
    expect(db.auditLog).toHaveLength(1);
    expect(db.auditLog[0]).toMatchObject({
      tenantId: GLOBEX,
      actorId: "u-ana",
      action: "auth.tenant_switched",
      targetType: "Tenant",
      targetId: GLOBEX,
      metadata: { fromTenantId: ACME, sessionId: "s-1" },
    });

    // La siguiente petición (PrincipalGuard → resolveSession) ya resuelve
    // tenant y rol desde la membresía de la nueva empresa.
    const resolved = await new SessionService(db.prisma as never).resolveSession("token-ana");
    expect(resolved).toMatchObject({ sessionId: "s-1", tenantId: GLOBEX, role: "VENDOR" });
  });

  it("es idempotente si se pide la empresa que ya está activa", async () => {
    const result = await auth.switchTenant({ userId: "u-ana", sessionId: "s-1", tenantId: ACME });
    expect(result.tenantId).toBe(ACME);
    expect(db.auditLog).toHaveLength(0);
  });

  it("rechaza una membresía DISABLED, un tenant DISABLED y una empresa ajena", async () => {
    for (const tenantId of [INITECH, CLOSED, "99999999-9999-9999-9999-999999999999"]) {
      await expect(
        auth.switchTenant({ userId: "u-ana", sessionId: "s-1", tenantId }),
      ).rejects.toThrow(/acceso/i);
    }
    expect(db.sessions[0]!.tenantId).toBe(ACME);
    expect(db.auditLog).toHaveLength(0);
  });

  it("rechaza una sesión que no es del usuario", async () => {
    await expect(
      auth.switchTenant({ userId: "u-otro", sessionId: "s-1", tenantId: GLOBEX }),
    ).rejects.toThrow(/acceso|sesión/i);
  });
});

describe("login con varias empresas", () => {
  it("entra por defecto a la última empresa usada", async () => {
    db.sessions.push({
      id: "s-2", tenantId: GLOBEX, userId: "u-ana", tokenHash: "t2", revokedAt: new Date(), lastActivityAt: new Date("2024-06-01"),
    });
    const result = await auth.login({ email: "ana@correo.mx", password: "x" });
    expect("tenantId" in result && result.tenantId).toBe(GLOBEX);
    expect("role" in result && result.role).toBe("VENDOR");
  });

  it("si la última usada ya no está disponible, entra a la membresía activa más antigua", async () => {
    db.sessions[0]!.tenantId = CLOSED; // la última sesión fue en la empresa deshabilitada
    const result = await auth.login({ email: "ana@correo.mx", password: "x" });
    expect("tenantId" in result && result.tenantId).toBe(ACME);
  });

  it("respeta tenantSlug explícito", async () => {
    const result = await auth.login({ email: "ana@correo.mx", password: "x", tenantSlug: "globex" });
    expect("tenantId" in result && result.tenantId).toBe(GLOBEX);
  });
});
