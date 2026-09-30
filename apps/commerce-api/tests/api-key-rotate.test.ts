import { beforeEach, describe, expect, it } from "vitest";
import "reflect-metadata";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import argon2 from "argon2";
import { ApiKeyService, apiKeyStatusOf } from "../src/auth/api-key.service.js";
import { ApiKeyController, diffApiKey } from "../src/auth/api-key.controller.js";
import { RotateApiKeyDto, UpdateApiKeyDto } from "../src/auth/iam.dto.js";
import { RequestContext, type Principal } from "../src/common/context/request-context.js";

/**
 * Rotación con gracia, edición y auditoría de API keys (T-IAM-05b). Prisma es
 * un fake en memoria; el hash Argon2 sí es real para comprobar que el secreto
 * nuevo valida y el viejo sigue validando durante la gracia.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const OWNER: Principal = { type: "USER", userId: "u-owner", tenantId: TENANT, role: "OWNER" };
const ADMIN: Principal = { type: "USER", userId: "u-admin", tenantId: TENANT, role: "ADMIN" };

interface KeyRow {
  id: string;
  tenantId: string | null;
  prefix: string;
  name: string;
  secretHash: string;
  scopes: string[];
  createdById: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  rotatedAt: Date | null;
  rotatedToId: string | null;
}

function makeDb(seed: Array<Partial<KeyRow>> = []) {
  let seq = 0;
  const keys: KeyRow[] = seed.map((k, i) => ({
    id: `k-${i + 1}`,
    tenantId: TENANT,
    prefix: `npk_seed${i + 1}`,
    name: `Key ${i + 1}`,
    secretHash: "",
    scopes: ["catalog.read"],
    createdById: "u-owner",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    rotatedAt: null,
    rotatedToId: null,
    ...k,
  }));
  const auditLog: Array<Record<string, unknown>> = [];

  const matches = (row: KeyRow, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => row[k as keyof KeyRow] === v);
  const pick = (row: KeyRow, select?: Record<string, boolean>) =>
    select ? Object.fromEntries(Object.entries(row).filter(([k]) => select[k])) : { ...row };

  const prisma = {
    apiKey: {
      findFirst: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
        const row = keys.find((k) => matches(k, where));
        return row ? pick(row, select) : null;
      },
      findMany: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) =>
        keys.filter((k) => matches(k, where)).map((k) => pick(k, select)),
      create: async ({ data }: { data: Omit<KeyRow, "id" | "createdAt"> }) => {
        seq += 1;
        const row: KeyRow = {
          id: `k-new-${seq}`,
          createdAt: new Date(),
          revokedAt: null,
          lastUsedAt: null,
          rotatedAt: null,
          rotatedToId: null,
          ...data,
        };
        keys.push(row);
        return row;
      },
      update: async ({ where, data, select }: { where: { id: string }; data: Partial<KeyRow>; select?: Record<string, boolean> }) => {
        const row = keys.find((k) => k.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return pick(row, select);
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<KeyRow> }) => {
        const hits = keys.filter((k) => matches(k, where));
        hits.forEach((k) => Object.assign(k, data));
        return { count: hits.length };
      },
    },
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, fullName: `User ${id}`, email: `${id}@acme.mx` })),
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLog.push(data);
        return data;
      },
    },
  };
  return { prisma, keys, auditLog };
}

const as = <T>(principal: Principal, fn: () => Promise<T>) =>
  RequestContext.run(fn, { requestId: "req-1", principal });

describe("ApiKeyService.rotate", () => {
  let db: ReturnType<typeof makeDb>;
  let service: ApiKeyService;

  beforeEach(() => {
    db = makeDb([{ scopes: ["catalog.read", "orders.read"], name: "ERP" }]);
    service = new ApiKeyService(db.prisma as never);
    delete process.env.API_KEY_ROTATION_GRACE_HOURS;
  });

  it("acuña una key nueva con el mismo nombre y scopes, y deja la vieja en gracia", async () => {
    const before = Date.now();
    const rotated = await service.rotate({ tenantId: TENANT, id: "k-1", actorId: "u-owner", graceHours: 2 });

    expect(rotated.name).toBe("ERP");
    expect(rotated.scopes).toEqual(["catalog.read", "orders.read"]);
    expect(rotated.secret.startsWith(rotated.prefix)).toBe(true);
    expect(rotated.rotatedFromId).toBe("k-1");
    expect(rotated.previousKey).toMatchObject({ id: "k-1", prefix: "npk_seed1", graceHours: 2 });

    const old = db.keys.find((k) => k.id === "k-1")!;
    expect(old.rotatedAt).toBeInstanceOf(Date);
    expect(old.rotatedToId).toBe(rotated.id);
    expect(old.revokedAt).toBeNull();
    expect(old.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 2 * 3600_000);
    expect(old.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 2 * 3600_000);
    expect(rotated.previousKey.validUntil).toEqual(old.expiresAt);

    const fresh = db.keys.find((k) => k.id === rotated.id)!;
    expect(fresh.createdById).toBe("u-owner");
    expect(await argon2.verify(fresh.secretHash, rotated.secret)).toBe(true);
    expect(apiKeyStatusOf(old)).toBe("ROTATED");
    expect(apiKeyStatusOf(fresh)).toBe("ACTIVE");
  });

  it("gracia 0 revoca la vieja en el acto", async () => {
    await service.rotate({ tenantId: TENANT, id: "k-1", actorId: "u-owner", graceHours: 0 });
    const old = db.keys.find((k) => k.id === "k-1")!;
    expect(old.revokedAt).toBeInstanceOf(Date);
    expect(apiKeyStatusOf(old)).toBe("REVOKED");
  });

  it("la gracia nunca alarga un vencimiento ya más cercano", async () => {
    const soon = new Date(Date.now() + 30 * 60_000);
    db.keys[0]!.expiresAt = soon;
    const rotated = await service.rotate({ tenantId: TENANT, id: "k-1", actorId: "u-owner", graceHours: 24 });
    expect(db.keys.find((k) => k.id === "k-1")!.expiresAt).toEqual(soon);
    // La sucesora hereda el vencimiento original.
    expect(rotated.expiresAt).toEqual(soon);
  });

  it("usa API_KEY_ROTATION_GRACE_HOURS cuando el body no trae gracia (default 24)", async () => {
    expect(service.defaultGraceHours()).toBe(24);
    process.env.API_KEY_ROTATION_GRACE_HOURS = "6";
    const rotated = await service.rotate({ tenantId: TENANT, id: "k-1", actorId: "u-owner" });
    expect(rotated.previousKey.graceHours).toBe(6);
    process.env.API_KEY_ROTATION_GRACE_HOURS = "999";
    expect(service.defaultGraceHours()).toBe(24);
  });

  it("no rota dos veces la misma key ni una ajena", async () => {
    await service.rotate({ tenantId: TENANT, id: "k-1", actorId: "u-owner", graceHours: 1 });
    await expect(
      service.rotate({ tenantId: TENANT, id: "k-1", actorId: "u-owner", graceHours: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.rotate({ tenantId: "other-tenant", id: "k-1", actorId: "u-owner" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("ApiKeyService.update y list", () => {
  it("edita nombre/scopes, expiresAt null quita el vencimiento y una fecha pasada se rechaza", async () => {
    const db = makeDb([{ expiresAt: new Date("2027-01-01T00:00:00Z") }]);
    const service = new ApiKeyService(db.prisma as never);
    const { before, after } = await service.update({
      tenantId: TENANT,
      id: "k-1",
      name: "Nuevo",
      scopes: ["orders.read"],
      expiresAt: null,
    });
    expect(before.name).toBe("Key 1");
    expect(after).toMatchObject({ name: "Nuevo", scopes: ["orders.read"], expiresAt: null });
    expect(db.keys[0]!.expiresAt).toBeNull();

    await expect(
      service.update({ tenantId: TENANT, id: "k-1", expiresAt: new Date("2020-01-01T00:00:00Z") }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("list resuelve quién la creó, deriva el estado y oculta revocadas salvo que se pidan", async () => {
    const db = makeDb([
      {},
      { revokedAt: new Date() },
      { expiresAt: new Date("2020-01-01T00:00:00Z") },
      { createdById: null },
    ]);
    const service = new ApiKeyService(db.prisma as never);
    const visible = await service.list(TENANT);
    expect(visible.map((k) => k.status)).toEqual(["ACTIVE", "EXPIRED", "ACTIVE"]);
    expect(visible[0]!.createdBy).toEqual({ id: "u-owner", fullName: "User u-owner", email: "u-owner@acme.mx" });
    expect(visible[2]!.createdBy).toBeNull();
    expect(visible.some((k) => "secretHash" in k)).toBe(false);

    const all = await service.list(TENANT, { includeRevoked: true });
    expect(all).toHaveLength(4);
    expect(all.find((k) => k.id === "k-2")!.status).toBe("REVOKED");
  });
});

describe("ApiKeyController: permisos y AuditLog en rotate/patch/revoke", () => {
  let db: ReturnType<typeof makeDb>;
  let controller: ApiKeyController;

  beforeEach(() => {
    db = makeDb([{ scopes: ["catalog.read"], name: "ERP" }]);
    const service = new ApiKeyService(db.prisma as never);
    controller = new ApiKeyController(
      service,
      {} as never,
      db.prisma as never,
      {} as never,
      { list: async () => ({ items: [], pageInfo: { nextCursor: null, size: 0 } }) } as never,
    );
  });

  it("rotar devuelve el secreto nuevo una sola vez y deja bitácora apikey.rotated", async () => {
    const res = await as(OWNER, () => controller.rotateKey("k-1", { graceHours: 1 }));
    expect(res.data.secret).toMatch(/^npk_[0-9a-f]{12}_/);
    expect(db.auditLog.at(-1)).toMatchObject({
      tenantId: TENANT,
      actorId: "u-owner",
      action: "apikey.rotated",
      targetType: "ApiKey",
      targetId: "k-1",
      metadata: { name: "ERP", previousPrefix: "npk_seed1", newKeyId: res.data.id, graceHours: 1 },
    });
  });

  it("rotar exige sesión humana (una API key no rota otra)", async () => {
    const apiKey: Principal = { type: "API_KEY", tenantId: TENANT, apiKeyId: "k-1", scopes: ["apikeys.manage"] };
    await expect(as(apiKey, () => controller.rotateKey("k-1", {}))).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.auditLog).toHaveLength(0);
  });

  it("PATCH audita solo lo que cambió y respeta el candado de scopes", async () => {
    const res = await as(OWNER, () =>
      controller.updateKey("k-1", { name: "ERP v2", scopes: ["catalog.read", "orders.read"] }),
    );
    expect(res.data.name).toBe("ERP v2");
    expect(db.auditLog.at(-1)).toMatchObject({
      action: "apikey.updated",
      targetId: "k-1",
      metadata: {
        changes: {
          name: { from: "ERP", to: "ERP v2" },
          scopes: { from: ["catalog.read"], to: ["catalog.read", "orders.read"] },
        },
      },
    });
    expect((db.auditLog.at(-1)!.metadata as { changes: Record<string, unknown> }).changes.expiresAt).toBeUndefined();

    await expect(
      as(ADMIN, () => controller.updateKey("k-1", { scopes: ["payments.refund"] })),
    ).rejects.toThrow(/No puedes otorgar scopes que tú no tienes: payments\.refund/);
  });

  it("revocar deja bitácora apikey.revoked con nombre y prefijo", async () => {
    await as(OWNER, () => controller.revokeKey("k-1"));
    expect(db.keys[0]!.revokedAt).toBeInstanceOf(Date);
    expect(db.auditLog.at(-1)).toMatchObject({
      action: "apikey.revoked",
      targetId: "k-1",
      metadata: { name: "ERP", prefix: "npk_seed1" },
    });
  });

  it("crear deja bitácora apikey.created", async () => {
    await as(OWNER, () => controller.createKey({ name: "Bot", scopes: ["catalog.read"] }));
    expect(db.auditLog.at(-1)).toMatchObject({ action: "apikey.created", metadata: { name: "Bot" } });
  });
});

describe("DTOs de rotación y edición", () => {
  it("graceHours acepta 0..168", () => {
    expect(validateSync(plainToInstance(RotateApiKeyDto, { graceHours: 0 }))).toEqual([]);
    expect(validateSync(plainToInstance(RotateApiKeyDto, { graceHours: 168 }))).toEqual([]);
    expect(validateSync(plainToInstance(RotateApiKeyDto, { graceHours: 169 })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(RotateApiKeyDto, { graceHours: -1 })).length).toBeGreaterThan(0);
  });

  it("expiresAt admite null (sin vencimiento) o ISO 8601, y rechaza basura", () => {
    expect(validateSync(plainToInstance(UpdateApiKeyDto, { expiresAt: null }))).toEqual([]);
    expect(validateSync(plainToInstance(UpdateApiKeyDto, { expiresAt: "2027-01-01T00:00:00.000Z" }))).toEqual([]);
    expect(validateSync(plainToInstance(UpdateApiKeyDto, { expiresAt: "mañana" })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(UpdateApiKeyDto, { scopes: ["nope"] })).length).toBeGreaterThan(0);
  });

  it("diffApiKey devuelve solo los campos que cambiaron", () => {
    const base = { name: "A", scopes: ["x", "y"], expiresAt: null };
    expect(diffApiKey(base, { ...base, scopes: ["y", "x"] })).toEqual({});
    expect(diffApiKey(base, { ...base, expiresAt: new Date("2027-01-01T00:00:00.000Z") })).toEqual({
      expiresAt: { from: null, to: "2027-01-01T00:00:00.000Z" },
    });
  });
});
