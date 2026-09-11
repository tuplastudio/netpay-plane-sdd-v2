import { describe, expect, it } from "vitest";
import { BootstrapService } from "../src/auth/bootstrap.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

/**
 * Regresión de aislamiento de plataforma.
 *
 * (a) POST /auth/bootstrap es @Public(). Antes marcaba `isSuperAdmin: true` en
 *     CUALQUIER bootstrap de un tenant nuevo, así que un desconocido podía
 *     pedir un slug libre y salir con permisos sobre TODAS las empresas. El
 *     flag ahora solo se concede en una instalación virgen.
 * (b) PrismaService.withTenant interpolaba el tenantId en un `SET LOCAL`;
 *     ahora exige UUID antes de tocar la base.
 *
 * Prisma es un fake en memoria; no hay base de datos.
 */

interface Row {
  [key: string]: unknown;
}

function makeDb(seed: { tenants?: Row[]; users?: Row[] } = {}) {
  const tenants: Row[] = seed.tenants ? [...seed.tenants] : [];
  const users: Row[] = seed.users ? [...seed.users] : [];

  return {
    tenants,
    users,
    tenant: {
      findUnique: async ({ where }: { where: { slug?: string } }) =>
        tenants.find((t) => t.slug === where.slug) ?? null,
      count: async () => tenants.length,
      create: async ({ data }: { data: Row }) => {
        const row = { id: `t-${tenants.length + 1}`, configVersion: 1, ...data };
        tenants.push(row);
        return row;
      },
    },
    user: {
      findUnique: async ({ where }: { where: { email?: string } }) =>
        users.find((u) => u.email === where.email) ?? null,
      count: async ({ where }: { where?: { isSuperAdmin?: boolean } } = {}) =>
        where?.isSuperAdmin === undefined
          ? users.length
          : users.filter((u) => u.isSuperAdmin === where.isSuperAdmin).length,
      create: async ({ data }: { data: Row }) => {
        const row = { id: `u-${users.length + 1}`, ...data };
        users.push(row);
        return row;
      },
    },
    membership: { create: async ({ data }: { data: Row }) => ({ id: "m-1", ...data }) },
    invitation: { create: async ({ data }: { data: Row }) => ({ id: "i-1", ...data }) },
    auditLog: { create: async ({ data }: { data: Row }) => ({ id: "a-1", ...data }) },
  };
}

const passwords = { hash: async (raw: string) => `hashed:${raw}` };
const tokens = {
  issue: () => ({ token: "tok", tokenHash: "tok-hash", expiresAt: new Date(Date.now() + 3600_000) }),
};

function makeService(db: ReturnType<typeof makeDb>) {
  return new BootstrapService(
    db as never,
    passwords as never,
    tokens as never,
  );
}

const INPUT = {
  tenantName: "Empresa Nueva",
  ownerEmail: "Owner@Nueva.MX",
  ownerFullName: "Olivia Owner",
  ownerPassword: "Sup3rSecreta!",
  timezone: "America/Mexico_City",
};

describe("BootstrapService: concesión de isSuperAdmin", () => {
  it("concede isSuperAdmin en una instalación virgen (sin tenants ni super admins)", async () => {
    const db = makeDb();
    await makeService(db).run(INPUT);

    expect(db.users).toHaveLength(1);
    expect(db.users[0].isSuperAdmin).toBe(true);
  });

  it("NO concede isSuperAdmin si ya existe otra empresa", async () => {
    const db = makeDb({
      tenants: [{ id: "t-acme", slug: "acme", name: "Acme", configVersion: 1 }],
      users: [{ id: "u-super", email: "super@netpay.mx", isSuperAdmin: true }],
    });

    await makeService(db).run(INPUT);

    const creado = db.users.find((u) => u.email === "owner@nueva.mx");
    expect(creado).toBeDefined();
    // El punto de toda la regresión: un desconocido no se lleva la plataforma.
    expect(creado?.isSuperAdmin).toBe(false);
  });

  it("NO concede isSuperAdmin aunque no haya tenants, si ya hay un super admin", async () => {
    const db = makeDb({ users: [{ id: "u-super", email: "super@netpay.mx", isSuperAdmin: true }] });

    await makeService(db).run(INPUT);

    expect(db.users.find((u) => u.email === "owner@nueva.mx")?.isSuperAdmin).toBe(false);
  });

  it("sigue siendo idempotente: un slug ya existente no crea un segundo owner", async () => {
    const db = makeDb({
      tenants: [{ id: "t-nueva", slug: "empresa-nueva", name: "Empresa Nueva", configVersion: 3 }],
      users: [{ id: "u-existente", email: "Owner@Nueva.MX", isSuperAdmin: false }],
    });

    const res = await makeService(db).run(INPUT);

    expect(res.alreadyExisted).toBe(true);
    expect(db.users).toHaveLength(1);
  });
});

describe("PrismaService.withTenant: el tenantId no llega crudo al SQL", () => {
  const prisma = new PrismaService();

  it.each([
    "' ; DROP TABLE \"Order\"; --",
    "",
    "acme",
    "11111111-1111-1111-1111-111111111111'",
  ])("rechaza %j sin abrir transacción", async (tenantId: string) => {
    let llamado = false;
    await expect(
      prisma.withTenant(tenantId, async () => {
        llamado = true;
        return null;
      }),
    ).rejects.toThrow(/tenantId inválido/);
    expect(llamado).toBe(false);
  });
});
