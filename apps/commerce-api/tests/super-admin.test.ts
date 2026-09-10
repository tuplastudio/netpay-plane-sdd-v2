import { beforeEach, describe, expect, it } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import {
  OWNER_INVARIANT_MESSAGE,
  SuperAdminMembershipService,
} from "../src/super-admin/super-admin-membership.service.js";
import { SuperAdminService } from "../src/super-admin/super-admin.service.js";
import { UsageService } from "../src/usage/usage.service.js";

/**
 * /super-admin: lo que se fija aquí es (a) el anti-lockout cross-tenant —una
 * empresa nunca se queda sin OWNER ACTIVE, y la violación es 409 CONFLICT— y
 * (b) el mapeo de los agregados (overview y lista de empresas con gasto MTD).
 * Prisma es un fake en memoria; no hay base de datos.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";
const SUPER = { userId: "u-super" };

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

function makeDb() {
  const tenants: Row[] = [
    { id: TENANT, name: "Acme", slug: "acme", status: "ACTIVE", version: 1, createdAt: new Date("2024-01-01"), primaryColor: "#000", accentColor: "#fff" },
    { id: OTHER_TENANT, name: "Globex", slug: "globex", status: "DISABLED", version: 1, createdAt: new Date("2024-02-01"), primaryColor: "#000", accentColor: "#fff" },
  ];
  const users: Row[] = [
    { id: "u-owner", email: "owner@acme.mx", fullName: "Olivia Owner", isSuperAdmin: false, passwordHash: "$argon2id$secreto", createdAt: new Date("2024-01-01") },
    { id: "u-owner2", email: "owner2@acme.mx", fullName: "Omar Owner", isSuperAdmin: false, passwordHash: "$argon2id$secreto", createdAt: new Date("2024-01-02") },
    { id: "u-vendor", email: "vendor@acme.mx", fullName: "Vera Vendedora", isSuperAdmin: false, passwordHash: "$argon2id$secreto", createdAt: new Date("2024-01-03") },
  ];
  const memberships: Row[] = [
    { id: "m-owner", tenantId: TENANT, userId: "u-owner", role: "OWNER", status: "ACTIVE", joinedAt: new Date("2024-01-01"), createdAt: new Date("2024-01-01"), updatedAt: new Date("2024-01-01"), version: 1 },
    { id: "m-owner2", tenantId: TENANT, userId: "u-owner2", role: "OWNER", status: "DISABLED", joinedAt: new Date("2024-01-02"), createdAt: new Date("2024-01-02"), updatedAt: new Date("2024-01-02"), version: 1 },
    { id: "m-vendor", tenantId: TENANT, userId: "u-vendor", role: "VENDOR", status: "ACTIVE", joinedAt: new Date("2024-01-03"), createdAt: new Date("2024-01-03"), updatedAt: new Date("2024-01-03"), version: 1 },
  ];
  const invitations: Row[] = [
    { id: "i-1", tenantId: TENANT, email: "nuevo@acme.mx", fullName: "Nadia", role: "SUPPORT", acceptedAt: null, expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date() },
    { id: "i-accepted", tenantId: TENANT, email: "vendor@acme.mx", fullName: "Vera", role: "VENDOR", acceptedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date() },
  ];
  const sessions: Row[] = [{ id: "s-1", tenantId: TENANT, userId: "u-owner", revokedAt: null }];
  const auditLog: Row[] = [];
  const usageRows = [
    { tenantId: TENANT, _count: { _all: 3 }, _sum: { inputTokens: 1000, outputTokens: 500, costUsd: "0.1234" } },
  ];

  const withUser = (m: Row): Row => ({ ...m, user: users.find((u) => u.id === m.userId) as Row });
  const matches = (m: Row, where: Row) =>
    (where.id === undefined || (typeof where.id === "string" ? m.id === where.id : m.id !== (where.id as { not: string }).not)) &&
    (where.tenantId === undefined || m.tenantId === where.tenantId) &&
    (where.role === undefined || m.role === where.role) &&
    (where.status === undefined || m.status === where.status);

  const prisma = {
    tenant: {
      findUnique: async ({ where }: { where: Row }) => tenants.find((t) => t.id === where.id) ?? null,
      findMany: async () => tenants.map((t) => ({ ...t, _count: { memberships: 0, products: 0, orders: 0 } })),
      groupBy: async () => [
        { status: "ACTIVE", _count: { _all: 1 } },
        { status: "DISABLED", _count: { _all: 1 } },
      ],
    },
    user: {
      count: async () => new Set(memberships.map((m) => m.userId)).size,
    },
    invitation: {
      count: async () => invitations.filter((i) => i.acceptedAt === null).length,
      findFirst: async ({ where, select }: { where: Row; select?: Record<string, unknown> }) => {
        const found = invitations.find((i) => i.id === where.id && i.tenantId === where.tenantId);
        return found ? project(found, select) : null;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const found = invitations.find((i) => i.id === where.id)!;
        Object.assign(found, data);
        return { ...found };
      },
    },
    agentUsageEvent: {
      groupBy: async () => usageRows,
      aggregate: async () => ({
        _count: { _all: 3 },
        _sum: { inputTokens: 1000, outputTokens: 500, costUsd: "0.1234" },
      }),
    },
    membership: {
      findFirst: async ({ where, select }: { where: Row; select?: Record<string, unknown> }) => {
        const found = memberships.find((m) => matches(m, where));
        return found ? project(withUser(found), select) : null;
      },
      count: async ({ where }: { where: Row }) => memberships.filter((m) => matches(m, where)).length,
      update: async ({ where, data, select }: { where: Row; data: Row; select?: Record<string, unknown> }) => {
        const found = memberships.find((m) => m.id === where.id)!;
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
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        auditLog.push({ ...data });
        return data;
      },
    },
    $queryRaw: async () => [],
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(prisma),
  };

  return { prisma, memberships, invitations, auditLog, sessions };
}

const invites = { createInvite: async () => ({ token: "tok", expiresAt: new Date() }) };
const mailer = { sendBestEffort: async () => undefined };

let db: ReturnType<typeof makeDb>;
let people: SuperAdminMembershipService;
let admin: SuperAdminService;

beforeEach(() => {
  db = makeDb();
  people = new SuperAdminMembershipService(db.prisma as never, invites as never, mailer as never);
  admin = new SuperAdminService(db.prisma as never, new UsageService(db.prisma as never));
});

describe("anti-lockout cross-tenant (al menos un OWNER ACTIVE)", () => {
  it("degradar al único OWNER activo responde 409 CONFLICT", async () => {
    const err = await people
      .updateMembership({ tenantId: TENANT, actor: SUPER, membershipId: "m-owner", role: "VIEWER" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toEqual({
      code: "CONFLICT",
      message: OWNER_INVARIANT_MESSAGE,
    });
    expect(db.memberships.find((m) => m.id === "m-owner")!.role).toBe("OWNER");
    expect(db.auditLog).toHaveLength(0);
  });

  it("deshabilitar (PATCH status o DELETE) al único OWNER activo responde 409", async () => {
    await expect(
      people.updateMembership({ tenantId: TENANT, actor: SUPER, membershipId: "m-owner", status: "DISABLED" }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      people.removeMembership({ tenantId: TENANT, actor: SUPER, membershipId: "m-owner" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.memberships.find((m) => m.id === "m-owner")!.status).toBe("ACTIVE");
  });

  it("reactivar a un OWNER deshabilitado se permite, y después sí se puede degradar al otro", async () => {
    const reactivated = await people.updateMembership({
      tenantId: TENANT,
      actor: SUPER,
      membershipId: "m-owner2",
      status: "ACTIVE",
    });
    expect(reactivated.status).toBe("ACTIVE");
    expect(reactivated.user).toEqual({
      id: "u-owner2",
      email: "owner2@acme.mx",
      fullName: "Omar Owner",
      isSuperAdmin: false,
      createdAt: new Date("2024-01-02"),
    });
    expect(JSON.stringify(reactivated)).not.toContain("argon2id");
    expect(db.auditLog.at(-1)).toMatchObject({
      actorId: "u-super",
      action: "user.reactivated",
      targetId: "m-owner2",
      metadata: { via: "super-admin", fromStatus: "DISABLED", toStatus: "ACTIVE" },
    });

    const demoted = await people.updateMembership({
      tenantId: TENANT,
      actor: SUPER,
      membershipId: "m-owner",
      role: "ADMIN",
      status: "DISABLED",
    });
    expect(demoted.role).toBe("ADMIN");
    expect(demoted.status).toBe("DISABLED");
    expect(demoted.version).toBe(2);
    // Sesiones del deshabilitado cortadas.
    expect(db.sessions[0].revokedAt).toBeInstanceOf(Date);
    const actions = db.auditLog.map((a) => a.action);
    expect(actions).toEqual(["user.reactivated", "user.role_changed", "user.removed"]);
  });

  it("cambiar el rol de un no-OWNER no toca el invariante", async () => {
    const row = await people.updateMembership({
      tenantId: TENANT,
      actor: SUPER,
      membershipId: "m-vendor",
      role: "OWNER",
    });
    expect(row.role).toBe("OWNER");
    expect(db.auditLog[0]).toMatchObject({
      action: "user.role_changed",
      metadata: { fromRole: "VENDOR", toRole: "OWNER", via: "super-admin" },
    });
  });

  it("DELETE es idempotente sobre una membresía ya DISABLED", async () => {
    const res = await people.removeMembership({ tenantId: TENANT, actor: SUPER, membershipId: "m-owner2" });
    expect(res).toEqual({ id: "m-owner2", status: "DISABLED" });
    expect(db.auditLog).toHaveLength(0);
  });

  it("membresía de otro tenant o tenant inexistente responden 404", async () => {
    await expect(
      people.updateMembership({ tenantId: OTHER_TENANT, actor: SUPER, membershipId: "m-vendor", role: "ADMIN" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      people.removeMembership({ tenantId: "33333333-3333-3333-3333-333333333333", actor: SUPER, membershipId: "m-vendor" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("PATCH sin role ni status es 400", async () => {
    await expect(
      people.updateMembership({ tenantId: TENANT, actor: SUPER, membershipId: "m-vendor" }),
    ).rejects.toThrow(/role/);
  });
});

describe("invitaciones cross-tenant", () => {
  it("rechaza con 409 invitar a un correo que ya es miembro ACTIVE", async () => {
    // El fake de membership.findFirst no filtra por user.email; se simula el hit.
    db.prisma.membership.findFirst = async () => ({ id: "m-vendor" }) as never;
    await expect(
      people.invite({ tenantId: TENANT, actor: SUPER, email: "Vendor@acme.mx", fullName: "Vera", role: "OWNER" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("crea la invitación con rol OWNER y devuelve token/expiresAt", async () => {
    db.prisma.membership.findFirst = async () => null as never;
    const res = await people.invite({ tenantId: TENANT, actor: SUPER, email: "Nueva@acme.mx", fullName: "Nueva", role: "OWNER" });
    expect(res).toEqual({ token: "tok", expiresAt: expect.any(Date) });
    expect(db.auditLog[0]).toMatchObject({
      action: "user.invitation_sent",
      actorId: "u-super",
      metadata: { email: "nueva@acme.mx", role: "OWNER", via: "super-admin" },
    });
  });

  it("revoca una pendiente caducando el enlace; una aceptada es 400", async () => {
    await people.revokeInvitation({ tenantId: TENANT, actor: SUPER, invitationId: "i-1" });
    expect((db.invitations[0].expiresAt as Date).getTime()).toBe(0);
    expect(db.auditLog[0]).toMatchObject({ action: "user.invitation_revoked", targetId: "i-1" });
    await expect(
      people.revokeInvitation({ tenantId: TENANT, actor: SUPER, invitationId: "i-accepted" }),
    ).rejects.toThrow(/aceptada/);
  });
});

describe("agregados de plataforma", () => {
  it("overview: conteos de empresas, usuarios distintos, invitaciones pendientes y uso MTD", async () => {
    const data = await admin.overview();
    expect(data.tenants).toEqual({ total: 2, active: 1, disabled: 1 });
    expect(data.users).toBe(3);
    expect(data.pendingInvitations).toBe(1);
    expect(data.usageMtd).toEqual({ costUsd: "0.123400", totalTokens: 1500, events: 3 });
    expect(data.from).toBeInstanceOf(Date);
    expect(data.to).toBeInstanceOf(Date);
    expect(data.from.getDate()).toBe(1);
    expect(data.from.getTime()).toBeLessThanOrEqual(data.to.getTime());
  });

  it("lista de empresas: pega usageMtd por tenant y cero para las que no consumieron", async () => {
    const rows = await admin.listTenants();
    const acme = rows.find((t) => t.id === TENANT)!;
    const globex = rows.find((t) => t.id === OTHER_TENANT)!;
    expect(acme.usageMtd).toEqual({ costUsd: "0.123400", totalTokens: 1500, events: 3 });
    expect(globex.usageMtd).toEqual({ costUsd: "0.000000", totalTokens: 0, events: 0 });
    expect(acme._count).toEqual({ memberships: 0, products: 0, orders: 0 });
  });
});
