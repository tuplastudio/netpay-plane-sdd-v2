import { describe, expect, it } from "vitest";
import {
  ACTIVITY_TOUCH_INTERVAL_MS,
  SessionService,
  isActivityTouch,
} from "../src/auth/session.service.js";
import { hashToken } from "../src/auth/rate-limit.service.js";

/**
 * Caché de sesiones del `PrincipalGuard`: lo que se fija aquí es que una
 * ráfaga de peticiones del mismo navegador resuelve la sesión UNA vez, que
 * los negativos no se cachean, que revocar / cambiar de empresa / cualquier
 * escritura en Session o Membership invalida al instante, y que
 * `lastActivityAt` se escribe como mucho una vez por minuto por sesión.
 */
const ACME = "11111111-1111-1111-1111-111111111111";
const BETA = "22222222-2222-2222-2222-222222222222";

interface Row {
  [key: string]: unknown;
}

function makeDb() {
  const session: Row = {
    id: "s-1",
    tenantId: ACME,
    userId: "u-ana",
    tokenHash: hashToken("token-ana"),
    revokedAt: null,
    expiresAt: new Date(Date.now() + 3600_000),
    lastActivityAt: new Date(),
    user: { isSuperAdmin: false },
  };
  const memberships: Row[] = [
    { tenantId: ACME, userId: "u-ana", role: "ADMIN", status: "ACTIVE" },
    { tenantId: BETA, userId: "u-ana", role: "VIEWER", status: "ACTIVE" },
  ];
  const calls = { sessionFind: 0, membershipFind: 0, sessionUpdate: 0 };
  const listeners: Array<{ models: Set<string>; listener: (e: Row) => void }> = [];
  const emit = (model: string, action: string, args: Row) => {
    for (const l of listeners) if (l.models.has(model)) l.listener({ model, action, args });
  };

  const prisma = {
    onWrite: (models: string[], listener: (e: Row) => void) => {
      listeners.push({ models: new Set(models), listener });
      return () => undefined;
    },
    session: {
      findUnique: async ({ where }: { where: Row }) => {
        calls.sessionFind += 1;
        return session.tokenHash === where.tokenHash ? { ...session } : null;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        calls.sessionUpdate += 1;
        if (session.id !== where.id) throw new Error("no such session");
        Object.assign(session, data);
        emit("Session", "update", { where, data });
        return session;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (where.tokenHash === session.tokenHash || where.userId === session.userId) {
          Object.assign(session, data);
        }
        emit("Session", "updateMany", { where, data });
        return { count: 1 };
      },
    },
    membership: {
      findUnique: async ({ where }: { where: { tenantId_userId: Row } }) => {
        calls.membershipFind += 1;
        const key = where.tenantId_userId;
        return memberships.find((m) => m.tenantId === key.tenantId && m.userId === key.userId) ?? null;
      },
      update: async ({ data }: { data: Row }) => {
        Object.assign(memberships[0]!, data);
        emit("Membership", "update", { data });
        return memberships[0];
      },
    },
  };
  return { prisma, session, memberships, calls };
}

describe("SessionService: caché de sesión resuelta", () => {
  it("una ráfaga de peticiones resuelve la sesión una sola vez", async () => {
    const db = makeDb();
    const sessions = new SessionService(db.prisma as never);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => sessions.resolveSession("token-ana")),
    );
    for (const r of results) expect(r).toMatchObject({ sessionId: "s-1", tenantId: ACME, role: "ADMIN" });
    expect(db.calls.sessionFind).toBe(1);
    expect(db.calls.membershipFind).toBe(1);
    // Y las secuenciales dentro del TTL tampoco van a la base.
    await sessions.resolveSession("token-ana");
    expect(db.calls.sessionFind).toBe(1);
  });

  it("los negativos no se cachean: un token desconocido se reconsulta", async () => {
    const db = makeDb();
    const sessions = new SessionService(db.prisma as never);
    expect(await sessions.resolveSession("token-x")).toBeNull();
    expect(await sessions.resolveSession("token-x")).toBeNull();
    expect(db.calls.sessionFind).toBe(2);
    expect(await sessions.resolveSession(undefined)).toBeNull();
  });

  it("revocar (logout) invalida al instante", async () => {
    const db = makeDb();
    const sessions = new SessionService(db.prisma as never);
    expect(await sessions.resolveSession("token-ana")).not.toBeNull();
    await sessions.revoke("token-ana");
    expect(await sessions.resolveSession("token-ana")).toBeNull();
  });

  it("cambiar de empresa se refleja en la siguiente petición", async () => {
    const db = makeDb();
    const sessions = new SessionService(db.prisma as never);
    expect((await sessions.resolveSession("token-ana"))?.tenantId).toBe(ACME);
    await sessions.setActiveTenant("s-1", BETA);
    const after = await sessions.resolveSession("token-ana");
    expect(after?.tenantId).toBe(BETA);
    expect(after?.role).toBe("VIEWER");
  });

  it("una escritura en Membership desde otro servicio invalida vía onWrite", async () => {
    const db = makeDb();
    const sessions = new SessionService(db.prisma as never);
    expect((await sessions.resolveSession("token-ana"))?.role).toBe("ADMIN");
    await db.prisma.membership.update({ data: { status: "DISABLED" } });
    expect(await sessions.resolveSession("token-ana")).toBeNull();
  });

  it("revokeAllForUser invalida solo las sesiones de ese usuario", async () => {
    const db = makeDb();
    const sessions = new SessionService(db.prisma as never);
    expect(await sessions.resolveSession("token-ana")).not.toBeNull();
    await sessions.revokeAllForUser("u-ana");
    expect(await sessions.resolveSession("token-ana")).toBeNull();
  });

  it("refreshSession resuelve contra la base (no desde caché) y extiende", async () => {
    const db = makeDb();
    const sessions = new SessionService(db.prisma as never);
    await sessions.resolveSession("token-ana");
    const before = db.calls.sessionFind;
    const refreshed = await sessions.refreshSession("token-ana");
    expect(refreshed?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 11 * 3600_000);
    expect(db.calls.sessionFind).toBe(before + 1);
  });
});

describe("SessionService.touchActivity: una escritura por minuto por sesión", () => {
  it("la primera escribe, las siguientes dentro del intervalo no", async () => {
    const db = makeDb();
    const sessions = new SessionService(db.prisma as never);
    await sessions.touchActivity("s-1");
    await sessions.touchActivity("s-1");
    await sessions.touchActivity("s-1");
    expect(db.calls.sessionUpdate).toBe(1);
  });

  it("el toque de actividad NO vacía la caché de sesiones", async () => {
    const db = makeDb();
    const sessions = new SessionService(db.prisma as never);
    await sessions.resolveSession("token-ana");
    await sessions.touchActivity("s-1");
    await sessions.resolveSession("token-ana");
    expect(db.calls.sessionFind).toBe(1);
  });

  it("isActivityTouch reconoce solo la escritura pura de lastActivityAt", () => {
    expect(
      isActivityTouch({ model: "Session", action: "update", args: { data: { lastActivityAt: new Date() } } }),
    ).toBe(true);
    expect(
      isActivityTouch({
        model: "Session",
        action: "update",
        args: { data: { lastActivityAt: new Date(), tenantId: BETA } },
      }),
    ).toBe(false);
    expect(isActivityTouch({ model: "Session", action: "updateMany", args: { data: { lastActivityAt: 1 } } })).toBe(false);
    expect(isActivityTouch({ model: "Membership", action: "update", args: { data: { lastActivityAt: 1 } } })).toBe(false);
    expect(isActivityTouch({ model: "Session", action: "update", args: undefined })).toBe(false);
  });

  it("el intervalo es de un minuto", () => {
    expect(ACTIVITY_TOUCH_INTERVAL_MS).toBe(60_000);
  });
});
