import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `ApiKeyService.resolve` memoiza la verificación Argon2 (la parte cara) pero
 * sigue leyendo la fila de la key en cada petición: lo que se fija aquí es
 * que argon2 corre una vez por token, que un token distinto sí se verifica,
 * que la revocación se ve al instante aunque el memo siga vivo, y que
 */
const verify = vi.fn(async (hash: string, token: string) => hash === `argon:${token}`);
vi.mock("argon2", () => ({
  default: { verify: (...args: [string, string]) => verify(...args), hash: vi.fn(), argon2id: 2 },
}));

const { ApiKeyService } = await import("../src/auth/api-key.service.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const TOKEN = "npk_abc123_secretsecret";
const OTHER = "npk_abc123_otrosecreto";

interface Row {
  [key: string]: unknown;
}

function makeDb() {
  const key: Row = {
    id: "k-1",
    tenantId: TENANT,
    prefix: "npk_abc123",
    scopes: ["catalog.read"],
    secretHash: `argon:${TOKEN}`,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
  };
  const calls = { find: 0, update: 0 };
  const prisma = {
    apiKey: {
      findFirst: async ({ where }: { where: Row }) => {
        calls.find += 1;
        return key.prefix === where.prefix && key.revokedAt === null ? { ...key } : null;
      },
      update: async ({ data }: { data: Row }) => {
        calls.update += 1;
        Object.assign(key, data);
        return key;
      },
    },
  };
  return { prisma, key, calls };
}

beforeEach(() => {
  verify.mockClear();
});

describe("ApiKeyService.resolve: memo de verificación", () => {
  it("argon2 corre una vez por token; la fila se relee en cada petición", async () => {
    const db = makeDb();
    const svc = new ApiKeyService(db.prisma as never);
    for (let i = 0; i < 4; i++) {
      const p = await svc.resolve(TOKEN);
      expect(p).toMatchObject({ apiKeyId: "k-1", tenantId: TENANT, isGlobal: false });
    }
    expect(verify).toHaveBeenCalledTimes(1);
    expect(db.calls.find).toBe(4);
  });

  it("un token distinto con el mismo prefijo sí se verifica (y falla)", async () => {
    const db = makeDb();
    const svc = new ApiKeyService(db.prisma as never);
    expect(await svc.resolve(TOKEN)).not.toBeNull();
    expect(await svc.resolve(OTHER)).toBeNull();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("revocar se ve al instante aunque el memo siga vivo", async () => {
    const db = makeDb();
    const svc = new ApiKeyService(db.prisma as never);
    expect(await svc.resolve(TOKEN)).not.toBeNull();
    db.key.revokedAt = new Date();
    expect(await svc.resolve(TOKEN)).toBeNull();
  });

  it("si cambia el hash de la fila, el memo deja de valer y se vuelve a verificar", async () => {
    const db = makeDb();
    const svc = new ApiKeyService(db.prisma as never);
    expect(await svc.resolve(TOKEN)).not.toBeNull();
    db.key.secretHash = "argon:rotado";
    expect(await svc.resolve(TOKEN)).toBeNull();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("expirada: null sin verificar", async () => {
    const db = makeDb();
    db.key.expiresAt = new Date(Date.now() - 1);
    const svc = new ApiKeyService(db.prisma as never);
    expect(await svc.resolve(TOKEN)).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });

  it("resolve no escribe lastUsedAt (lo hace ApiKeyUsageService con throttle)", async () => {
    const db = makeDb();
    const svc = new ApiKeyService(db.prisma as never);
    await svc.resolve(TOKEN);
    await svc.resolve(TOKEN);
    expect(db.calls.update).toBe(0);
  });

  it("formato inválido: null sin tocar la base", async () => {
    const db = makeDb();
    const svc = new ApiKeyService(db.prisma as never);
    expect(await svc.resolve("Bearer x")).toBeNull();
    expect(await svc.resolve("npk_solo")).toBeNull();
    expect(db.calls.find).toBe(0);
  });
});
