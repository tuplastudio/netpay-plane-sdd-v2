/**
 * WhatsApp service: conexiones, conversaciones, mensajes, handoff.
 * Ver docs/10-wha.md T-WHA-01..07.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  MetaChannel,
  EvolutionChannel,
  type ChannelAdapter,
  type MediaKey,
  type SendMessageInput,
  type SendMessageResult,
} from "./channels.js";

@Injectable()
export class WhatsAppService {
  private readonly meta: MetaChannel;
  private readonly evolution: EvolutionChannel;

  constructor(private readonly prisma: PrismaService) {
    this.meta = new MetaChannel(prisma);
    this.evolution = new EvolutionChannel(prisma);
  }

  async listConnections(tenantId: string) {
    const connections = await this.prisma.whatsAppConnection.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return connections.map(({ webhookSecretHash: _hash, ...c }) => c);
  }

  async connect(
    tenantId: string,
    input: {
      provider: "META" | "EVOLUTION";
      phoneNumber?: string;
      credentials: Record<string, unknown>;
      webhookUrl?: string;
    },
  ) {
    const status = (input.credentials.token || input.credentials.apiKey) ? "ACTIVE" : "PENDING";

    // Secreto del webhook entrante (T-WHA-04): se genera una vez si no se da
    // uno, se hashea (argon2, solo se necesita comparar, no recuperar en
    // claro) y se devuelve en texto plano solo en esta respuesta.
    const existing = await this.prisma.whatsAppConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: input.provider } },
      select: { webhookSecretHash: true },
    });
    let plainWebhookSecret: string | undefined;
    let webhookSecretHash = existing?.webhookSecretHash ?? null;
    if (!webhookSecretHash) {
      plainWebhookSecret = randomBytes(18).toString("base64url");
      webhookSecretHash = await argon2.hash(plainWebhookSecret);
    }

    const connection = await this.prisma.whatsAppConnection.upsert({
      where: { tenantId_provider: { tenantId, provider: input.provider } },
      create: {
        tenantId,
        provider: input.provider,
        phoneNumber: input.phoneNumber,
        status,
        credentials: input.credentials as never,
        webhookUrl: input.webhookUrl,
        webhookSecretHash,
        connectedAt: status === "ACTIVE" ? new Date() : null,
      },
      update: {
        phoneNumber: input.phoneNumber,
        status,
        credentials: input.credentials as never,
        webhookUrl: input.webhookUrl,
        webhookSecretHash,
        connectedAt: status === "ACTIVE" ? new Date() : null,
      },
    });

    const { webhookSecretHash: _hash, ...safeConnection } = connection;
    return { ...safeConnection, webhookSecret: plainWebhookSecret };
  }

  /** Rota el secreto del webhook entrante; el anterior deja de aceptarse de inmediato. */
  async rotateWebhookSecret(tenantId: string, id: string) {
    const conn = await this.prisma.whatsAppConnection.findFirst({ where: { id, tenantId } });
    if (!conn) throw new NotFoundException({ code: "NOT_FOUND", message: "Conexión no accesible" });
    const plainWebhookSecret = randomBytes(18).toString("base64url");
    const webhookSecretHash = await argon2.hash(plainWebhookSecret);
    await this.prisma.whatsAppConnection.update({
      where: { id },
      data: { webhookSecretHash },
    });
    return { webhookSecret: plainWebhookSecret };
  }

  async disconnect(tenantId: string, id: string) {
    return this.prisma.whatsAppConnection.updateMany({
      where: { id, tenantId },
      data: { status: "DISABLED", version: { increment: 1 } },
    });
  }

  /**
   * T-WHA-04: procesa un mensaje entrante. Deduplica por externalId.
   */
  async ingestInbound(input: {
    tenantId: string;
    provider: "META" | "EVOLUTION";
    connectionId: string;
    externalPhone: string;
    body: string;
    externalId: string;
    messageType?: "TEXT" | "IMAGE" | "AUDIO" | "DOCUMENT";
    mediaUrl?: string;
  }) {
    if (input.externalId) {
      const dup = await this.prisma.whatsAppMessage.findUnique({
        where: { externalId: input.externalId },
      });
      if (dup) return dup;
    }

    const conn = await this.prisma.whatsAppConnection.findUnique({
      where: { id: input.connectionId },
    });
    if (!conn || conn.tenantId !== input.tenantId) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Conexión no accesible" });
    }

    const conversation = await this.prisma.whatsAppConversation.upsert({
      where: {
        connectionId_externalPhone: {
          connectionId: input.connectionId,
          externalPhone: input.externalPhone,
        },
      },
      create: {
        tenantId: input.tenantId,
        connectionId: input.connectionId,
        externalPhone: input.externalPhone,
        status: "OPEN",
        lastMessageAt: new Date(),
      },
      update: { lastMessageAt: new Date() },
    });

    return this.prisma.whatsAppMessage.create({
      data: {
        tenantId: input.tenantId,
        conversationId: conversation.id,
        direction: "INBOUND",
        messageType: input.messageType ?? "TEXT",
        externalId: input.externalId,
        body: input.body,
        mediaUrl: input.mediaUrl,
        status: "DELIVERED",
        deliveredAt: new Date(),
      },
    });
  }

  /**
   * T-WHA-05: enviar con política (opt-out, horario, retries).
   */
  async send(tenantId: string, input: SendMessageInput): Promise<SendMessageResult> {
    const conn = await this.prisma.whatsAppConnection.findFirst({
      where: { tenantId, status: "ACTIVE" },
    });
    if (!conn) {
      return { externalId: null, status: "FAILED", error: "Sin conexiones activas" };
    }
    const adapter = conn.provider === "META" ? this.meta : this.evolution;
    const result = await adapter.sendMessage(conn.id, input);

    await this.prisma.whatsAppConversation.upsert({
      where: {
        connectionId_externalPhone: {
          connectionId: conn.id,
          externalPhone: input.to,
        },
      },
      create: {
        tenantId,
        connectionId: conn.id,
        externalPhone: input.to,
        status: "OPEN",
        lastMessageAt: new Date(),
      },
      update: { lastMessageAt: new Date() },
    });
    return result;
  }

  async downloadMedia(
    connectionId: string,
    key: MediaKey,
  ): Promise<{ base64: string; mimetype?: string } | null> {
    const conn = await this.prisma.whatsAppConnection.findUnique({
      where: { id: connectionId },
    });
    if (!conn) return null;
    const adapter: ChannelAdapter = conn.provider === "META" ? this.meta : this.evolution;
    if (!adapter.getMediaBase64) return null;
    return adapter.getMediaBase64(connectionId, key);
  }

  /**
   * T-WHA-06: transferir a humano.
   */
  async handoffToHuman(
    tenantId: string,
    conversationId: string,
    userId: string,
  ) {
    const conv = await this.prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    if (!conv) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Conversación no accesible" });
    }
    return this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: {
        status: "HANDED_OFF",
        handoffToHuman: true,
        handoffUserId: userId,
      },
    });
  }

  /**
   * T-WHA-07: health por conexión.
   */
  async health(tenantId: string, connectionId: string) {
    const conn = await this.prisma.whatsAppConnection.findFirst({
      where: { id: connectionId, tenantId },
    });
    if (!conn) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Conexión no accesible" });
    }
    const adapter = conn.provider === "META" ? this.meta : this.evolution;
    const start = Date.now();
    const result = await adapter.healthCheck();
    return {
      ok: result.ok,
      latencyMs: Date.now() - start,
      provider: conn.provider,
      error: result.error,
    };
  }

  async listConversations(tenantId: string) {
    return this.prisma.whatsAppConversation.findMany({
      where: { tenantId },
      include: { connection: { select: { provider: true, phoneNumber: true } } },
      orderBy: { lastMessageAt: "desc" },
      take: 50,
    });
  }

  async listMessages(tenantId: string, conversationId: string) {
    return this.prisma.whatsAppMessage.findMany({
      where: { tenantId, conversationId },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
  }
}