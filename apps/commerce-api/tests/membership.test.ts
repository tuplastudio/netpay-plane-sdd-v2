import { beforeEach, describe, expect, it } from "vitest";
import { MembershipService } from "../src/auth/membership.service.js";

/**
 * Reglas de membresía (docs/03-iam.md T-IAM-04). Se prueba el servicio contra
 * un Prisma en memoria: lo que se fija aquí son las reglas de autorización y el
 * anti-lockout, que son la razón de ser de estos endpoints.
 *
 * El fake respeta `select`, así que "no filtrar secretos" es una aserción real:
 * si el servicio pidiera el usuario completo, el hash aparecería en la fila.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";

interface Row {
  [key: string]: unknown;
}

function project(row: Row, select?: Record<string, unknown>): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const [key, value] of Object.entries(select)) {
    if (!value) continue;
    if (typeof value === "object") {
      out[key] = project(row[key] as Row, (value as { select?: Record<string, unknown> }).select);
    } else {
      out[key] = row[key];
    }
  }
  return out;
}

function makePrisma() {
  const users: Row[] = [
    {
      id: "u-owner",
      email: "owner@acme.mx",
      fullName: "Olivia Owner",
      passwordHash: "$argon2id$secreto",
      totpSecret: "SEED",
      recoveryCodesHash: ["h1"],
    },
    {
      id: "u-owner2",
      email: "owner2@acme.mx",
      fullName: "Omar Owner",
      passwordHash: "$argon2id$secreto",
      totpSecret: null,
      recoveryCodesHash: null,
    },
    {
      id: "u-admin",
      email: "admin@acme.mx",
      fullName: "Ana Admin",
      passwordHash: "$argon2id$secreto",
      totpSecret: null,
      recoveryCodesHash: null,
    },
    {
      id: "u-vendor",
      email: "vendor@acme.mx",
      fullName: "Vera Vendedora",
      passwordHash: "$argon2id$secreto",
      totpSecret: null,
      recoveryCodesHash: null,
    },
  ];

  const memberships: Row[] = [
    {
      id: "m-owner",
      tenantId: TENANT,
      userId: "u-owner",
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date("2024-01-01"),
      createdAt: new Date("2024-01-01"),
      version: 1,
    },
    {
      id: "m-admin",
      tenantId: TENANT,
      userId: "u-admin",
      role: "ADMIN",
      status: "ACTIVE",
      joinedAt: new Date("2024-02-01"),
      createdAt: new Date("2024-02-01"),
      version: 1,
    },
    {
      id: "m-vendor",
      tenantId: TENANT,
      userId: "u-vendor",
      role: "VENDOR",
      status: "ACTIVE",
      joinedAt: new Date("2024-03-01"),
      createdAt: new Date("2024-03-01"),
      version: 1,
    },
  ];

  const invitations: Row[] = [
    {
      id: "i-1",
      tenantId: TENANT,
      email: "nuevo@acme.mx",
      fullName: "Nadia Nueva",
      role: "SUPPORT",
      tokenHash: "hash-secreto",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date("2024-04-01"),
    },
    {
      id: "i-owner-bootstrap",
      tenantId: TENANT,
      email: "owner@acme.mx",
      fullName: "Olivia Owner",
      role: "OWNER",
      tokenHash: "hash-bootstrap",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date("2024-01-01"),
    },
  ];

  const auditLog: Row[] = [];
  const sessions: Row[] = [
    { id: "s-1", tenantId: TENANT, userId: "u-vendor", revokedAt: null },
  ];

  const withUser = (m: Row): Row => ({
    ...m,
    user: users.find((u) => u.id === m.userId) as Row,
  });

  const prisma = {
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        auditLog.push({ ...data });
        return data;
      },
    },
    session: {
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const s of sessions) {
          if (s.tenantId === where.tenantId && s.userId === where.userId && s.revokedAt === null) {
            Object.assign(s, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    membership: {
      findMany: async ({ where, select }: { where: Row; select?: Record<string, unknown> }) =>
        memberships
          .filter((m) => m.tenantId === where.tenantId)
          .map((m) => project(withUser(m), select)),
      findFirst: async ({ where, select }: { where: Row; select?: Record<string, unknown> }) => {
        const found = memberships.find((m) => m.id === where.id && m.tenantId === where.tenantId);
        return found ? project(withUser(found), select) : null;
      },
      findUnique: async ({ where, select }: { where: Row; select?: Record<string, unknown> }) => {
        const key = where.tenantId_userId as { tenantId: string; userId: string };
        const found = memberships.find(
          (m) => m.tenantId === key.tenantId && m.userId === key.userId,
        );
        return found ? project(withUser(found), select) : null;
      },
      count: async ({ where }: { where: Row }) =>
        memberships.filter(
          (m) =>
            m.tenantId === where.tenantId &&
            (where.role === undefined || m.role === where.role) &&
            (where.status === undefined || m.status === where.status) &&
            (where.id === undefined || m.id !== (where.id as { not: string }).not),
        ).length,
      update: async ({
        where,
        data,
        select,
      }: {
        where: Row;
        data: Row;
        select?: Record<string, unknown>;
      }) => {
        const found = memberships.find((m) => m.id === where.id);
        if (!found) throw new Error("no such membership");
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === "object" && "increment" in value) {
            found[key] = (found[key] as number) + (value as { increment: number }).increment;
          } else {
            found[key] = value;
          }
        }
        return project(withUser(found), select);
      },
    },
    invitation: {
      findMany: async ({ where, select }: { where: Row; select?: Record<string, unknown> }) =>
        invitations
          .filter(
            (i) =>
              i.tenantId === where.tenantId &&
              i.acceptedAt === null &&
              (i.expiresAt as Date).getTime() > (where.expiresAt as { gt: Date }).gt.getTime(),
          )
          .map((i) => project(i, select)),
      findFirst: async ({ where, select }: { where: Row; select?: Record<string, unknown> }) => {
        const found = invitations.find((i) => i.id === where.id && i.tenantId === where.tenantId);
        return found ? project(found, select) : null;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const found = invitations.find((i) => i.id === where.id);
        if (!found) throw new Error("no such invitation");
        Object.assign(found, data);
        return { ...found };
      },
    },
    $queryRaw: async () => [],
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(prisma),
  };

  return { prisma, memberships, invitations, auditLog, sessions };
}

function serviceOf(db: ReturnType<typeof makePrisma>) {
  // El servicio solo usa la superficie de Prisma que el fake implementa.
  return new MembershipService(db.prisma as never);
}

const OWNER = { userId: "u-owner", role: "OWNER" };
const ADMIN = { userId: "u-admin", role: "ADMIN" };
const VENDOR = { userId: "u-vendor", role: "VENDOR" };

let db: ReturnType<typeof makePrisma>;
let service: MembershipService;

beforeEach(() => {
  db = makePrisma();
  service = serviceOf(db);
});

describe("listado de membresías", () => {
  it("devuelve identidad, rol y estado, e incluye invitaciones pendientes", async () => {
    const rows = await service.list(TENANT, "u-owner");

    const emails = rows.map((r) => r.email).sort();
    expect(emails).toEqual([
      "admin@acme.mx",
      "nuevo@acme.mx",
      "owner@acme.mx",
      "vendor@acme.mx",
    ]);

    const owner = rows.find((r) => r.email === "owner@acme.mx")!;
    expect(owner.kind).toBe("MEMBERSHIP");
    expect(owner.role).toBe("OWNER");
    expect(owner.status).toBe("ACTIVE");
    expect(owner.isSelf).toBe(true);
    expect(rows.find((r) => r.email === "admin@acme.mx")!.isSelf).toBe(false);

    const pending = rows.find((r) => r.email === "nuevo@acme.mx")!;
    expect(pending.kind).toBe("INVITATION");
    expect(pending.status).toBe("INVITED");
    expect(pending.role).toBe("SUPPORT");
    expect(pending.userId).toBeNull();
    expect(pending.expiresAt).toBeInstanceOf(Date);
  });

  it("no filtra hashes de contraseña, secretos TOTP ni tokens de invitación", async () => {
    const rows = await service.list(TENANT, "u-owner");
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("argon2id");
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("totpSecret");
    expect(serialized).not.toContain("recoveryCodesHash");
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("hash-secreto");
  });

  it("oculta la invitación de un correo que ya es miembro (la del bootstrap)", async () => {
    const rows = await service.list(TENANT, "u-owner");
    expect(rows.filter((r) => r.email === "owner@acme.mx")).toHaveLength(1);
    expect(rows.find((r) => r.id === "i-owner-bootstrap")).toBeUndefined();
  });

  it("no ve las membresías de otro tenant", async () => {
    expect(await service.list(OTHER_TENANT, "u-owner")).toEqual([]);
  });
});

describe("cambio de rol", () => {
  it("un OWNER puede cambiar el rol de otro miembro y queda auditado", async () => {
    const row = await service.changeRole({
      tenantId: TENANT,
      actor: OWNER,
      membershipId: "m-vendor",
      role: "FINANCE",
    });

    expect(row.role).toBe("FINANCE");
    expect(db.memberships.find((m) => m.id === "m-vendor")!.role).toBe("FINANCE");
    expect(db.memberships.find((m) => m.id === "m-vendor")!.version).toBe(2);

    expect(db.auditLog).toHaveLength(1);
    expect(db.auditLog[0]).toMatchObject({
      tenantId: TENANT,
      actorId: "u-owner",
      action: "user.role_changed",
      targetType: "Membership",
      targetId: "m-vendor",
      metadata: { fromRole: "VENDOR", toRole: "FINANCE", email: "vendor@acme.mx" },
    });
  });

  it("un ADMIN no puede degradar a un OWNER (primera barrera del anti-lockout)", async () => {
    await expect(
      service.changeRole({
        tenantId: TENANT,
        actor: ADMIN,
        membershipId: "m-owner",
        role: "VIEWER",
      }),
    ).rejects.toThrow(/propietario/i);

    expect(db.memberships.find((m) => m.id === "m-owner")!.role).toBe("OWNER");
    expect(db.auditLog).toHaveLength(0);
  });

  it("rechaza degradar al último OWNER activo (conteo dentro del lock)", async () => {
    // Dos OWNERs activos. Cada uno intenta degradar al otro a la vez: el lock de
    // la fila del Tenant las serializa, así que la segunda transacción cuenta
    // DESPUÉS de que la primera ya deshabilitó al otro propietario.
    db.memberships.push({
      id: "m-owner2",
      tenantId: TENANT,
      userId: "u-owner2",
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date("2024-01-02"),
      createdAt: new Date("2024-01-02"),
      version: 1,
    });

    const realCount = db.prisma.membership.count;
    db.prisma.membership.count = async (args: never) => {
      // La transacción rival ya se comprometió: u-owner2 dejó de ser OWNER activo.
      db.memberships.find((m) => m.id === "m-owner2")!.status = "DISABLED";
      db.prisma.membership.count = realCount;
      return realCount(args);
    };

    await expect(
      service.changeRole({
        tenantId: TENANT,
        actor: { userId: "u-owner2", role: "OWNER" },
        membershipId: "m-owner",
        role: "VIEWER",
      }),
    ).rejects.toThrow(/propietarios activos/i);

    expect(db.memberships.find((m) => m.id === "m-owner")!.role).toBe("OWNER");
    expect(db.auditLog).toHaveLength(0);
  });

  it("permite degradar a un OWNER si queda otro OWNER activo", async () => {
    db.memberships.push({
      id: "m-owner2",
      tenantId: TENANT,
      userId: "u-owner2",
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date("2024-01-02"),
      createdAt: new Date("2024-01-02"),
      version: 1,
    });

    const row = await service.changeRole({
      tenantId: TENANT,
      actor: OWNER,
      membershipId: "m-owner2",
      role: "FINANCE",
    });

    expect(row.role).toBe("FINANCE");
    expect(db.auditLog[0]).toMatchObject({ action: "user.role_changed" });
  });

  it("rechaza que alguien cambie su propio rol (auto-escalada)", async () => {
    await expect(
      service.changeRole({
        tenantId: TENANT,
        actor: ADMIN,
        membershipId: "m-admin",
        role: "OWNER",
      }),
    ).rejects.toThrow(/tu propio rol/i);

    expect(db.memberships.find((m) => m.id === "m-admin")!.role).toBe("ADMIN");
    expect(db.auditLog).toHaveLength(0);
  });

  it("un ADMIN no puede otorgar OWNER a nadie", async () => {
    await expect(
      service.changeRole({
        tenantId: TENANT,
        actor: ADMIN,
        membershipId: "m-vendor",
        role: "OWNER",
      }),
    ).rejects.toThrow(/propietario/i);

    expect(db.memberships.find((m) => m.id === "m-vendor")!.role).toBe("VENDOR");
  });

  it("rechaza a un llamador sin users.manage", async () => {
    await expect(
      service.changeRole({
        tenantId: TENANT,
        actor: VENDOR,
        membershipId: "m-admin",
        role: "VIEWER",
      }),
    ).rejects.toThrow(/users\.manage/);

    expect(db.auditLog).toHaveLength(0);
  });

  it("rechaza un rol inexistente", async () => {
    await expect(
      service.changeRole({
        tenantId: TENANT,
        actor: OWNER,
        membershipId: "m-vendor",
        role: "ROOT",
      }),
    ).rejects.toThrow(/Rol inválido/);
  });

  it("no toca membresías de otro tenant", async () => {
    await expect(
      service.changeRole({
        tenantId: OTHER_TENANT,
        actor: OWNER,
        membershipId: "m-vendor",
        role: "VIEWER",
      }),
    ).rejects.toThrow();
  });
});

describe("remover miembro", () => {
  it("deshabilita la membresía, revoca sesiones y audita", async () => {
    const result = await service.remove({
      tenantId: TENANT,
      actor: OWNER,
      membershipId: "m-vendor",
    });

    expect(result).toEqual({ id: "m-vendor", status: "DISABLED" });
    // Transición de estado, no borrado: la fila sigue ahí.
    expect(db.memberships.find((m) => m.id === "m-vendor")!.status).toBe("DISABLED");
    expect(db.sessions[0].revokedAt).toBeInstanceOf(Date);
    expect(db.auditLog[0]).toMatchObject({
      action: "user.removed",
      targetId: "m-vendor",
      actorId: "u-owner",
    });
  });

  it("un ADMIN no puede remover a un OWNER", async () => {
    await expect(
      service.remove({ tenantId: TENANT, actor: ADMIN, membershipId: "m-owner" }),
    ).rejects.toThrow(/propietario/i);
    expect(db.memberships.find((m) => m.id === "m-owner")!.status).toBe("ACTIVE");
  });

  it("rechaza remover al último OWNER activo (conteo dentro del lock)", async () => {
    db.memberships.push({
      id: "m-owner2",
      tenantId: TENANT,
      userId: "u-owner2",
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date("2024-01-02"),
      createdAt: new Date("2024-01-02"),
      version: 1,
    });

    const realCount = db.prisma.membership.count;
    db.prisma.membership.count = async (args: never) => {
      db.memberships.find((m) => m.id === "m-owner2")!.status = "DISABLED";
      db.prisma.membership.count = realCount;
      return realCount(args);
    };

    await expect(
      service.remove({
        tenantId: TENANT,
        actor: { userId: "u-owner2", role: "OWNER" },
        membershipId: "m-owner",
      }),
    ).rejects.toThrow(/propietarios activos/i);
    expect(db.memberships.find((m) => m.id === "m-owner")!.status).toBe("ACTIVE");
    expect(db.auditLog).toHaveLength(0);
  });

  it("nadie se remueve a sí mismo", async () => {
    await expect(
      service.remove({ tenantId: TENANT, actor: ADMIN, membershipId: "m-admin" }),
    ).rejects.toThrow(/ti mismo/i);
    expect(db.memberships.find((m) => m.id === "m-admin")!.status).toBe("ACTIVE");
  });

  it("rechaza a un llamador sin users.manage", async () => {
    await expect(
      service.remove({ tenantId: TENANT, actor: VENDOR, membershipId: "m-admin" }),
    ).rejects.toThrow(/users\.manage/);
  });
});

describe("revocar invitación", () => {
  it("caduca el enlace y audita", async () => {
    const result = await service.revokeInvitation({
      tenantId: TENANT,
      actor: ADMIN,
      invitationId: "i-1",
    });

    expect(result).toEqual({ id: "i-1" });
    const invite = db.invitations.find((i) => i.id === "i-1")!;
    expect((invite.expiresAt as Date).getTime()).toBeLessThanOrEqual(Date.now());
    expect(db.auditLog[0]).toMatchObject({
      action: "user.invitation_revoked",
      targetType: "Invitation",
      targetId: "i-1",
      actorId: "u-admin",
      metadata: { email: "nuevo@acme.mx", role: "SUPPORT" },
    });

    // Y desaparece de la lista.
    const rows = await service.list(TENANT, "u-admin");
    expect(rows.find((r) => r.id === "i-1")).toBeUndefined();
  });

  it("rechaza a un llamador sin users.manage", async () => {
    await expect(
      service.revokeInvitation({ tenantId: TENANT, actor: VENDOR, invitationId: "i-1" }),
    ).rejects.toThrow(/users\.manage/);
    expect(db.auditLog).toHaveLength(0);
  });

  it("un ADMIN no puede revocar una invitación de OWNER", async () => {
    await expect(
      service.revokeInvitation({
        tenantId: TENANT,
        actor: ADMIN,
        invitationId: "i-owner-bootstrap",
      }),
    ).rejects.toThrow(/propietario/i);
  });

  it("rechaza una invitación ya aceptada", async () => {
    db.invitations.find((i) => i.id === "i-1")!.acceptedAt = new Date();
    await expect(
      service.revokeInvitation({ tenantId: TENANT, actor: OWNER, invitationId: "i-1" }),
    ).rejects.toThrow(/ya fue aceptada/i);
  });

  it("no revoca invitaciones de otro tenant", async () => {
    await expect(
      service.revokeInvitation({ tenantId: OTHER_TENANT, actor: OWNER, invitationId: "i-1" }),
    ).rejects.toThrow(/no está activo|no encontrada/i);
  });
});
