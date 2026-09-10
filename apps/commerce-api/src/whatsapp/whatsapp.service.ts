/**
 * WhatsApp service: conexiones, conversaciones, mensajes, handoff.
 * Ver docs/10-wha.md T-WHA-01..07.
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import {
  Prisma,
  type ConversationStatus,
  type MessageDirection,
  type WhatsAppProvider,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { MAX_PAGE_SIZE } from "../common/pagination.js";
import {
  MetaChannel,
  EvolutionChannel,
  mediaTypeFromMime,
  type ChannelAdapter,
  type MediaKey,
  type MediaType,
  type SendMessageInput,
  type SendMessageResult,
} from "./channels.js";

/** Tope de adjunto que manda un operador desde el portal (decodificado). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Prefijos/valores de mimetype que se aceptan como adjunto saliente. */
const ALLOWED_MIME_PREFIXES = ["image/", "audio/", "video/", "application/", "text/plain"];

const MEDIA_TO_MESSAGE_TYPE: Record<MediaType, "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT"> = {
  image: "IMAGE",
  audio: "AUDIO",
  video: "VIDEO",
  document: "DOCUMENT",
};

export interface OperatorAttachmentInput {
  filename: string;
  mimetype: string;
  base64: string;
  caption?: string;
}

/** Filtros de `GET /whatsapp/conversations`. Todos opcionales. */
export interface ConversationListFilters {
  /** Fragmento del teléfono (E.164) del cliente. */
  q?: string;
  status?: ConversationStatus;
  /** `human`: transferidas a una persona; `agent`: las atiende el bot. */
  handoff?: "agent" | "human";
  provider?: WhatsAppProvider;
  /** Acotan por `lastMessageAt`. */
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface ConversationStats {
  /** Hilos con `status = OPEN`. */
  open: number;
  /** Hilos transferidos a una persona. */
  handedOff: number;
  /** Hilos no cerrados cuyo último mensaje es del cliente. */
  unanswered: number;
  /** Hilos con actividad hoy (día local del servidor). */
  today: number;
}

export const DEFAULT_CONVERSATION_LIMIT = 50;

/** Último mensaje del hilo, para saber quién habló al final. */
const LATEST_MESSAGE = {
  take: 1,
  orderBy: { createdAt: "desc" },
  select: { direction: true },
} satisfies Prisma.WhatsAppConversation$messagesArgs;

function isUnanswered(latest: Array<{ direction: MessageDirection }>): boolean {
  return latest[0]?.direction === "INBOUND";
}

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

    try {
      return await this.prisma.whatsAppMessage.create({
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
    } catch (err) {
      // Carrera con otra entrega del mismo webhook (Evolution reintenta el
      // mismo `externalId` si la primera tardó en responder): el check de
      // arriba no lo vio porque ninguna de las dos había hecho commit
      // todavía. Quien pierde la carrera del índice único no falla, regresa
      // el mensaje que sí quedó.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const existing = await this.prisma.whatsAppMessage.findUnique({
          where: { externalId: input.externalId },
        });
        if (existing) return existing;
      }
      throw err;
    }
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

    const conversation = await this.prisma.whatsAppConversation.upsert({
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

    // Antes esto no quedaba en WhatsAppMessage: la respuesta del bot salía
    // por Evolution pero no aparecía en `GET conversations/:id/messages`, así
    // que el panel solo mostraba la mitad de la conversación (lo que
    // preguntaba el cliente, nunca lo que contestó el bot).
    await this.prisma.whatsAppMessage.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        messageType:
          input.type === "image" ? "IMAGE" : input.type === "audio" ? "AUDIO" : "TEXT",
        externalId: result.externalId ?? undefined,
        body: input.body,
        mediaUrl: input.mediaUrl,
        status: result.status === "SENT" ? "SENT" : "FAILED",
        errorMessage: result.error,
        sentAt: result.status === "SENT" ? new Date() : null,
      },
    });

    return result;
  }

  /** PDF de cotización u otro documento como adjunto (T-WHA-05, variante media). */
  async sendDocument(
    tenantId: string,
    input: { to: string; filename: string; mimetype: string; base64: string; caption?: string },
  ): Promise<SendMessageResult> {
    const conn = await this.prisma.whatsAppConnection.findFirst({
      where: { tenantId, status: "ACTIVE" },
    });
    if (!conn) {
      return { externalId: null, status: "FAILED", error: "Sin conexiones activas" };
    }
    const adapter: ChannelAdapter = conn.provider === "META" ? this.meta : this.evolution;
    if (!adapter.sendDocument) {
      return { externalId: null, status: "FAILED", error: `${conn.provider} no soporta adjuntos` };
    }
    const result = await adapter.sendDocument(conn.id, { tenantId, ...input });

    const conversation = await this.prisma.whatsAppConversation.upsert({
      where: {
        connectionId_externalPhone: { connectionId: conn.id, externalPhone: input.to },
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

    await this.prisma.whatsAppMessage.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        messageType: "DOCUMENT",
        externalId: result.externalId ?? undefined,
        body: input.caption || input.filename,
        status: result.status === "SENT" ? "SENT" : "FAILED",
        errorMessage: result.error,
        sentAt: result.status === "SENT" ? new Date() : null,
      },
    });

    return result;
  }

  private adapterFor(provider: "META" | "EVOLUTION"): ChannelAdapter {
    return provider === "META" ? this.meta : this.evolution;
  }

  /**
   * Conversación del tenant que ya está con una persona. Es la regla de todo
   * lo que manda un operador desde el portal: mientras el hilo lo lleve el
   * agente, el operador no escribe encima (se pisarían las respuestas).
   */
  private async requireHandedOff(tenantId: string, conversationId: string) {
    const conv = await this.prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { connection: true },
    });
    if (!conv) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Conversación no accesible" });
    }
    if (!conv.handoffToHuman) {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "La conversación sigue con el agente",
      });
    }
    return conv;
  }

  /** Persiste el saliente del operador y mueve `lastMessageAt`. */
  private async persistOutbound(
    conv: { id: string; tenantId: string },
    input: {
      messageType: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
      body: string;
      result: SendMessageResult;
    },
  ) {
    const [message] = await this.prisma.$transaction([
      this.prisma.whatsAppMessage.create({
        data: {
          tenantId: conv.tenantId,
          conversationId: conv.id,
          direction: "OUTBOUND",
          messageType: input.messageType,
          externalId: input.result.externalId ?? undefined,
          body: input.body,
          status: input.result.status === "SENT" ? "SENT" : "FAILED",
          errorMessage: input.result.error,
          sentAt: input.result.status === "SENT" ? new Date() : null,
        },
      }),
      this.prisma.whatsAppConversation.update({
        where: { id: conv.id },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    return message;
  }

  /**
   * Texto que escribe una persona desde el portal en un hilo transferido.
   * Sale por la conexión propia de la conversación (no por "la primera
   * activa": el cliente escribió a un número concreto y debe recibir la
   * respuesta desde ese mismo número).
   */
  async replyToConversation(tenantId: string, conversationId: string, body: string) {
    const text = body?.trim();
    if (!text) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "El mensaje no puede ir vacío",
      });
    }
    const conv = await this.requireHandedOff(tenantId, conversationId);
    const result = await this.adapterFor(conv.connection.provider).sendMessage(conv.connectionId, {
      tenantId,
      to: conv.externalPhone,
      type: "text",
      body: text,
    });
    return this.persistOutbound(conv, { messageType: "TEXT", body: text, result });
  }

  /**
   * Adjunto (imagen, nota de voz, video o archivo) del operador. El tipo de
   * mensaje se deriva del mimetype; el cuerpo guardado es el caption o, si
   * no hay, el nombre del archivo, para que el hilo siga siendo legible.
   */
  async sendAttachmentToConversation(
    tenantId: string,
    conversationId: string,
    input: OperatorAttachmentInput,
  ) {
    const mimetype = (input.mimetype ?? "").trim().toLowerCase();
    const filename = (input.filename ?? "").trim();
    if (!filename || !mimetype || !ALLOWED_MIME_PREFIXES.some((p) => mimetype.startsWith(p))) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Tipo de archivo no permitido",
      });
    }
    // Se tolera el prefijo data-URL que dejan algunos lectores del navegador.
    const base64 = (input.base64 ?? "").replace(/^data:[^;]+;base64,/, "").trim();
    if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "El archivo no viene en base64 válido",
      });
    }
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    const decodedBytes = (base64.length * 3) / 4 - padding;
    if (decodedBytes > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "El archivo supera los 25 MB",
      });
    }

    const conv = await this.requireHandedOff(tenantId, conversationId);
    const adapter = this.adapterFor(conv.connection.provider);
    const mediatype = mediaTypeFromMime(mimetype);
    const caption = input.caption?.trim() || undefined;
    const result: SendMessageResult = adapter.sendMedia
      ? await adapter.sendMedia(conv.connectionId, {
          tenantId,
          to: conv.externalPhone,
          mediatype,
          filename,
          mimetype,
          base64,
          caption,
        })
      : {
          externalId: null,
          status: "FAILED",
          error: `${conv.connection.provider} no soporta adjuntos todavía`,
        };
    return this.persistOutbound(conv, {
      messageType: MEDIA_TO_MESSAGE_TYPE[mediatype],
      body: caption || filename,
      result,
    });
  }

  private async requireConversation(tenantId: string, conversationId: string) {
    const conv = await this.prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    if (!conv) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Conversación no accesible" });
    }
    return conv;
  }

  /** Notas internas del hilo (no se envían al cliente), más recientes primero. */
  async listNotes(tenantId: string, conversationId: string) {
    await this.requireConversation(tenantId, conversationId);
    return this.prisma.conversationNote.findMany({
      where: { tenantId, conversationId },
      include: { author: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async addNote(
    tenantId: string,
    conversationId: string,
    authorId: string | undefined,
    body: string,
  ) {
    const text = body?.trim();
    if (!text) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "La nota no puede ir vacía",
      });
    }
    await this.requireConversation(tenantId, conversationId);
    return this.prisma.conversationNote.create({
      data: { tenantId, conversationId, authorId: authorId ?? null, body: text },
      include: { author: { select: { id: true, fullName: true, email: true } } },
    });
  }

  /** Devuelve el hilo al agente: a partir de aquí el bot vuelve a contestar. */
  async returnToAgent(tenantId: string, conversationId: string) {
    await this.requireConversation(tenantId, conversationId);
    return this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { handoffToHuman: false, handoffUserId: null, status: "OPEN" },
    });
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

  /**
   * Lista de hilos con filtros. Cada fila trae `unanswered` (el último mensaje
   * es del cliente y nadie —ni el agente ni una persona— ha contestado) y
   * `lastInboundAt` (cuándo escribió el cliente por última vez). Ambos salen
   * de una sola consulta: el `messages: { take: 1 }` anidado se traduce a un
   * lateral join por hilo, suficiente para el tamaño actual de la tabla.
   */
  async listConversations(tenantId: string, filters: ConversationListFilters = {}) {
    const where: Prisma.WhatsAppConversationWhereInput = { tenantId };
    const q = filters.q?.trim();
    if (q) where.externalPhone = { contains: q };
    if (filters.status) where.status = filters.status;
    if (filters.handoff) where.handoffToHuman = filters.handoff === "human";
    if (filters.provider) where.connection = { provider: filters.provider };
    if (filters.from || filters.to) {
      where.lastMessageAt = {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      };
    }
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_CONVERSATION_LIMIT, 1), MAX_PAGE_SIZE);

    const rows = await this.prisma.whatsAppConversation.findMany({
      where,
      include: {
        connection: { select: { provider: true, phoneNumber: true } },
        messages: LATEST_MESSAGE,
      },
      orderBy: { lastMessageAt: "desc" },
      take: limit,
    });

    // `lastInboundAt` exacto aunque el último mensaje sea nuestro: un
    // groupBy sobre los hilos ya acotados, en vez de traer todo el historial.
    const lastInbound = rows.length
      ? await this.prisma.whatsAppMessage.groupBy({
          by: ["conversationId"],
          where: {
            tenantId,
            direction: "INBOUND",
            conversationId: { in: rows.map((r) => r.id) },
          },
          _max: { createdAt: true },
        })
      : [];
    const lastInboundById = new Map(lastInbound.map((g) => [g.conversationId, g._max.createdAt]));

    return rows.map(({ messages, ...row }) => ({
      ...row,
      unanswered: isUnanswered(messages),
      lastInboundAt: lastInboundById.get(row.id) ?? null,
    }));
  }

  /**
   * KPIs de la bandeja para todo el tenant, sin filtros: la tira de resumen
   * describe la bandeja completa aunque el listado esté acotado. Una sola
   * consulta con el último mensaje por hilo; el resto es conteo en memoria.
   */
  async conversationStats(tenantId: string, now = new Date()): Promise<ConversationStats> {
    const rows = await this.prisma.whatsAppConversation.findMany({
      where: { tenantId },
      select: {
        status: true,
        handoffToHuman: true,
        lastMessageAt: true,
        messages: LATEST_MESSAGE,
      },
    });
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const stats: ConversationStats = { open: 0, handedOff: 0, unanswered: 0, today: 0 };
    for (const c of rows) {
      if (c.status === "OPEN") stats.open += 1;
      if (c.handoffToHuman) stats.handedOff += 1;
      // Un hilo cerrado con último mensaje del cliente no es un pendiente.
      if (c.status !== "CLOSED" && isUnanswered(c.messages)) stats.unanswered += 1;
      if (c.lastMessageAt && c.lastMessageAt >= startOfToday) stats.today += 1;
    }
    return stats;
  }

  async listMessages(tenantId: string, conversationId: string) {
    return this.prisma.whatsAppMessage.findMany({
      where: { tenantId, conversationId },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
  }
}