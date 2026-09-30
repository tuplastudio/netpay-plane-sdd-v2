/**
 * Despachador de entregas salientes.
 *
 * Corre en commerce-api como `setInterval` (mismo patrón que
 * `QuoteReminderService` y `NotificationService`: no hay `@nestjs/schedule`
 * y el worker de RabbitMQ no recibe estos eventos). Cada `POLL_MS`:
 *
 *  1. Lee entregas `PENDING|FAILED` con `nextAttemptAt <= now` y sin lease
 *     vigente (`lockedAt` nulo o vencido).
 *  2. Reserva cada una con un `updateMany` condicionado (lock optimista):
 *     si otra instancia del API la tomó antes, `count` es 0 y se salta.
 *  3. Envía (REST: POST JSON firmado; MCP: `tools/call` Streamable HTTP),
 *     con timeout de 10 s por petición y la guardia anti-SSRF con DNS
 *     justo antes de salir.
 *  4. Graba respuesta/error. Fallo → `FAILED` con `nextAttemptAt` por
 *     backoff exponencial; agotados los intentos → `DEAD`.
 *
 * `fetchImpl`, `assertUrl` y `now` son propiedades para que los tests los
 * sustituyan sin red ni DNS.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { OutboundHook, OutboundHookDelivery, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { decryptSecret } from "../common/crypto/secret-cipher.js";
import { assertPublicHttpUrl } from "../integrations/url-guard.js";
import type { DomainEvent } from "./domain-event-bus.js";
import { buildSignatureHeader, SIGNATURE_HEADER } from "./hook-signature.js";
import { buildToolArguments } from "./args-template.js";
import { callMcpTool } from "./mcp-client.js";
import { nextAttemptAt, parseRetryPolicy } from "./retry-policy.js";

/** Cada cuánto se barre la tabla. */
export const POLL_MS = 5_000;
/** Entregas por pasada. */
export const BATCH = 25;
/** Un lease más viejo que esto se considera de un proceso caído. */
export const LEASE_MS = 60_000;
/** Timeout por petición HTTP. */
export const REQUEST_TIMEOUT_MS = 10_000;
/** Cuánto de la respuesta se guarda en el historial. */
export const RESPONSE_BODY_MAX = 2_048;

/** Headers que un tenant no puede pisar desde `headers`. */
const RESERVED_HEADERS = new Set([
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
  SIGNATURE_HEADER,
  "x-easysell-event",
  "x-easysell-event-id",
  "x-easysell-delivery",
  "x-easysell-attempt",
]);

export interface DeliveryOutcome {
  ok: boolean;
  status: number;
  body: string;
  error: string | null;
  durationMs: number;
}

export type DeliveryWithHook = OutboundHookDelivery & { hook: OutboundHook };

function truncate(text: string): string {
  return text.length > RESPONSE_BODY_MAX ? `${text.slice(0, RESPONSE_BODY_MAX)}…` : text;
}

function describeError(err: unknown): string {
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return `Sin respuesta en ${REQUEST_TIMEOUT_MS / 1000} s`;
  }
  const code = e?.cause?.code ?? e?.code;
  const message = e?.message ?? String(err);
  return (code ? `${code}: ${message}` : message).slice(0, 500);
}

/** Headers de autenticación según `authType`. */
export function buildAuthHeaders(
  hook: Pick<OutboundHook, "authType" | "authHeaderName">,
  credential: string | null,
): Record<string, string> {
  if (!credential) return {};
  switch (hook.authType) {
    case "BEARER":
      return { authorization: `Bearer ${credential}` };
    case "API_KEY_HEADER":
      return { [(hook.authHeaderName ?? "X-API-Key").toLowerCase()]: credential };
    case "BASIC":
      return { authorization: `Basic ${Buffer.from(credential, "utf8").toString("base64")}` };
    default:
      return {};
  }
}

/** Headers extra del hook, sin los reservados y solo con valores de texto. */
export function buildCustomHeaders(raw: Prisma.JsonValue | null | undefined): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = key.toLowerCase();
    if (RESERVED_HEADERS.has(name)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[name] = String(value);
    }
  }
  return out;
}

@Injectable()
export class OutboundDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboundDispatcherService.name);
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;

  /** Sustituibles en tests. */
  fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init);
  assertUrl: (url: string) => Promise<URL> = assertPublicHttpUrl;
  now: () => Date = () => new Date();

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // `OUTBOUND_HOOKS_DISPATCHER=off` apaga el barrido en una instancia (p.ej.
    // réplicas que solo sirven HTTP). Las entregas siguen encolándose.
    if ((process.env.OUTBOUND_HOOKS_DISPATCHER ?? "on").toLowerCase() === "off") {
      this.logger.log("despachador de hooks salientes apagado por OUTBOUND_HOOKS_DISPATCHER=off");
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Una pasada: reserva y envía lo que toca. Devuelve cuántas se intentaron. */
  async tick(): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    try {
      const now = this.now();
      const due = await this.prisma.outboundHookDelivery.findMany({
        where: this.dueWhere(now),
        orderBy: { nextAttemptAt: "asc" },
        take: BATCH,
        include: { hook: true },
      });
      let attempted = 0;
      for (const delivery of due) {
        // Número de intento que corresponde a ESTA reserva (el `increment`
        // del claim lo deja igual en la base).
        const attempt = delivery.attempt + 1;
        if (!(await this.claim(delivery.id, now, { respectSchedule: true }))) continue;
        attempted += 1;
        await this.deliverClaimed({ ...delivery, attempt });
      }
      return attempted;
    } catch (err) {
      this.logger.error(`barrido de hooks salientes falló: ${String(err)}`);
      return 0;
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Envío inmediato de una entrega concreta (botón «Probar», reintento
   * manual). Ignora `nextAttemptAt` pero respeta el lease: si el barrido ya
   * la tiene, devuelve la fila tal cual.
   */
  async dispatchNow(tenantId: string, deliveryId: string): Promise<DeliveryWithHook | null> {
    const delivery = await this.prisma.outboundHookDelivery.findFirst({
      where: { id: deliveryId, tenantId },
      include: { hook: true },
    });
    if (!delivery) return null;
    const now = this.now();
    const attempt = delivery.attempt + 1;
    if (!(await this.claim(delivery.id, now, { respectSchedule: false }))) return delivery;
    await this.deliverClaimed({ ...delivery, attempt });
    return this.prisma.outboundHookDelivery.findFirst({
      where: { id: deliveryId, tenantId },
      include: { hook: true },
    });
  }

  private dueWhere(now: Date): Prisma.OutboundHookDeliveryWhereInput {
    return {
      status: { in: ["PENDING", "FAILED"] },
      nextAttemptAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - LEASE_MS) } }],
    };
  }

  /** Lock optimista: gana quien consigue `count === 1`. Incrementa `attempt`. */
  private async claim(id: string, now: Date, opts: { respectSchedule: boolean }): Promise<boolean> {
    const where: Prisma.OutboundHookDeliveryWhereInput = {
      id,
      status: { in: ["PENDING", "FAILED", "DEAD"] },
      OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - LEASE_MS) } }],
    };
    if (opts.respectSchedule) {
      where.status = { in: ["PENDING", "FAILED"] };
      where.nextAttemptAt = { lte: now };
    }
    const result = await this.prisma.outboundHookDelivery.updateMany({
      where,
      data: { lockedAt: now, attempt: { increment: 1 } },
    });
    return result.count === 1;
  }

  /** Envía una entrega ya reservada y persiste el resultado. */
  private async deliverClaimed(delivery: DeliveryWithHook): Promise<DeliveryOutcome> {
    const { hook } = delivery;
    // Un hook pausado no envía (salvo el `ping` del botón «Probar»): la
    // entrega queda agotada de inmediato, sin gastar reintentos, y se puede
    // reintentar a mano al reactivarlo.
    const paused = hook.status !== "ACTIVE" && delivery.eventName !== "ping";
    const outcome = paused
      ? { ok: false, status: 0, body: "", error: "Hook deshabilitado", durationMs: 0 }
      : await this.deliver(delivery, hook);
    await this.record(delivery, hook, outcome, { terminal: paused });
    if (!outcome.ok) {
      this.logger.warn(
        `entrega ${delivery.id} (${delivery.eventName} → ${hook.name}) intento ${delivery.attempt} falló: ${outcome.error}`,
      );
    }
    return outcome;
  }

  /** Solo la parte de red: no toca la base. */
  async deliver(
    delivery: Pick<OutboundHookDelivery, "id" | "eventName" | "eventId" | "payload" | "attempt">,
    hook: OutboundHook,
  ): Promise<DeliveryOutcome> {
    const started = Date.now();
    const finish = (partial: Omit<DeliveryOutcome, "durationMs">): DeliveryOutcome => ({
      ...partial,
      body: truncate(partial.body),
      durationMs: Date.now() - started,
    });
    try {
      const url = await this.assertUrl(hook.targetUrl);
      const secret = decryptSecret(hook.signingSecret);
      if (!secret) {
        return finish({ ok: false, status: 0, body: "", error: "No se pudo descifrar el secreto de firma" });
      }
      const credential = hook.credential ? decryptSecret(hook.credential) : null;
      if (hook.credential && !credential) {
        return finish({ ok: false, status: 0, body: "", error: "No se pudo descifrar la credencial" });
      }
      const baseHeaders: Record<string, string> = {
        "user-agent": "EasySell-Hooks/1.0",
        "x-easysell-event": delivery.eventName,
        "x-easysell-event-id": delivery.eventId,
        "x-easysell-delivery": delivery.id,
        "x-easysell-attempt": String(delivery.attempt),
        ...buildCustomHeaders(hook.headers),
        ...buildAuthHeaders(hook, credential),
      };
      const sign = (body: string): Record<string, string> => ({
        [SIGNATURE_HEADER]: buildSignatureHeader(secret, Math.floor(this.now().getTime() / 1000), body),
      });
      const event = delivery.payload as unknown as DomainEvent;

      if (hook.kind === "MCP") {
        const result = await callMcpTool({
          url,
          toolName: hook.toolName ?? "",
          args: buildToolArguments(hook.argsTemplate, event),
          headers: baseHeaders,
          requestId: delivery.id,
          timeoutMs: REQUEST_TIMEOUT_MS,
          fetchImpl: this.fetchImpl,
          sign,
        });
        return finish({ ok: result.ok, status: result.status, body: result.body, error: result.error ?? null });
      }

      const body = JSON.stringify(event);
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...baseHeaders, ...sign(body) },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      const ok = response.status >= 200 && response.status < 300;
      return finish({ ok, status: response.status, body: text, error: ok ? null : `HTTP ${response.status}` });
    } catch (err) {
      const message = (err as { response?: { message?: string } })?.response?.message ?? describeError(err);
      return finish({ ok: false, status: 0, body: "", error: message });
    }
  }

  /** Persiste el resultado del intento y programa el siguiente si aplica. */
  private async record(
    delivery: DeliveryWithHook,
    hook: OutboundHook,
    outcome: DeliveryOutcome,
    opts: { terminal?: boolean } = {},
  ): Promise<void> {
    const now = this.now();
    if (outcome.ok) {
      await this.prisma.outboundHookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "SUCCESS",
          responseStatus: outcome.status || null,
          responseBody: outcome.body || null,
          error: null,
          durationMs: outcome.durationMs,
          deliveredAt: now,
          lockedAt: null,
        },
      });
      return;
    }
    const policy = parseRetryPolicy(hook.retryPolicy);
    const exhausted = opts.terminal === true || delivery.attempt >= policy.maxAttempts;
    await this.prisma.outboundHookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: exhausted ? "DEAD" : "FAILED",
        responseStatus: outcome.status || null,
        responseBody: outcome.body || null,
        error: outcome.error,
        durationMs: outcome.durationMs,
        nextAttemptAt: exhausted ? delivery.nextAttemptAt : nextAttemptAt(delivery.attempt, policy, now),
        lockedAt: null,
      },
    });
  }
}
