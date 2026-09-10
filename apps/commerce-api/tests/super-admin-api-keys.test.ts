import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { SuperAdminTenantsController } from "../src/tenants/tenants.controller.js";
import { RequestContext } from "../src/common/context/request-context.js";

/**
 * /super-admin/tenants/:id/api-keys: lo que se fija aquí es que (a) la empresa
 * debe existir (404 NOT_FOUND), (b) crear exige un actor identificado y deja
 * bitácora `apikey.created`, y (c) revocar deja bitácora `apikey.revoked`.
 * Prisma y ApiKeyService son fakes en memoria; no hay base de datos.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const SUPER = { type: "USER" as const, userId: "u-super", isSuperAdmin: true };

interface Row {
  [key: string]: unknown;
}

function makeDb() {
  const tenants: Row[] = [{ id: TENANT, name: "Acme", slug: "acme", status: "ACTIVE" }];
  const apiKeys: Row[] = [
    { id: "k-1", tenantId: TENANT, name: "ERP", prefix: "npk_abc", revokedAt: null },
  ];
  const auditLog: Row[] = [];
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const prisma = {
    tenant: {
      findUnique: async ({ where }: { where: Row }) =>
        tenants.find((t) => t.id === where.id) ?? null,
    },
    apiKey: {
      findFirst: async ({ where }: { where: Row }) =>
        apiKeys.find(
          (k) => k.id === where.id && k.tenantId === where.tenantId && k.revokedAt === null,
        ) ?? null,
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        auditLog.push({ ...data });
        return data;
      },
    },
  };

  const service = {
    list: async (tenantId: string) => {
      calls.push({ method: "list", args: [tenantId] });
      return apiKeys.filter((k) => k.tenantId === tenantId);
    },
    create: async (input: Row) => {
      calls.push({ method: "create", args: [input] });
      return {
        id: "k-new",
        prefix: "npk_new",
        name: input.name,
        scopes: input.scopes,
        secret: "npk_new_secret",
        expiresAt: null,
      };
    },
    revoke: async (tenantId: string, id: string) => {
      calls.push({ method: "revoke", args: [tenantId, id] });
      const found = apiKeys.find((k) => k.id === id && k.tenantId === tenantId && k.revokedAt === null);
      if (!found) throw new NotFoundException({ code: "NOT_FOUND", message: "API key no encontrada" });
      found.revokedAt = new Date();
      return { ok: true };
    },
  };

  return { prisma, service, auditLog, calls };
}

let db: ReturnType<typeof makeDb>;
let controller: SuperAdminTenantsController;

const asSuper = <T>(fn: () => Promise<T>) =>
  RequestContext.run(fn, { requestId: "req-1", principal: SUPER });

beforeEach(() => {
  db = makeDb();
  controller = new SuperAdminTenantsController(
    db.prisma as never,
    {} as never,
    {} as never,
    {} as never,
    db.service as never,
  );
});

describe("super-admin: API keys por empresa", () => {
  it("lista las keys de la empresa", async () => {
    const res = await asSuper(() => controller.listApiKeys(TENANT));
    expect(res.data).toHaveLength(1);
    expect(res.requestId).toBe("req-1");
    expect(db.calls).toEqual([{ method: "list", args: [TENANT] }]);
  });

  it("una empresa inexistente responde 404 NOT_FOUND sin tocar el servicio", async () => {
    const err = await asSuper(() => controller.listApiKeys("nope")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toEqual({
      code: "NOT_FOUND",
      message: "Empresa no encontrada",
    });
    expect(db.calls).toHaveLength(0);
  });

  it("crear exige actor identificado (403 sin userId)", async () => {
    await expect(
      RequestContext.run(
        () => controller.createApiKey(TENANT, { name: "ERP", scopes: ["catalog.read"] }),
        { principal: { type: "ANONYMOUS" } },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.calls).toHaveLength(0);
    expect(db.auditLog).toHaveLength(0);
  });

  it("crear devuelve el secreto una sola vez y deja bitácora apikey.created", async () => {
    const res = await asSuper(() =>
      controller.createApiKey(TENANT, { name: "ERP", scopes: ["catalog.read"], expiresInDays: 30 }),
    );
    expect(res.data.secret).toBe("npk_new_secret");
    expect(db.calls[0]).toEqual({
      method: "create",
      args: [
        { tenantId: TENANT, actorId: "u-super", name: "ERP", scopes: ["catalog.read"], expiresInDays: 30 },
      ],
    });
    expect(db.auditLog.at(-1)).toMatchObject({
      tenantId: TENANT,
      actorId: "u-super",
      action: "apikey.created",
      targetType: "ApiKey",
      targetId: "k-new",
      metadata: { name: "ERP", prefix: "npk_new", scopes: ["catalog.read"], via: "super-admin" },
    });
  });

  it("revocar deja bitácora apikey.revoked con nombre y prefijo", async () => {
    await asSuper(() => controller.revokeApiKey(TENANT, "k-1"));
    expect(db.calls).toEqual([{ method: "revoke", args: [TENANT, "k-1"] }]);
    expect(db.auditLog.at(-1)).toMatchObject({
      tenantId: TENANT,
      actorId: "u-super",
      action: "apikey.revoked",
      targetType: "ApiKey",
      targetId: "k-1",
      metadata: { name: "ERP", prefix: "npk_abc", via: "super-admin" },
    });
  });

  it("revocar una key inexistente responde 404 y no deja bitácora", async () => {
    await expect(asSuper(() => controller.revokeApiKey(TENANT, "k-nope"))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.auditLog).toHaveLength(0);
  });
});
