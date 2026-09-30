/**
 * API keys e identidad de servicios. Ver docs/03-iam.md T-IAM-05.
 *
 *  - prefijo público (lookup) + secret (hash Argon2).
 *  - scopes, expiraAt, revocaAt.
 *  - secret visible SOLO en create y rotate.
 *  - rotación con gracia, edición (nombre/scopes/vencimiento) y bitácora de
 *    uso (ver `usage/api-key-usage.service.ts`).
 *
 * `tenantId: null` en todos los métodos significa "key global de super-admin"
 * (T-IAM-09b); los controladores deciden quién puede pasar null.
 */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { ALL_SCOPES } from "./policies.js";

export interface ApiKeyPrincipal {
  apiKeyId: string;
  /** `null` = key global de super-admin, sin tenant fijo (ver `resolveGlobal`). */
  tenantId: string | null;
  scopes: ReadonlyArray<string>;
  /** true solo para keys globales; nunca viene de una key de tenant. */
  isGlobal: boolean;
}

export type ApiKeyStatus = "ACTIVE" | "EXPIRED" | "REVOKED" | "ROTATED";

/** Fila del listado: lo que ve el panel, sin hash. */
export interface ApiKeyListItem {
  id: string;
  prefix: string;
  name: string;
  scopes: string[];
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  rotatedAt: Date | null;
  rotatedToId: string | null;
  createdBy: { id: string; fullName: string; email: string } | null;
  status: ApiKeyStatus;
}

export const DEFAULT_ROTATION_GRACE_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Estado derivado, en orden de precedencia: revocada > expirada > rotada (en
 * gracia, sigue valiendo hasta que venza) > activa.
 */
export function apiKeyStatusOf(
  key: { revokedAt: Date | null; expiresAt: Date | null; rotatedAt: Date | null },
  now = new Date(),
): ApiKeyStatus {
  if (key.revokedAt) return "REVOKED";
  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  if (key.rotatedAt) return "ROTATED";
  return "ACTIVE";
}

const LIST_SELECT = {
  id: true,
  prefix: true,
  name: true,
  scopes: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
  rotatedAt: true,
  rotatedToId: true,
  createdById: true,
} as const;

@Injectable()
export class ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Keys de un tenant (o globales con `tenantId: null`). Por defecto oculta
   * las revocadas; `includeRevoked` las trae para la vista de historial.
   */
  async list(tenantId: string | null, opts: { includeRevoked?: boolean } = {}): Promise<ApiKeyListItem[]> {
    const rows = await this.prisma.apiKey.findMany({
      where: { tenantId, ...(opts.includeRevoked ? {} : { revokedAt: null }) },
      select: LIST_SELECT,
      orderBy: { createdAt: "desc" },
    });
    const creatorIds = [...new Set(rows.map((r) => r.createdById).filter((id): id is string => Boolean(id)))];
    const creators = creatorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, fullName: true, email: true },
        })
      : [];
    const byId = new Map(creators.map((u) => [u.id, u]));
    const now = new Date();
    return rows.map(({ createdById, ...row }) => ({
      ...row,
      createdBy: (createdById && byId.get(createdById)) || null,
      status: apiKeyStatusOf(row, now),
    }));
  }

  /** Key del tenant (o global) por id, sin hash. 404 si no es suya. */
  async get(tenantId: string | null, id: string) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, tenantId },
      select: LIST_SELECT,
    });
    if (!key) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "API key no encontrada" });
    }
    return key;
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
    expiresAt?: Date | null;
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
    const expiresAt =
      input.expiresAt !== undefined
        ? input.expiresAt
        : input.expiresInDays
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

  /**
   * Rotación: acuña una key NUEVA (mismo tenant, nombre, scopes y vencimiento)
   * y deja la vieja en gracia `graceHours` horas — su `expiresAt` se recorta a
   * `now + gracia` (nunca se alarga) y queda marcada con `rotatedAt` y el id
   * de la sucesora. Con gracia 0 se revoca en el acto.
   *
   * Se elige una fila nueva, no cambiar el hash in situ, para que la bitácora
   * de uso distinga qué tráfico siguió llegando con la key vieja durante la
   * gracia: eso es lo que dice si ya se puede apagar del todo.
   */
  async rotate(input: {
    tenantId: string | null;
    id: string;
    actorId: string;
    graceHours?: number;
  }) {
    const current = await this.prisma.apiKey.findFirst({
      where: { id: input.id, tenantId: input.tenantId, revokedAt: null },
    });
    if (!current) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "API key no encontrada" });
    }
    if (current.rotatedAt) {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "Esta key ya fue rotada; rota la key sucesora",
      });
    }
    const now = new Date();
    const graceHours = input.graceHours ?? this.defaultGraceHours();
    const graceUntil = new Date(now.getTime() + graceHours * HOUR_MS);

    const created = await this.mint({
      tenantId: input.tenantId,
      actorId: input.actorId,
      name: current.name,
      scopes: current.scopes,
      expiresAt: current.expiresAt,
    });

    const oldExpiresAt =
      current.expiresAt && current.expiresAt.getTime() < graceUntil.getTime()
        ? current.expiresAt
        : graceUntil;
    await this.prisma.apiKey.update({
      where: { id: current.id },
      data: {
        rotatedAt: now,
        rotatedToId: created.id,
        ...(graceHours === 0 ? { revokedAt: now } : { expiresAt: oldExpiresAt }),
      },
    });

    return {
      ...created,
      rotatedFromId: current.id,
      previousKey: {
        id: current.id,
        prefix: current.prefix,
        graceHours,
        validUntil: graceHours === 0 ? now : oldExpiresAt,
      },
    };
  }

  /**
   * Edita nombre, scopes o vencimiento. `expiresAt: null` = sin vencimiento;
   * omitido = no se toca. No se puede editar una key revocada.
   */
  async update(input: {
    tenantId: string | null;
    id: string;
    name?: string;
    scopes?: string[];
    expiresAt?: Date | null;
  }) {
    const current = await this.prisma.apiKey.findFirst({
      where: { id: input.id, tenantId: input.tenantId, revokedAt: null },
      select: LIST_SELECT,
    });
    if (!current) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "API key no encontrada" });
    }
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "expiresAt debe estar en el futuro",
      });
    }
    const updated = await this.prisma.apiKey.update({
      where: { id: current.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.scopes !== undefined ? { scopes: input.scopes } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      },
      select: LIST_SELECT,
    });
    return { before: current, after: updated };
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

  async listGlobal(opts: { includeRevoked?: boolean } = {}) {
    return this.list(null, opts);
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

  /**
   * Verifica la key y devuelve principal. Idempotente: `lastUsedAt` ya no se
   * escribe aquí en cada petición sino con throttle desde la bitácora de uso
   * (`ApiKeyUsageService.record`).
   */
  async resolve(token: string): Promise<ApiKeyPrincipal | null> {
    if (!token.startsWith("npk_")) return null;
    const parts = token.split("_");
    if (parts.length < 3) return null;
    const prefix = parts.slice(0, 2).join("_");
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { prefix, revokedAt: null },
    });
    if (!apiKey) return null;
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) return null;
    const ok = await argon2.verify(apiKey.secretHash, token);
    if (!ok) return null;
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

  /** `API_KEY_ROTATION_GRACE_HOURS` (0..168), 24 h si no está o es inválida. */
  defaultGraceHours(): number {
    const raw = Number.parseInt(process.env.API_KEY_ROTATION_GRACE_HOURS ?? "", 10);
    return Number.isFinite(raw) && raw >= 0 && raw <= 168 ? raw : DEFAULT_ROTATION_GRACE_HOURS;
  }
}
