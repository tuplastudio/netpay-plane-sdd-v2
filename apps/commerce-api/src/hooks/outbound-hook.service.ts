/**
 * Hooks salientes: configuración por tenant, abanico de eventos → entregas y
 * operaciones del panel (probar, historial, reintentar).
 *
 * Se suscribe al `DomainEventBus` al arrancar: por cada evento emitido crea
 * una `OutboundHookDelivery` por hook ACTIVE suscrito al evento; el
 * `OutboundDispatcherService` se encarga de enviarlas.
 *
 * Secretos: `signingSecret` y `credential` se guardan cifrados con
 * `secret-cipher` (AES-256-GCM, clave derivada de TOKEN_ENCRYPTION_KEY_REF) y
 * NUNCA salen por el API. El secreto de firma se devuelve en claro una sola
 * vez: al crear el hook o al rotarlo.
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { decryptSecret, encryptSecret } from "../common/crypto/secret-cipher.js";
import { assertPublicHttpUrl } from "../integrations/url-guard.js";
import { buildDomainEvent, domainEvents, type DomainEvent } from "./domain-event-bus.js";
import { HOOK_EVENTS, PING_EVENT } from "./event-catalog.js";
import {
  MAX_ATTEMPTS,
  MAX_BACKOFF_SECONDS,
  MIN_ATTEMPTS,
  MIN_BACKOFF_SECONDS,
  parseRetryPolicy,
  type RetryPolicy,
} from "./retry-policy.js";
import type { CreateOutboundHookDto, DeliveryStatus, UpdateOutboundHookDto } from "./outbound-hook.dto.js";
import { OutboundDispatcherService } from "./outbound-dispatcher.service.js";

/** Lo que el panel ve de un hook. Sin `credential` ni `signingSecret`. */
const HOOK_PUBLIC_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  description: true,
  kind: true,
  targetUrl: true,
  authType: true,
  authHeaderName: true,
  credential: true, // se transforma en `hasCredential` antes de salir
  events: true,
  status: true,
  headers: true,
  toolName: true,
  argsTemplate: true,
  retryPolicy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OutboundHookSelect;

/** Listado de entregas: sin `payload` ni `responseBody` (van en el detalle). */
const DELIVERY_LIST_SELECT = {
  id: true,
  hookId: true,
  eventName: true,
  eventId: true,
  attempt: true,
  status: true,
  responseStatus: true,
  error: true,
  durationMs: true,
  nextAttemptAt: true,
  createdAt: true,
  deliveredAt: true,
} satisfies Prisma.OutboundHookDeliverySelect;

type HookRow = Prisma.OutboundHookGetPayload<{ select: typeof HOOK_PUBLIC_SELECT }>;

export type PublicHook = Omit<HookRow, "credential" | "retryPolicy"> & {
  hasCredential: boolean;
  retryPolicy: RetryPolicy;
};

const AUTH_NEEDS_CREDENTIAL = new Set(["BEARER", "API_KEY_HEADER", "BASIC"]);
const MAX_CUSTOM_HEADERS = 20;
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;
const MAX_TEMPLATE_BYTES = 16 * 1024;
const DEFAULT_PAGE = 25;

function toPublic(row: HookRow): PublicHook {
  const { credential, ...rest } = row;
  return { ...rest, hasCredential: Boolean(credential), retryPolicy: parseRetryPolicy(row.retryPolicy) };
}

function rule(message: string): never {
  throw new BadRequestException({ code: "VALIDATION_ERROR", message });
}

/** Secreto de firma nuevo: prefijo reconocible + 32 bytes aleatorios. */
export function generateSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

@Injectable()
export class OutboundHookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboundHookService.name);
  private unsubscribe?: () => void;

  /** Sustituible en tests (evita DNS). */
  assertUrl: (url: string) => Promise<URL> = assertPublicHttpUrl;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: OutboundDispatcherService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = domainEvents.subscribe(async (event) => {
      await this.fanOut(event);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  // ---------------------------------------------------------------------
  // Emisión
  // ---------------------------------------------------------------------

  /**
   * Crea una entrega por hook ACTIVE del tenant suscrito al evento.
   * Devuelve cuántas se encolaron.
   */
  async fanOut(event: DomainEvent): Promise<number> {
    const hooks = await this.prisma.outboundHook.findMany({
      where: { tenantId: event.tenantId, status: "ACTIVE", events: { has: event.event } },
      select: { id: true },
    });
    if (hooks.length === 0) return 0;
    const now = new Date(event.occurredAt);
    await this.prisma.outboundHookDelivery.createMany({
      data: hooks.map((hook) => ({
        tenantId: event.tenantId,
        hookId: hook.id,
        eventName: event.event,
        eventId: event.id,
        payload: event as unknown as Prisma.InputJsonValue,
        status: "PENDING",
        nextAttemptAt: now,
      })),
    });
    return hooks.length;
  }

  // ---------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------

  async list(tenantId: string): Promise<PublicHook[]> {
    const rows = await this.prisma.outboundHook.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: HOOK_PUBLIC_SELECT,
    });
    return rows.map(toPublic);
  }

  async get(tenantId: string, id: string): Promise<PublicHook> {
    const row = await this.prisma.outboundHook.findFirst({ where: { id, tenantId }, select: HOOK_PUBLIC_SELECT });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "Hook no accesible" });
    return toPublic(row);
  }

  async create(
    tenantId: string,
    actorId: string | null,
    input: CreateOutboundHookDto,
  ): Promise<{ hook: PublicHook; signingSecret: string }> {
    await this.assertUrl(input.targetUrl);
    if (AUTH_NEEDS_CREDENTIAL.has(input.authType) && !input.credential) {
      rule("Esta autenticación necesita una credencial");
    }
    if (input.authType === "BASIC" && input.credential && !input.credential.includes(":")) {
      rule("Con BASIC la credencial va como usuario:contraseña");
    }
    if (input.kind === "MCP" && !input.toolName) rule("Un hook MCP necesita toolName");

    const signingSecret = generateSigningSecret();
    const row = await this.prisma.outboundHook.create({
      data: {
        tenantId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        kind: input.kind,
        targetUrl: input.targetUrl,
        authType: input.authType,
        credential:
          AUTH_NEEDS_CREDENTIAL.has(input.authType) && input.credential ? encryptSecret(input.credential) : null,
        authHeaderName: input.authType === "API_KEY_HEADER" ? (input.authHeaderName ?? "X-API-Key") : null,
        signingSecret: encryptSecret(signingSecret),
        events: [...new Set(input.events)],
        status: "ACTIVE",
        headers: this.normalizeHeaders(input.headers) as Prisma.InputJsonValue,
        toolName: input.kind === "MCP" ? (input.toolName ?? null) : null,
        argsTemplate:
          input.kind === "MCP" ? (this.normalizeTemplate(input.argsTemplate) as Prisma.InputJsonValue) : undefined,
        retryPolicy: this.normalizeRetryPolicy(input.retryPolicy) as unknown as Prisma.InputJsonValue,
      },
      select: HOOK_PUBLIC_SELECT,
    });
    await this.audit(tenantId, actorId, "hook.created", row.id, {
      name: row.name,
      kind: row.kind,
      events: row.events,
    });
    return { hook: toPublic(row), signingSecret };
  }

  async update(
    tenantId: string,
    actorId: string | null,
    id: string,
    input: UpdateOutboundHookDto,
  ): Promise<PublicHook> {
    const current = await this.prisma.outboundHook.findFirst({ where: { id, tenantId } });
    if (!current) throw new NotFoundException({ code: "NOT_FOUND", message: "Hook no accesible" });

    if (input.targetUrl !== undefined) await this.assertUrl(input.targetUrl);
    const kind = input.kind ?? current.kind;
    const authType = input.authType ?? current.authType;
    const toolName = input.toolName ?? current.toolName;

    // Credencial: nueva si viene; si cambia a un tipo que la exige y no hay
    // ninguna guardada, se pide; si el tipo no la usa, se borra.
    let credential: string | null | undefined;
    if (!AUTH_NEEDS_CREDENTIAL.has(authType)) {
      credential = null;
    } else if (input.credential) {
      if (authType === "BASIC" && !input.credential.includes(":")) {
        rule("Con BASIC la credencial va como usuario:contraseña");
      }
      credential = encryptSecret(input.credential);
    } else if (!current.credential || authType !== current.authType) {
      rule("Esta autenticación necesita una credencial");
    }
    if (kind === "MCP" && !toolName) rule("Un hook MCP necesita toolName");

    const row = await this.prisma.outboundHook.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        description: input.description === undefined ? undefined : input.description.trim() || null,
        kind,
        targetUrl: input.targetUrl,
        authType,
        credential,
        authHeaderName:
          authType === "API_KEY_HEADER" ? (input.authHeaderName ?? current.authHeaderName ?? "X-API-Key") : null,
        events: input.events ? [...new Set(input.events)] : undefined,
        status: input.status,
        headers: input.headers === undefined ? undefined : (this.normalizeHeaders(input.headers) as Prisma.InputJsonValue),
        toolName: kind === "MCP" ? toolName : null,
        argsTemplate:
          kind !== "MCP"
            ? undefined
            : input.argsTemplate === undefined
              ? undefined
              : (this.normalizeTemplate(input.argsTemplate) as Prisma.InputJsonValue),
        retryPolicy:
          input.retryPolicy === undefined
            ? undefined
            : (this.normalizeRetryPolicy(input.retryPolicy) as unknown as Prisma.InputJsonValue),
      },
      select: HOOK_PUBLIC_SELECT,
    });
    await this.audit(tenantId, actorId, "hook.updated", id, { fields: Object.keys(input) });
    return toPublic(row);
  }

  async remove(tenantId: string, actorId: string | null, id: string): Promise<void> {
    const result = await this.prisma.outboundHook.deleteMany({ where: { id, tenantId } });
    if (result.count === 0) throw new NotFoundException({ code: "NOT_FOUND", message: "Hook no accesible" });
    await this.audit(tenantId, actorId, "hook.deleted", id);
  }

  /** Nuevo secreto de firma. Se devuelve en claro una sola vez. */
  async rotateSecret(tenantId: string, actorId: string | null, id: string): Promise<{ signingSecret: string }> {
    const signingSecret = generateSigningSecret();
    const result = await this.prisma.outboundHook.updateMany({
      where: { id, tenantId },
      data: { signingSecret: encryptSecret(signingSecret) },
    });
    if (result.count === 0) throw new NotFoundException({ code: "NOT_FOUND", message: "Hook no accesible" });
    await this.audit(tenantId, actorId, "hook.secret_rotated", id);
    return { signingSecret };
  }

  // ---------------------------------------------------------------------
  // Operación
  // ---------------------------------------------------------------------

  /**
   * Manda un evento `ping` real al hook y devuelve la entrega con el
   * resultado. Se programa a +60 s para que el barrido no compita con el
   * envío inmediato; si falla, sigue la política de reintentos normal.
   */
  async test(tenantId: string, actorId: string | null, id: string) {
    const hook = await this.prisma.outboundHook.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!hook) throw new NotFoundException({ code: "NOT_FOUND", message: "Hook no accesible" });
    // El `ping` no pasa por el bus: sólo va a ESTE hook, no a los suscritos.
    const event = buildDomainEvent(tenantId, PING_EVENT, { message: "pong", hookId: id });
    const created = await this.prisma.outboundHookDelivery.create({
      data: {
        tenantId,
        hookId: id,
        eventName: PING_EVENT,
        eventId: event.id,
        payload: event as unknown as Prisma.InputJsonValue,
        status: "PENDING",
        nextAttemptAt: new Date(Date.now() + 60_000),
      },
    });
    const delivered = await this.dispatcher.dispatchNow(tenantId, created.id);
    await this.audit(tenantId, actorId, "hook.tested", id, {
      deliveryId: created.id,
      status: delivered?.status ?? null,
    });
    return delivered ? this.stripHook(delivered) : created;
  }

  async listDeliveries(
    tenantId: string,
    hookId: string,
    query: { status?: DeliveryStatus; cursor?: string; limit?: number },
  ) {
    const hook = await this.prisma.outboundHook.findFirst({ where: { id: hookId, tenantId }, select: { id: true } });
    if (!hook) throw new NotFoundException({ code: "NOT_FOUND", message: "Hook no accesible" });
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE, 1), 100);
    const rows = await this.prisma.outboundHookDelivery.findMany({
      where: { tenantId, hookId, ...(query.status ? { status: query.status } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: DELIVERY_LIST_SELECT,
    });
    const items = rows.slice(0, limit);
    return {
      items,
      pageInfo: { nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null, size: items.length },
    };
  }

  async getDelivery(tenantId: string, id: string) {
    const row = await this.prisma.outboundHookDelivery.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "Entrega no accesible" });
    return row;
  }

  /** Reintento manual: un intento más, ahora. Vale también para `DEAD`. */
  async retry(tenantId: string, actorId: string | null, id: string) {
    const row = await this.prisma.outboundHookDelivery.findFirst({ where: { id, tenantId }, select: { status: true } });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "Entrega no accesible" });
    if (row.status === "SUCCESS") rule("La entrega ya se completó");
    const delivered = await this.dispatcher.dispatchNow(tenantId, id);
    await this.audit(tenantId, actorId, "hook.delivery_retried", id, { status: delivered?.status ?? null });
    return delivered ? this.stripHook(delivered) : this.getDelivery(tenantId, id);
  }

  /** Catálogo de eventos con descripción y ejemplo de `data`. */
  events() {
    return HOOK_EVENTS.map((e) => ({
      name: e.name,
      group: e.group,
      description: e.description,
      subscribable: e.name !== PING_EVENT,
      example: {
        id: "2f1e0d9c-8b7a-4695-8f4e-3d2c1b0a9f8e",
        event: e.name,
        occurredAt: "2026-01-15T17:05:00.000Z",
        tenantId: "00000000-0000-4000-8000-000000000000",
        data: e.example,
        version: 1,
      },
    }));
  }

  /** Secreto de firma en claro (solo para uso interno, p.ej. verificación en tests). */
  async signingSecretOf(tenantId: string, id: string): Promise<string | null> {
    const row = await this.prisma.outboundHook.findFirst({ where: { id, tenantId }, select: { signingSecret: true } });
    return row ? decryptSecret(row.signingSecret) : null;
  }

  // ---------------------------------------------------------------------
  // Normalización de JSON libre
  // ---------------------------------------------------------------------

  private normalizeHeaders(raw: Record<string, unknown> | undefined): Record<string, string> | null {
    if (!raw) return null;
    const entries = Object.entries(raw);
    if (entries.length > MAX_CUSTOM_HEADERS) rule(`Máximo ${MAX_CUSTOM_HEADERS} headers`);
    const out: Record<string, string> = {};
    for (const [key, value] of entries) {
      if (!HEADER_NAME_RE.test(key)) rule(`Header inválido: ${key}`);
      if (typeof value !== "string" || value.length > 1024 || /[\r\n]/.test(value)) {
        rule(`El valor del header ${key} debe ser texto de una línea`);
      }
      out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  private normalizeTemplate(raw: Record<string, unknown> | undefined): Record<string, unknown> | null {
    if (!raw) return null;
    if (Buffer.byteLength(JSON.stringify(raw), "utf8") > MAX_TEMPLATE_BYTES) {
      rule("argsTemplate supera 16 KB");
    }
    return raw;
  }

  private normalizeRetryPolicy(raw: Record<string, unknown> | undefined): RetryPolicy {
    if (!raw) return parseRetryPolicy(undefined);
    const attempts = Number(raw.maxAttempts);
    const backoff = Number(raw.backoffSeconds);
    if (!Number.isInteger(attempts) || attempts < MIN_ATTEMPTS || attempts > MAX_ATTEMPTS) {
      rule(`maxAttempts debe ser un entero entre ${MIN_ATTEMPTS} y ${MAX_ATTEMPTS}`);
    }
    if (!Number.isInteger(backoff) || backoff < MIN_BACKOFF_SECONDS || backoff > MAX_BACKOFF_SECONDS) {
      rule(`backoffSeconds debe ser un entero entre ${MIN_BACKOFF_SECONDS} y ${MAX_BACKOFF_SECONDS}`);
    }
    return { maxAttempts: attempts, backoffSeconds: backoff };
  }

  private stripHook<T extends { hook?: unknown }>(row: T): Omit<T, "hook"> {
    const { hook: _hook, ...rest } = row;
    return rest;
  }

  private async audit(
    tenantId: string,
    actorId: string | null,
    action: string,
    targetId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          actorId,
          action,
          targetType: action.startsWith("hook.delivery") ? "OutboundHookDelivery" : "OutboundHook",
          targetId,
          metadata: metadata as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      this.logger.warn(`auditLog ${action} falló: ${String(err)}`);
    }
  }
}

