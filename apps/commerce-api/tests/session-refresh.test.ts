import { describe, expect, it } from "vitest";
import { SessionService } from "../src/auth/session.service.js";
import { hashToken } from "../src/auth/rate-limit.service.js";

/**
 * `SessionService.rotateRefresh` respalda `POST /auth/refresh`, que es
 * `@Public()` (el `PrincipalGuard` no corre antes de llegar al controlador).
 * Por eso `rotateRefresh` reusa `resolveSession` y debe aplicar EXACTAMENTE
 * las mismas reglas que cualquier otra petición autenticada: token
 * inexistente, revocado, expirado, inactivo > `SESSION_INACTIVITY_TTL_MS`
 * (7 días por defecto) o sin membresía ACTIVE se rechazan igual. Si alguna
 * de estas reglas se saltara aquí, `/auth/refresh` sería una puerta trasera
 * para revivir una sesión que el resto de la API ya no acepta.
 *
 * Adicional: cuando la rotación tiene éxito, la sesión VIEJA queda revocada
 * y se crea una NUEVA con un refresh nuevo. Eso cierra la ventana de replay
 * si el refresh viejo fue filtrado: ya no está en la BD.
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
    accessJti: null,
    expiresAt: new Date(Date.now() + 3600_000),
    lastActivityAt: new Date(),
    ...sessionOverrides,
  };
  let sessionStore: Row[] = [session];

  const prisma = {
    session: {
      findUnique: async ({ where }: { where: Row }) => {
        if (where.tokenHash !== undefined) {
          const hit = sessionStore.find((s) => s.tokenHash === where.tokenHash);
          return hit ? { ...hit, tenant, user: { isSuperAdmin: user.isSuperAdmin } } : null;
        }
        if (where.id !== undefined) {
          const hit = sessionStore.find((s) => s.id === where.id);
          return hit ? { ...hit } : null;
        }
        return null;
      },
      create: async ({ data }: { data: Row }) => {
        const created: Row = {
          ...data,
          id: `s-${sessionStore.length + 1}`,
          accessJti: data.accessJti ?? null,
        };
        sessionStore.push(created);
        return { id: created.id };
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const idx = sessionStore.findIndex((s) => s.id === where.id);
        if (idx < 0) throw new Error("no such session");
        sessionStore[idx] = { ...sessionStore[idx], ...data };
        return sessionStore[idx];
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        sessionStore = sessionStore.map((s) => {
          let match = true;
          for (const k of Object.keys(where)) {
            if (s[k] !== where[k]) {
              match = false;
              break;
            }
          }
          if (match) {
            count += 1;
            return { ...s, ...data };
          }
          return s;
        });
        return { count };
      },
      delete: async ({ where }: { where: Row }) => {
        const idx = sessionStore.findIndex((s) => s.id === where.id);
        if (idx >= 0) sessionStore.splice(idx, 1);
        return { id: where.id };
      },
    },
    membership: {
      findUnique: async () => membership,
    },
  };

  return { prisma, getStore: () => sessionStore };
}

describe("SessionService.rotateRefresh", () => {
  it("token inexistente: no revive nada", async () => {
    const { prisma } = makePrisma();
    const sessions = new SessionService(prisma as never);
    expect(await sessions.rotateRefresh("token-inexistente")).toBeNull();
  });

  it("token undefined (cookie ausente): no revive nada", async () => {
    const { prisma } = makePrisma();
    const sessions = new SessionService(prisma as never);
    expect(await sessions.rotateRefresh(undefined)).toBeNull();
  });

  it("sesión revocada: rechaza", async () => {
    const { prisma } = makePrisma({ revokedAt: new Date() });
    const sessions = new SessionService(prisma as never);
    expect(await sessions.rotateRefresh("token-ana")).toBeNull();
  });

  it("sesión ya expirada (absoluto): rechaza", async () => {
    const { prisma } = makePrisma({ expiresAt: new Date(Date.now() - 1000) });
    const sessions = new SessionService(prisma as never);
    expect(await sessions.rotateRefresh("token-ana")).toBeNull();
  });

  it("inactividad > 7 días: rechaza (mismo límite que resolveSession)", async () => {
    const { prisma } = makePrisma({
      lastActivityAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    const sessions = new SessionService(prisma as never);
    expect(await sessions.rotateRefresh("token-ana")).toBeNull();
  });

  it("membresía ya no ACTIVE: rechaza aunque el token siga siendo válido", async () => {
    const { prisma } = makePrisma({}, "DISABLED");
    const sessions = new SessionService(prisma as never);
    expect(await sessions.rotateRefresh("token-ana")).toBeNull();
  });

  it("sesión válida: emite refresh nuevo, revoca la vieja y extiende ~30 días", async () => {
    const { prisma, getStore } = makePrisma({ lastActivityAt: new Date(Date.now() - 5 * 60_000) });
    const sessions = new SessionService(prisma as never);
    const before = Date.now();

    const result = await sessions.rotateRefresh("token-ana");
    expect(result).not.toBeNull();
    const deltaMs = result!.expiresAt.getTime() - before;
    expect(deltaMs).toBeGreaterThan(29.9 * 24 * 60 * 60 * 1000);
    expect(deltaMs).toBeLessThan(30.1 * 24 * 60 * 60 * 1000);
    expect(result!.refreshToken).toBeTruthy();
    expect(result!.refreshToken).not.toBe("token-ana");
    expect(result!.sessionId).toBeTruthy();
    expect(result!.sessionId).not.toBe("s-1");

    // La sesión VIEJA quedó revocada (atributo de defensa contra replay).
    const old = getStore().find((s) => s.id === "s-1");
    expect(old?.revokedAt).toBeInstanceOf(Date);

    // Y existe la sesión NUEVA con su propio tokenHash.
    const fresh = getStore().find((s) => s.id === result!.sessionId);
    expect(fresh).toBeDefined();
    expect(fresh?.tokenHash).not.toBe(hashToken("token-ana"));
  });
});