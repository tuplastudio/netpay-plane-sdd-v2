import { beforeEach, describe, expect, it } from "vitest";
import { InviteService } from "../src/auth/invite.service.js";

/**
 * Aceptación de invitaciones (docs/03-iam.md T-IAM-02) con un Prisma en
 * memoria. Lo que se fija aquí: un correo que ya tiene cuenta y es invitado a
 * una segunda empresa recibe una **segunda membresía** sin que se le toque la
 * contraseña ni se le cierren las sesiones; y aceptar sobre una membresía que
 * ya existía es idempotente (la reactiva en vez de fallar).
 */

const ACME = "11111111-1111-1111-1111-111111111111";
const GLOBEX = "22222222-2222-2222-2222-222222222222";

interface Row {
  [key: string]: unknown;
}

function makePrisma() {
  const users: Row[] = [
    {
      id: "u-ana",
      email: "ana@correo.mx",
      fullName: "Ana Admin",
      passwordHash: "$argon2id$hash-original",
    },
  ];
  const memberships: Row[] = [
    { id: "m-ana-acme", tenantId: ACME, userId: "u-ana", role: "ADMIN", status: "ACTIVE" },
    { id: "m-ana-globex-old", tenantId: GLOBEX, userId: "u-ana", role: "VIEWER", status: "DISABLED" },
  ];
  const invitations: Row[] = [
    {
      id: "i-ana-globex",
      tenantId: GLOBEX,
      email: "ana@correo.mx",
      fullName: "Ana Admin",
      role: "VENDOR",
      tokenHash: "hash-ana-globex",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
    },
    {
      id: "i-nueva-globex",
      tenantId: GLOBEX,
      email: "nadia@correo.mx",
      fullName: "Nadia Nueva",
      role: "SUPPORT",
      tokenHash: "hash-nadia-globex",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  ];
  const sessions: Row[] = [{ id: "s-ana", tenantId: ACME, userId: "u-ana", revokedAt: null }];
  const auditLog: Row[] = [];
  let nextId = 1;

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Row }) =>
        users.find((u) => u.email === where.email || u.id === where.id) ?? null,
      create: async ({ data }: { data: Row }) => {
        const row = { id: `u-${nextId++}`, ...data };
        users.push(row);
        return row;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const found = users.find((u) => u.id === where.id);
        if (!found) throw new Error("no such user");
        Object.assign(found, data);
        return found;
      },
    },
    invitation: {
      findUnique: async ({ where }: { where: Row }) =>
        invitations.find((i) => i.tokenHash === where.tokenHash) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const found = invitations.find((i) => i.id === where.id);
        if (!found) throw new Error("no such invitation");
        Object.assign(found, data);
        return found;
      },
    },
    membership: {
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const key = where.tenantId_userId as { tenantId: string; userId: string };
        const found = memberships.find(
          (m) => m.tenantId === key.tenantId && m.userId === key.userId,
        );
        if (found) {
          Object.assign(found, update);
          return found;
        }
        const row = { id: `m-${nextId++}`, status: "ACTIVE", ...create };
        memberships.push(row);
        return row;
      },
    },
    session: {
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const s of sessions) {
          if (s.userId === where.userId && s.revokedAt === null) {
            Object.assign(s, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        auditLog.push({ ...data });
        return data;
      },
    },
  };

  return { prisma, users, memberships, invitations, sessions, auditLog };
}

function serviceOf(db: ReturnType<typeof makePrisma>) {
  const passwords = {
    hash: async (plain: string) => `$argon2id$hash-de-${plain}`,
    verify: async () => true,
  };
  // Los tokens de prueba son literalmente el hash: el servicio solo necesita
  // que `verify` devuelva el tokenHash con el que se guardó la invitación.
  const tokens = { verify: (token: string) => ({ tokenHash: token }) };
  const rateLimit = { consume: () => true };
  return new InviteService(
    db.prisma as never,
    passwords as never,
    tokens as never,
    rateLimit as never,
  );
}

let db: ReturnType<typeof makePrisma>;
let service: InviteService;

beforeEach(() => {
  db = makePrisma();
  service = serviceOf(db);
});

describe("aceptar invitación", () => {
  it("un correo nuevo crea usuario con la contraseña elegida y su membresía", async () => {
    const result = await service.acceptInvite({
      token: "hash-nadia-globex",
      password: "contraseña-segura-1",
    });

    const user = db.users.find((u) => u.email === "nadia@correo.mx")!;
    expect(user.passwordHash).toBe("$argon2id$hash-de-contraseña-segura-1");
    expect(result).toMatchObject({ userId: user.id, tenantId: GLOBEX, role: "SUPPORT", existingUser: false });
    expect(
      db.memberships.filter((m) => m.userId === user.id && m.tenantId === GLOBEX && m.status === "ACTIVE"),
    ).toHaveLength(1);
    expect(db.invitations.find((i) => i.id === "i-nueva-globex")!.acceptedAt).toBeInstanceOf(Date);
  });

  it("un usuario existente invitado a otra empresa gana una segunda membresía sin perder su cuenta", async () => {
    const result = await service.acceptInvite({
      token: "hash-ana-globex",
      password: "otra-contraseña-que-no-aplica",
    });

    expect(result).toMatchObject({ userId: "u-ana", tenantId: GLOBEX, role: "VENDOR", existingUser: true });

    // Una cuenta, dos empresas: la membresía de Acme sigue intacta y la de
    // Globex (que estaba DISABLED) se reactiva con el rol de la invitación.
    const ana = db.memberships.filter((m) => m.userId === "u-ana" && m.status === "ACTIVE");
    expect(ana.map((m) => [m.tenantId, m.role]).sort()).toEqual([
      [ACME, "ADMIN"],
      [GLOBEX, "VENDOR"],
    ]);
    expect(db.memberships.filter((m) => m.userId === "u-ana")).toHaveLength(2);

    // Ni la contraseña ni las sesiones vivas se tocan: el enlace de invitación
    // lo ve quien invita y no debe servir para apoderarse de la cuenta.
    expect(db.users.find((u) => u.id === "u-ana")!.passwordHash).toBe("$argon2id$hash-original");
    expect(db.sessions.find((s) => s.id === "s-ana")!.revokedAt).toBeNull();

    expect(db.auditLog).toHaveLength(1);
    expect(db.auditLog[0]).toMatchObject({
      tenantId: GLOBEX,
      actorId: "u-ana",
      action: "user.invited",
      metadata: { role: "VENDOR", existingUser: true },
    });
  });

  it("una invitación ya aceptada no se puede reutilizar", async () => {
    await service.acceptInvite({ token: "hash-ana-globex", password: "x".repeat(12) });
    await expect(
      service.acceptInvite({ token: "hash-ana-globex", password: "x".repeat(12) }),
    ).rejects.toThrow(/ya usada/i);
  });
});
