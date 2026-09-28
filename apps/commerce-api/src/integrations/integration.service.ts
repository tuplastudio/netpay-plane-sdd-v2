/**
 * Integrations module. Ver docs/12-int.md T-INT-01..06.
 *
 * Patrón: una integración por tenant/proveedor.
 *  - INBOUND: webhook genérico firmado (HMAC).
 *  - OUTBOUND: publisher con retry y dedup por externalId.
 *  - Eventos se persisten para audit + replay.
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { encryptSecret, decryptSecret } from "../common/crypto/secret-cipher.js";
import { assertPublicHttpUrl } from "./url-guard.js";

/**
 * Columnas que se devuelven al cliente. `secretHash` (el secreto cifrado) NO
 * sale nunca por el API: no hace falta para operar y filtrarlo expone material
 * cifrado a cualquiera con `integrations.read`.
 */
const INTEGRATION_PUBLIC_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  provider: true,
  direction: true,
  status: true,
  endpoint: true,
  webhookUrl: true,
  scopesKey: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  lastSyncAt: true,
  version: true,
} as const;

export interface InboundEvent {
  tenantId: string;
  integrationId: string;
  eventName: string;
  externalId?: string;
  payload: Record<string, unknown>;
  rawBody: string;
  signature: string | undefined;
}

@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    return this.prisma.integration.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: INTEGRATION_PUBLIC_SELECT,
    });
  }

  async create(tenantId: string, input: {
    name: string;
    provider: string;
    direction: "INBOUND" | "OUTBOUND" | "BIDIRECTIONAL";
    endpoint?: string;
    secret?: string;
  }) {
    // Anti-SSRF: el endpoint OUTBOUND debe ser un dominio público (se vuelve
    // a validar, con DNS, antes de cada envío en publishOutbound).
    if (input.endpoint) await assertPublicHttpUrl(input.endpoint);
    let secretHash: string | undefined;
    let webhookUrl: string | undefined;
    if (input.direction === "INBOUND" || input.direction === "BIDIRECTIONAL") {
      secretHash = input.secret ? encryptSecret(input.secret) : undefined;
      webhookUrl = `https://api.example.com/api/v1/integrations/webhook/${randomBytes(12).toString("hex")}`;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = this.prisma as any;
    return prisma.integration.create({
      data: {
        tenantId,
        name: input.name,
        provider: input.provider,
        direction: input.direction,
        endpoint: input.endpoint,
        secretHash,
        webhookUrl,
        status: input.secret || input.direction !== "INBOUND" ? "ACTIVE" : "PENDING",
      },
      select: INTEGRATION_PUBLIC_SELECT,
    });
  }

  async disable(tenantId: string, id: string) {
    await this.prisma.integration.updateMany({
      where: { id, tenantId },
      data: { status: "DISABLED", version: { increment: 1 } },
    });
  }

  /**
   * T-INT-03/04: webhook entrante.
   * Exige firma HMAC válida: sin secret configurado o con firma ausente/
   * inválida responde 401 y NO persiste nada (antes: sin secret se aceptaba
   * todo, y con firma inválida el evento quedaba igual como PROCESSED).
   */
  async ingestInbound(input: InboundEvent): Promise<{ id: string; valid: boolean }> {
    const integration = await this.prisma.integration.findFirst({
      where: { id: input.integrationId, tenantId: input.tenantId },
    });
    if (!integration) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Integración no accesible" });
    }
    if (integration.status !== "ACTIVE") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Integración ${integration.status}`,
      });
    }

    if (!integration.secretHash) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "La integración no tiene secreto configurado para verificar webhooks",
      });
    }
    const secret = decryptSecret(integration.secretHash);
    let signatureValid = false;
    if (secret && input.signature && /^[0-9a-f]+$/i.test(input.signature)) {
      const expected = createHmac("sha256", secret).update(input.rawBody).digest("hex");
      const expBuf = Buffer.from(expected, "hex");
      const sigBuf = Buffer.from(input.signature, "hex");
      signatureValid = sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
    }
    if (!signatureValid) {
      this.logger.warn(`Webhook con firma inválida integration=${input.integrationId}`);
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Firma inválida" });
    }

    const event = await this.prisma.integrationEvent.create({
      data: {
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        direction: "INBOUND",
        eventName: input.eventName,
        externalId: input.externalId,
        payload: input.payload as never,
        signatureValid,
        status: "PENDING",
      },
    });

    // Dedup por externalId: si ya existe, ignorar.
    if (input.externalId) {
      const dup = await this.prisma.integrationEvent.findFirst({
        where: {
          tenantId: input.tenantId,
          integrationId: input.integrationId,
          externalId: input.externalId,
          NOT: { id: event.id },
        },
      });
      if (dup) {
        await this.prisma.integrationEvent.update({
          where: { id: event.id },
          data: { status: "IGNORED", lastError: "Duplicate externalId" },
        });
        return { id: event.id, valid: false };
      }
    }

    await this.prisma.integrationEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    return { id: event.id, valid: signatureValid };
  }

  /**
   * T-INT-04: publica un evento outbound firmado.
   */
  async publishOutbound(input: {
    tenantId: string;
    integrationId: string;
    eventName: string;
    payload: Record<string, unknown>;
    secret: string;
  }): Promise<{ status: number; ok: boolean }> {
    const integration = await this.prisma.integration.findFirst({
      where: { id: input.integrationId, tenantId: input.tenantId },
    });
    if (!integration || integration.status !== "ACTIVE") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "Integración inactiva",
      });
    }
    if (!integration.endpoint) {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "La integración no tiene endpoint configurado",
      });
    }
    // Anti-SSRF: validar (con DNS) justo antes de salir, no solo al crear.
    const target = await assertPublicHttpUrl(integration.endpoint);
    const body = JSON.stringify({
      eventName: input.eventName,
      eventId: randomBytes(16).toString("hex"),
      tenantId: input.tenantId,
      payload: input.payload,
      occurredAt: new Date().toISOString(),
    });
    const signature = createHmac("sha256", input.secret).update(body).digest("hex");
    const event = await this.prisma.integrationEvent.create({
      data: {
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        direction: "OUTBOUND",
        eventName: input.eventName,
        payload: input.payload as never,
        signatureValid: true,
        status: "PENDING",
      },
    });

    try {
      const res = await fetch(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-netpay-signature": signature,
          "x-netpay-event": input.eventName,
        },
        body,
        // Sin seguir redirecciones: un 30x podría llevar a una IP interna.
        redirect: "manual",
        // 5s timeout via AbortController
        signal: AbortSignal.timeout(5000),
      });
      await this.prisma.integrationEvent.update({
        where: { id: event.id },
        data: {
          status: res.ok ? "PROCESSED" : "FAILED",
          processedAt: new Date(),
          lastError: res.ok ? null : `HTTP ${res.status}`,
          attempts: { increment: 1 },
        },
      });
      return { status: res.status, ok: res.ok };
    } catch (err) {
      await this.prisma.integrationEvent.update({
        where: { id: event.id },
        data: {
          status: "FAILED",
          lastError: String(err).slice(0, 500),
          attempts: { increment: 1 },
        },
      });
      this.logger.error(`Outbound failed: ${String(err)}`);
      return { status: 0, ok: false };
    }
  }

  /** T-INT-05: reprocesar evento fallido. */
  async reprocess(tenantId: string, eventId: string) {
    const result = await this.prisma.integrationEvent.updateMany({
      where: { id: eventId, tenantId },
      data: { status: "PENDING", processedAt: null, lastError: null },
    });
    if (result.count === 0) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Evento no accesible" });
    }
    return { id: eventId, status: "PENDING" };
  }

  async listEvents(tenantId: string, status?: string) {
    return this.prisma.integrationEvent.findMany({
      where: { tenantId, ...(status ? { status: status as never } : {}) },
      orderBy: { receivedAt: "desc" },
      take: 50,
    });
  }
}

// Helper HMAC para tests internos
export function signPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

// helper de timing-safe compare
export function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}