/**
 * API keys e identidad de servicios. Ver docs/03-iam.md T-IAM-05.
 *
 *  - prefijo público (lookup) + secret (hash Argon2).
 *  - scopes, expiraAt, revocaAt.
 *  - secret visible SOLO en create.
 */

import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { ALL_SCOPES } from "./policies.js";
import { TtlCache } from "../common/ttl-cache.js";

/**
 * Memo de verificaciones Argon2 acertadas: `sha256(token) → secretHash`.
 *
 * Verificar argon2id (19 MB, t=2) cuesta ~20–40 ms de CPU por petición; el
 * agente y el MCP mandan cientos con la misma key. Se recuerda que ESE token
 * ya casó con ESE hash; la fila de la key se sigue leyendo en cada petición,
 * así que revocación, expiración y scopes se ven al instante y no hace falta
 * invalidar nada: si el hash de la fila cambiara, el memo deja de coincidir.
 * El token nunca se guarda en claro.
 */
export const API_KEY_VERIFY_TTL_MS = 10 * 60_000;

/** `lastUsedAt` se persiste como mucho una vez por minuto por key. */
export const API_KEY_TOUCH_INTERVAL_MS = 60_000;

function memoKeyOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface ApiKeyPrincipal {
  apiKeyId: string;
  /** `null` = key global de super-admin, sin tenant fijo (ver `resolveGlobal`). */
  tenantId: string | null;
  scopes: ReadonlyArray<string>;
  /** true solo para keys globales; nunca viene de una key de tenant. */
  isGlobal: boolean;
}

@Injectable()
export class ApiKeyService {
  private readonly verified = new TtlCache<string, string>({
    ttlMs: API_KEY_VERIFY_TTL_MS,
    maxEntries: 2_000,
  });
  private readonly touched = new TtlCache<string, true>({
    ttlMs: API_KEY_TOUCH_INTERVAL_MS,
    maxEntries: 5_000,
  });

  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    return this.prisma.apiKey.findMany({
      where: { tenantId, revokedAt: null },
      select: {
        id: true,
        prefix: true,
        name: true,
        scopes: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(input: {
    tenantId: string;
    actorId: string;
    name: string;
    scopes: string[];
    expiresInDays?: number;
  }) {
    return this.mint(input);
  }

  /**
   * Key global: sin tenant, con TODOS los scopes del catálogo (no es
   * configurable — no existe una "global parcial", es la master key de la
   * plataforma). Solo `SuperAdminApiKeysController` la expone, y ese
   * controlador ya está detrás de `SuperAdminGuard`.
   */
  async createGlobal(input: { actorId: string; name: string; expiresInDays?: number }) {
    return this.mint({ ...input, tenantId: null, scopes: [...ALL_SCOPES] });
  }

  private async mint(input: {
    tenantId: string | null;
    actorId: string;
    name: string;
    scopes: string[];
    expiresInDays?: number;
  }) {
    // El token completo es `<prefix>_<secret>`; el hash se calcula sobre el
    // token completo, que es exactamente lo que llega en el header Authorization.
    const prefix = `npk_${randomBytes(6).toString("hex")}`;
    const secret = randomBytes(32).toString("base64url");
    const token = `${prefix}_${secret}`;
    const secretHash = await argon2.hash(token, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;
    const apiKey = await this.prisma.apiKey.create({
      data: {
        tenantId: input.tenantId,
        prefix,
        name: input.name,
        secretHash,
        scopes: input.scopes,
        expiresAt,
        createdById: input.actorId,
      },
    });
    return { id: apiKey.id, prefix, name: input.name, scopes: input.scopes, secret: token, expiresAt };
  }

  async revoke(tenantId: string, id: string) {
    const result = await this.prisma.apiKey.updateMany({
      where: { id, tenantId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "API key no encontrada" });
    }
    return { ok: true };
  }

  async listGlobal() {
    return this.prisma.apiKey.findMany({
      where: { tenantId: null, revokedAt: null },
      select: {
        id: true,
        prefix: true,
        name: true,
        scopes: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async revokeGlobal(id: string) {
    const result = await this.prisma.apiKey.updateMany({
      where: { id, tenantId: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "API key global no encontrada" });
    }
    return { ok: true };
  }

  /** Verifica la key y devuelve principal. Idempotente. */
  async resolve(token: string): Promise<ApiKeyPrincipal | null> {
    if (!token.startsWith("npk_")) return null;
    const parts = token.split("_");
    if (parts.length < 3) return null;
    const prefix = parts.slice(0, 2).join("_");
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { prefix, revokedAt: null },
      select: { id: true, tenantId: true, scopes: true, secretHash: true, expiresAt: true },
    });
    if (!apiKey) return null;
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) return null;
    // Argon2 solo cuando este token no se ha verificado ya contra este hash
    // (ver `API_KEY_VERIFY_TTL_MS`).
    const memoKey = memoKeyOf(token);
    if (this.verified.get(memoKey) !== apiKey.secretHash) {
      const ok = await argon2.verify(apiKey.secretHash, token);
      if (!ok) return null;
      this.verified.set(memoKey, apiKey.secretHash);
    }
    if (!this.touched.get(apiKey.id)) {
      this.touched.set(apiKey.id, true);
      await this.prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      });
    }
    return {
      apiKeyId: apiKey.id,
      tenantId: apiKey.tenantId,
      scopes: apiKey.scopes,
      isGlobal: apiKey.tenantId === null,
    };
  }

  async assertScope(principal: ApiKeyPrincipal, required: string): Promise<void> {
    if (!principal.scopes.includes(required)) {
      throw new UnauthorizedException({
        code: "FORBIDDEN",
        message: `Scope faltante: ${required}`,
      });
    }
  }
}