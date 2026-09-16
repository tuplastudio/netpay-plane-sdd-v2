import { describe, expect, it } from "vitest";
import { SessionService } from "../src/auth/session.service.js";
import { hashToken } from "../src/auth/rate-limit.service.js";

/**
 * `SessionService.refreshSession` respalda `POST /auth/refresh`, que es
 * `@Public()` (el `PrincipalGuard` no corre antes de llegar al controlador).
 * Por eso `refreshSession` reusa `resolveSession` y debe aplicar EXACTAMENTE
 * las mismas reglas que cualquier otra petición autenticada: token
 * inexistente, revocado, expirado, inactivo > 30 min o sin membresía ACTIVE
 * se rechazan igual. Si alguna de estas reglas se saltara aquí, `/auth/refresh`
 * sería una puerta trasera para revivir una sesión que el resto de la API ya
 * no acepta.
 */

const ACME = "11111111-1111-1111-1111-111111111111";

interface Row {
  [key: string]: unknown;
}

function makePrisma(sessionOverrides: Partial<Row> = {}, membershipStatus = "ACTIVE") {
  const tenant = { id: ACME, slug: "acme", name: "Acme", status: "ACTIVE" };
  const user = { id: "u-ana", isSuperAdmin: false };
  const membership = { tenantId: ACME, userId: "u-ana", role: "ADMIN", status: membershipStatus };
  const session: Row = {
    id: "s-1",
    tenantId: ACME,
    userId: "u-ana",
    tokenHash: hashToken("token-ana"),
    revokedAt: null,
    expiresAt: new Date(Date.now() + 3600_000),
    lastActivityAt: new Date(),
    ...sessionOverrides,
  };

  const prisma = {
    session: {
      findUnique: async ({ where }: { where: Row }) => {
        if (where.tokenHash !== undefined) {
          return session.tokenHash === where.tokenHash
            ? { ...session, tenant, user: { isSuperAdmin: user.isSuperAdmin } }
            : null;
        }
        return session.id === where.id ? session : null;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        if (session.id !== where.id) throw new Error("no such session");
        Object.assign(session, data);
        return session;
      },
    },
    membership: {
      findUnique: async () => membership,
    },
  };

  return { prisma, session };
}

describe("SessionService.refreshSession", () => {
  it("token inexistente: no revive nada", async () => {
    const { prisma } = makePrisma();
    const sessions = new SessionService(prisma as never);
    expect(await sessions.refreshSession("token-inexistente")).toBeNull();
  });

  it("token undefined (cookie ausente): no revive nada", async () => {
    const { prisma } = makePrisma();
    const sessions = new SessionService(prisma as never);
    expect(await sessions.refreshSession(undefined)).toBeNull();
  });

  it("sesión revocada: rechaza", async () => {
    const { prisma } = makePrisma({ revokedAt: new Date() });
    const sessions = new SessionService(prisma as never);
    expect(await sessions.refreshSession("token-ana")).toBeNull();
  });

  it("sesión ya expirada (absoluto): rechaza", async () => {
    const { prisma } = makePrisma({ expiresAt: new Date(Date.now() - 1000) });
    const sessions = new SessionService(prisma as never);
    expect(await sessions.refreshSession("token-ana")).toBeNull();
  });

  it("inactividad > 30 min: rechaza (mismo límite que resolveSession)", async () => {
    const { prisma } = makePrisma({ lastActivityAt: new Date(Date.now() - 31 * 60 * 1000) });
    const sessions = new SessionService(prisma as never);
    expect(await sessions.refreshSession("token-ana")).toBeNull();
  });

  it("membresía ya no ACTIVE: rechaza aunque el token siga siendo válido", async () => {
    const { prisma } = makePrisma({}, "DISABLED");
    const sessions = new SessionService(prisma as never);
    expect(await sessions.refreshSession("token-ana")).toBeNull();
  });

  it("sesión válida: extiende expiresAt ~12h y actualiza lastActivityAt", async () => {
    const { prisma, session } = makePrisma({ lastActivityAt: new Date(Date.now() - 5 * 60 * 1000) });
    const sessions = new SessionService(prisma as never);
    const before = Date.now();
    const result = await sessions.refreshSession("token-ana");
    expect(result).not.toBeNull();
    const deltaMs = result!.expiresAt.getTime() - before;
    expect(deltaMs).toBeGreaterThan(11.9 * 60 * 60 * 1000);
    expect(deltaMs).toBeLessThan(12.1 * 60 * 60 * 1000);
    expect(session.expiresAt).toBe(result!.expiresAt);
    expect((session.lastActivityAt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });
});
