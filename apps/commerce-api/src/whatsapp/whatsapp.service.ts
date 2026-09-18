/**
 * WhatsApp service: conexiones, conversaciones, mensajes, handoff.
 * Ver docs/10-wha.md T-WHA-01..07.
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
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
import { ReplyModerationService, type ModerationDecision } from "./reply-moderation.service.js";
import { AgentLifecycleClient } from "./agent-lifecycle.client.js";
import {
  EvolutionApiError,
  EvolutionOnboardingService,
  type ProvisionResult,
} from "./evolution-onboarding.service.js";

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

/**
 * Orden del listado.
 *
 * `recent` es el de siempre (lo último que se movió, arriba). `oldest` es el
 * orden de triage de una cola: lo que lleva más tiempo sin moverse, primero.
 * Para un hilo sin responder `lastMessageAt` **es** `lastInboundAt` (sin
 * respuesta el último mensaje es el del cliente, por definición), así que
 * ordenar por `lastMessageAt asc` es exactamente "el que lleva más tiempo
 * esperando primero" — y se resuelve en el índice `(tenantId, lastMessageAt)`
 * que ya existe, sin ordenar en memoria sobre una página truncada.
 */
export type ConversationSort = "recent" | "oldest";

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
  /** Una etiqueta del hilo (ver `WhatsAppConversation.tags`). */
  tag?: string;
  /** Solo hilos sin asignar / asignados a esta persona. */
  assignee?: string;
  sort?: ConversationSort;
}

/** Acciones de `AuditLog` que deja este módulo sobre un hilo. */
export const CONVERSATION_AUDIT = {
  closed: "whatsapp.conversation.closed",
  reopened: "whatsapp.conversation.reopened",
  handoff: "whatsapp.conversation.handoff",
  claimed: "whatsapp.conversation.claimed",
  returned: "whatsapp.conversation.returned",
  tagsChanged: "whatsapp.conversation.tags_changed",
  customerLinked: "whatsapp.conversation.customer_linked",
} as const;

/** Estados que un operador puede fijar a mano desde el portal. */
export const MANUAL_STATUSES = ["OPEN", "CLOSED"] as const;
export type ManualConversationStatus = (typeof MANUAL_STATUSES)[number];

/** Tope de una etiqueta y del número de etiquetas por hilo (T-WHA / CRM básico). */
export const MAX_TAG_LENGTH = 30;
export const MAX_TAGS = 15;

export interface ConversationStats {
  /** Hilos con `status = OPEN`. */
  open: number;
  /** Hilos transferidos a una persona. */
  handedOff: number;
  /** Hilos no cerrados cuyo último mensaje es del cliente. */
  unanswered: number;
  /** Hilos con actividad hoy (día local del servidor). */
  today: number;
  /** Transferidos pero sin dueño: la "Cola" de la bandeja. */
  queue: number;
  /** Transferidos y con dueño: la vista "Por agente". */
  assigned: number;
}

export const DEFAULT_CONVERSATION_LIMIT = 50;

/**
 * Último mensaje del hilo: quién habló al final (`isUnanswered`) y un
 * adelanto de texto para la lista de la bandeja (`lastMessagePreview`).
 */
const LATEST_MESSAGE = {
  take: 1,
  orderBy: { createdAt: "desc" },
  select: { direction: true, body: true, messageType: true },
} satisfies Prisma.WhatsAppConversation$messagesArgs;

type LatestMessageRow = { direction: MessageDirection; body: string; messageType: string };

function isUnanswered(latest: LatestMessageRow[]): boolean {
  return latest[0]?.direction === "INBOUND";
}

const MEDIA_PREVIEW_LABEL: Record<string, string> = {
  IMAGE: "📷 Imagen",
  AUDIO: "🎤 Nota de voz",
  VIDEO: "🎞️ Video",
  DOCUMENT: "📎 Archivo",
};

/** Texto corto para la lista: media sin caption se anuncia por su tipo. */
function previewOf(latest: LatestMessageRow[]): string | null {
  const last = latest[0];
  if (!last) return null;
  if (last.body?.trim()) return last.body;
  return MEDIA_PREVIEW_LABEL[last.messageType] ?? null;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly meta: MetaChannel;
  private readonly evolution: EvolutionChannel;

  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ReplyModerationService,
    private readonly evolutionOnboarding: EvolutionOnboardingService,
    private readonly agentLifecycle: AgentLifecycleClient,
  ) {
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

    // Evolution con credenciales completas: el alta deja el webhook
    // registrado en la instancia, con un secreto NUEVO (el anterior está
    // hasheado y no se puede volver a mandar a Evolution). Sin esto el
    // operador tenía que copiar la URL a mano en el panel de Evolution.
    const evoCreds = input.credentials as { baseUrl?: string; apiKey?: string; instance?: string };
    const registersEvolutionWebhook =
      input.provider === "EVOLUTION" && Boolean(evoCreds.baseUrl && evoCreds.apiKey && evoCreds.instance);

    if (!webhookSecretHash || registersEvolutionWebhook) {
      plainWebhookSecret = randomBytes(18).toString("base64url");
      webhookSecretHash = await argon2.hash(plainWebhookSecret);
    }

    let webhookUrl = input.webhookUrl;
    let lastError: string | null = null;
    if (registersEvolutionWebhook) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
      webhookUrl = this.evolutionOnboarding.buildInboundWebhookUrl(tenant?.slug ?? tenantId, plainWebhookSecret);
      try {
        await this.evolutionOnboarding.registerWebhook(
          { baseUrl: String(evoCreds.baseUrl).replace(/\/+$/, ""), apiKey: String(evoCreds.apiKey), source: "tenant-connection" },
          String(evoCreds.instance),
          webhookUrl,
        );
      } catch (err) {
        // Las credenciales se guardan igual (el envío saliente puede
        // funcionar), pero se deja constancia de que el entrante no quedó
        // configurado para que el portal lo muestre.
        lastError = `No se pudo registrar el webhook en Evolution: ${(err as Error).message}`;
        this.logger.warn(`${lastError} (tenant ${tenantId}, instancia ${evoCreds.instance})`);
      }
    }

    const connection = await this.prisma.whatsAppConnection.upsert({
      where: { tenantId_provider: { tenantId, provider: input.provider } },
      create: {
        tenantId,
        provider: input.provider,
        phoneNumber: input.phoneNumber,
        status,
        credentials: input.credentials as never,
        webhookUrl,
        webhookSecretHash,
        lastError,
        connectedAt: status === "ACTIVE" ? new Date() : null,
      },
      update: {
        phoneNumber: input.phoneNumber,
        status,
        credentials: input.credentials as never,
        webhookUrl,
        webhookSecretHash,
        lastError,
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

  /**
   * Cambia solo la URL pública del webhook. Conserva `webhookSecretHash` (no
   * rota el secreto): si solo cambia el túnel (ngrok / dominio) sin comprometer
   * la integración, esta ruta evita el desconectar/reconectar y conserva la
   * configuración del provider y los webhooks que Evolution tiene apuntados.
   */
  async updateWebhookUrl(tenantId: string, id: string, webhookUrl: string) {
    const conn = await this.prisma.whatsAppConnection.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, provider: true, webhookUrl: true, version: true, credentials: true },
    });
    if (!conn) throw new NotFoundException({ code: "NOT_FOUND", message: "Conexión no accesible" });

    // Evolution: además de guardarla, se reapunta la instancia para que el
    // cambio surta efecto sin pasar por el panel de Evolution.
    let lastError: string | null = null;
    const creds = (conn.credentials ?? {}) as { baseUrl?: string; apiKey?: string; instance?: string };
    if (conn.provider === "EVOLUTION" && creds.baseUrl && creds.apiKey && creds.instance) {
      try {
        await this.evolutionOnboarding.registerWebhook(
          { baseUrl: creds.baseUrl.replace(/\/+$/, ""), apiKey: creds.apiKey, source: "tenant-connection" },
          creds.instance,
          webhookUrl,
        );
      } catch (err) {
        lastError = `No se pudo reapuntar el webhook en Evolution: ${(err as Error).message}`;
        this.logger.warn(`${lastError} (conexión ${id})`);
      }
    }

    const { webhookSecretHash: _omit, ...safe } = await this.prisma.whatsAppConnection.update({
      where: { id },
      data: { webhookUrl, lastError, version: { increment: 1 } },
    });
    this.logger.log(
      `webhookUrl de ${conn.provider} ${id} actualizada a ${webhookUrl} (anterior: ${conn.webhookUrl})`,
    );
    return safe;
  }

  async disconnect(tenantId: string, id: string) {
    return this.prisma.whatsAppConnection.updateMany({
      where: { id, tenantId },
      data: { status: "DISABLED", version: { increment: 1 } },
    });
  }

  // ---- Self-registration de Evolution (crear instancia + QR + webhook) ----

  /**
   * Da de alta una instancia de Evolution desde el portal. Crea la
   * instancia vía Evolution API, registra el webhook entrante (con el
   * secreto de este tenant en la URL) y devuelve el QR listo para mostrar.
   *
   * La fila de `WhatsAppConnection` se deja en `PENDING` desde este momento:
   * así el secreto ya está hasheado cuando Evolution empiece a llamar al
   * webhook (`connection.update` llega en cuanto el cliente escanea) y el
   * controller puede autenticar y activar la conexión sola, sin depender de
   * que el portal siga abierto para pulsar "finalizar".
   */
  async provisionEvolution(tenantId: string, phoneHint?: string): Promise<ProvisionResult & { connectionId: string }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant no accesible" });
    }
    const platform = await this.evolutionOnboarding.platformEvolution(tenantId);
    if (!platform) {
      throw new EvolutionApiError(
        "Evolution no está configurado: define EVOLUTION_BASE_URL y EVOLUTION_API_KEY_REF en el API, o conecta primero una instancia existente.",
        412,
      );
    }

    // Si había una instancia anterior a medio dar de alta, se limpia en
    // Evolution para no acumular instancias `connecting` huérfanas.
    const previous = await this.prisma.whatsAppConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: "EVOLUTION" } },
      select: { status: true, credentials: true },
    });
    const previousInstance = (previous?.credentials as { instance?: string } | null)?.instance;
    if (previous && previous.status !== "ACTIVE" && previousInstance) {
      await this.evolutionOnboarding.disconnectAndDelete(tenantId, previousInstance);
    }

    const webhookSecret = randomBytes(18).toString("base64url");
    const webhookSecretHash = await argon2.hash(webhookSecret);
    const result = await this.evolutionOnboarding.provision(tenant, { phoneHint, webhookSecret });

    const credentials = {
      baseUrl: platform.baseUrl,
      apiKey: platform.apiKey,
      instance: result.instanceName,
    };
    const connection = await this.prisma.whatsAppConnection.upsert({
      where: { tenantId_provider: { tenantId, provider: "EVOLUTION" } },
      create: {
        tenantId,
        provider: "EVOLUTION",
        phoneNumber: phoneHint?.trim() || null,
        status: "PENDING",
        credentials: credentials as never,
        webhookUrl: result.webhookUrl,
        webhookSecretHash,
        lastError: null,
        connectedAt: null,
      },
      update: {
        phoneNumber: phoneHint?.trim() || null,
        status: "PENDING",
        credentials: credentials as never,
        webhookUrl: result.webhookUrl,
        webhookSecretHash,
        lastError: null,
        connectedAt: null,
        version: { increment: 1 },
      },
    });
    return { ...result, connectionId: connection.id };
  }

  /**
   * Promueve una instancia recién escaneada a `ACTIVE`. Lo llama el portal
   * cuando ve el estado `open`; es idempotente con la activación automática
   * que dispara el webhook `connection.update`, así que da igual quién llegue
   * primero. Si no había fila previa (alta hecha fuera del portal) se crea
   * con un secreto nuevo y se reescribe el webhook en Evolution.
   */
  async finalizeEvolutionConnection(
    tenantId: string,
    instanceName: string,
    phoneHint?: string,
  ) {
    const state = await this.evolutionOnboarding.connectionState(tenantId, instanceName);
    if (state.state !== "open") {
      throw new BadRequestException({
        code: "INSTANCE_NOT_CONNECTED",
        message: `La instancia sigue en estado "${state.state}". Espera a que el cliente escanee el QR.`,
        state: state.state,
      });
    }
    const platform = await this.evolutionOnboarding.platformEvolution(tenantId);
    if (!platform) {
      throw new BadRequestException({
        code: "EVOLUTION_NOT_CONFIGURED",
        message: "Evolution no está configurado para este tenant.",
      });
    }
    const phoneNumber =
      phoneHint?.trim() || (state.number ? `+${state.number.replace(/^\+/, "")}` : "");

    const existing = await this.prisma.whatsAppConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: "EVOLUTION" } },
    });
    const existingInstance = (existing?.credentials as { instance?: string } | null)?.instance;

    let webhookUrl = existing?.webhookUrl ?? null;
    let webhookSecretHash = existing?.webhookSecretHash ?? null;
    let secret: string | undefined;
    if (!existing || existingInstance !== instanceName || !webhookSecretHash || !webhookUrl) {
      secret = randomBytes(18).toString("base64url");
      webhookSecretHash = await argon2.hash(secret);
      webhookUrl = await this.evolutionInboundUrl(tenantId, secret);
      await this.evolutionOnboarding.registerWebhook(platform, instanceName, webhookUrl);
    }

    const credentials = { baseUrl: platform.baseUrl, apiKey: platform.apiKey, instance: instanceName };
    const updated = await this.prisma.whatsAppConnection.upsert({
      where: { tenantId_provider: { tenantId, provider: "EVOLUTION" } },
      create: {
        tenantId,
        provider: "EVOLUTION",
        phoneNumber,
        status: "ACTIVE",
        credentials: credentials as never,
        webhookUrl,
        webhookSecretHash,
        lastError: null,
        connectedAt: new Date(),
      },
      update: {
        ...(phoneNumber ? { phoneNumber } : {}),
        status: "ACTIVE",
        credentials: credentials as never,
        webhookUrl,
        webhookSecretHash,
        lastError: null,
        connectedAt: new Date(),
        version: { increment: 1 },
      },
    });

    const { webhookSecretHash: _omit, ...safe } = updated;
    return { ...safe, webhookSecret: secret };
  }

  /**
   * Activación automática desde el webhook `connection.update` de Evolution:
   * en cuanto el cliente escanea el QR la instancia pasa a `open` y Evolution
   * nos lo avisa (ya autenticado por el secreto de la URL). Se activa la fila
   * `PENDING` de esa misma instancia; si la instancia no coincide (alta vieja)
   * o ya estaba `ACTIVE`, no se toca nada. `close` con logout deja la fila en
   * `ERROR` para que el portal lo muestre en vez de fallar en silencio al enviar.
   */
  async applyEvolutionConnectionUpdate(
    tenantId: string,
    update: { instance?: string; state?: string; ownerJid?: string | null; statusReason?: number | null },
  ): Promise<{ status: string } | null> {
    const connection = await this.prisma.whatsAppConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: "EVOLUTION" } },
    });
    if (!connection) return null;
    const instance = (connection.credentials as { instance?: string } | null)?.instance;
    if (update.instance && instance && update.instance !== instance) return null;

    if (update.state === "open") {
      if (connection.status === "ACTIVE") return { status: "ACTIVE" };
      const phone = update.ownerJid ? `+${String(update.ownerJid).split("@")[0]?.replace(/^\+/, "")}` : null;
      await this.prisma.whatsAppConnection.update({
        where: { id: connection.id },
        data: {
          status: "ACTIVE",
          ...(phone ? { phoneNumber: phone } : {}),
          connectedAt: new Date(),
          lastError: null,
          version: { increment: 1 },
        },
      });
      this.logger.log(`Evolution ${instance ?? "?"} abierta: conexión ${connection.id} ACTIVE (tenant ${tenantId})`);
      return { status: "ACTIVE" };
    }

    // 401 = "Log out instance": el teléfono desvinculó el dispositivo.
    if (update.state === "close" && update.statusReason === 401 && connection.status === "ACTIVE") {
      await this.prisma.whatsAppConnection.update({
        where: { id: connection.id },
        data: {
          status: "ERROR",
          lastError: "WhatsApp cerró la sesión del dispositivo. Vuelve a escanear el QR.",
          version: { increment: 1 },
        },
      });
      return { status: "ERROR" };
    }
    return { status: connection.status };
  }

  private async evolutionInboundUrl(tenantId: string, webhookSecret?: string): Promise<string> {
    // Misma forma de URL que usa el controller (`whatsapp.controller.ts` ->
    // `webhook/inbound/:tenantSlug`) y que arma EvolutionOnboardingService
    // en `provision()`.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true },
    });
    const slug = tenant?.slug ?? tenantId;
    return this.evolutionOnboarding.buildInboundWebhookUrl(slug, webhookSecret);
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

    // Un cliente que vuelve a escribir REABRE su ticket. Antes el upsert solo
    // movía `lastMessageAt`, así que un hilo cerrado (a mano o por el job de
    // inactividad) se quedaba en `CLOSED` mientras seguía recibiendo mensajes:
    // desaparecía de la bandeja "abiertas" y el pendiente no lo veía nadie.
    // Va como `updateMany` acotado por `status: CLOSED` —no como parte del
    // upsert, que no sabe condicionar el `update`— y solo cuesta una consulta
    // extra en el caso raro de que el hilo viniera cerrado.
    if (conversation.status === "CLOSED") {
      await this.prisma.whatsAppConversation.updateMany({
        where: { id: conversation.id, status: "CLOSED" },
        data: { status: "OPEN" },
      });
      await this.audit(input.tenantId, conversation.id, CONVERSATION_AUDIT.reopened, null, {
        reason: "Mensaje nuevo del cliente",
      });
      // El agente también debe soltar cualquier handoff viejo de ese hilo (si
      // el cierre no alcanzó a borrarlo). Sin esperar: el webhook no debe
      // demorarse por esto, y el puente además tolera el desfase (ver
      // agent-bridge.service.ts, reintento por HUMAN_ACTIVE).
      void this.agentLifecycle.release(input.tenantId, conversation.id);
    }

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
   * Conversación del tenant, con su conexión (para poder mandar por el canal
   * correcto). `requireHandoff` es la regla de todo lo que manda un operador
   * desde el portal: mientras el hilo lo lleve el agente, el operador no
   * escribe encima (se pisarían las respuestas); el envío de un link de
   * cotización es la única excepción explícita (T-WHA, "Cotizar rápido").
   */
  private async requireConversationWithConnection(
    tenantId: string,
    conversationId: string,
    opts: { requireHandoff: boolean },
  ) {
    const conv = await this.prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { connection: true },
    });
    if (!conv) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Conversación no accesible" });
    }
    if (opts.requireHandoff && !conv.handoffToHuman) {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "La conversación sigue con el agente",
      });
    }
    return conv;
  }

  private requireHandedOff(tenantId: string, conversationId: string) {
    return this.requireConversationWithConnection(tenantId, conversationId, { requireHandoff: true });
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
    // Filtro de respuestas humanas: si el tenant lo activó y la acción es
    // `block`, esto lanza 422 y el mensaje nunca sale. Ver
    // reply-moderation.service.ts (apagado por defecto y falla hacia abierto).
    const decision = await this.moderation.enforce(tenantId, text);
    const result = await this.adapterFor(conv.connection.provider).sendMessage(conv.connectionId, {
      tenantId,
      to: conv.externalPhone,
      type: "text",
      body: text,
    });
    const message = await this.persistOutbound(conv, { messageType: "TEXT", body: text, result });
    await this.noteModerationWarning(tenantId, message.id, decision);
    return message;
  }

  /**
   * Con la acción `warn` el mensaje sale igual, pero el hallazgo tiene que
   * quedar registrado. Se usa `MessageNote` —la tabla de notas internas de un
   * mensaje puntual, que ya existe— en vez de agregar columnas o un modelo
   * nuevo: es lo menos invasivo y el hilo ya sabe mostrar esas notas.
   * Nunca rompe el envío: el mensaje ya salió cuando esto corre.
   */
  private async noteModerationWarning(
    tenantId: string,
    messageId: string,
    decision: ModerationDecision,
  ): Promise<void> {
    if (decision.allowed || decision.action !== "warn") return;
    try {
      await this.prisma.messageNote.create({
        data: {
          tenantId,
          messageId,
          authorId: null,
          body: ReplyModerationService.warningNote(decision),
        },
      });
    } catch {
      // Anotar es trazabilidad, no parte del envío.
    }
  }

  /**
   * Texto saliente (típicamente un link de cotización) que se manda aunque el
   * hilo siga con el agente — a diferencia de `replyToConversation`, que exige
   * el handoff. Endpoint dedicado y estrecho (T-WHA, "Cotizar rápido") para no
   * aflojar la regla general de `reply`: solo sirve para esto.
   */
  async sendQuoteMessage(tenantId: string, conversationId: string, body: string) {
    const text = body?.trim();
    if (!text) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "El mensaje no puede ir vacío",
      });
    }
    const conv = await this.requireConversationWithConnection(tenantId, conversationId, {
      requireHandoff: false,
    });
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
    // El pie de foto es texto libre que escribe la misma persona: pasa por el
    // mismo filtro que una respuesta de texto. Sin pie no hay nada que revisar
    // y `enforce` corta sin llamar al agente.
    const decision = await this.moderation.enforce(tenantId, caption ?? "");
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
    const message = await this.persistOutbound(conv, {
      messageType: MEDIA_TO_MESSAGE_TYPE[mediatype],
      body: caption || filename,
      result,
    });
    await this.noteModerationWarning(tenantId, message.id, decision);
    return message;
  }

  /**
   * Deja rastro de lo que le pasó a un hilo (cerrar, reabrir, transferir,
   * tomar, devolver, etiquetar). De aquí sale la pestaña "Actividad" del panel
   * de contexto, que antes no podía contar nada porque estas acciones no se
   * registraban en ningún lado.
   *
   * A diferencia del autocierre —que escribe UNA entrada por lote— aquí sí va
   * una por hilo, con `targetId`: son acciones de una persona sobre un hilo
   * concreto, no un barrido. Nunca rompe la acción: anotar es trazabilidad.
   */
  private async audit(
    tenantId: string,
    conversationId: string,
    action: string,
    actorId: string | null | undefined,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          actorId: actorId ?? null,
          action,
          targetType: "WhatsAppConversation",
          targetId: conversationId,
          metadata: (metadata ?? {}) as never,
        },
      });
    } catch {
      // La bitácora no puede tumbar la operación que la produjo.
    }
  }

  /**
   * Cierra o reabre un hilo a mano (`PATCH conversations/:id/status`). Hasta
   * ahora solo el job de inactividad podía cerrar, y nada podía reabrir: un
   * ticket resuelto se quedaba en la bandeja hasta que el plazo lo alcanzara.
   *
   * Cerrar suelta el handoff, igual que hace el autocierre: un hilo cerrado no
   * puede quedar marcado como "lo atiende fulano", porque entonces el bot
   * tampoco volvería a contestarle a ese cliente. Reabrir lo devuelve al
   * agente (`OPEN`); quien lo quiera para sí lo toma después.
   */
  async setStatus(
    tenantId: string,
    conversationId: string,
    status: ManualConversationStatus,
    actorId?: string,
  ) {
    const conv = await this.requireConversation(tenantId, conversationId);
    if (status === "CLOSED" && conv.status === "CLOSED") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "La conversación ya está cerrada",
      });
    }
    if (status === "OPEN" && conv.status !== "CLOSED") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "La conversación ya está abierta",
      });
    }
    const updated = await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { status, handoffToHuman: false, handoffUserId: null },
    });
    // Mismo estado del otro lado: cerrar guarda el episodio y borra el hilo
    // del agente (un cliente que vuelve no hereda carritos viejos); reabrir
    // suelta el handoff en el agente, no solo aquí.
    if (status === "CLOSED") {
      await this.agentLifecycle.close(tenantId, conversationId, { delete: true });
    } else {
      await this.agentLifecycle.release(tenantId, conversationId);
    }
    await this.audit(
      tenantId,
      conversationId,
      status === "CLOSED" ? CONVERSATION_AUDIT.closed : CONVERSATION_AUDIT.reopened,
      actorId,
    );
    return updated;
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

  private async requireMessage(tenantId: string, messageId: string) {
    const msg = await this.prisma.whatsAppMessage.findFirst({ where: { id: messageId, tenantId } });
    if (!msg) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Mensaje no accesible" });
    }
    return msg;
  }

  /** Notas internas sobre UN mensaje puntual, más recientes primero. */
  async listMessageNotes(tenantId: string, messageId: string) {
    await this.requireMessage(tenantId, messageId);
    return this.prisma.messageNote.findMany({
      where: { tenantId, messageId },
      include: { author: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async addMessageNote(
    tenantId: string,
    messageId: string,
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
    await this.requireMessage(tenantId, messageId);
    return this.prisma.messageNote.create({
      data: { tenantId, messageId, authorId: authorId ?? null, body: text },
      include: { author: { select: { id: true, fullName: true, email: true } } },
    });
  }

  /**
   * Reemplaza las etiquetas del hilo (CRM básico): normaliza a minúsculas,
   * quita vacíos/duplicados y valida los topes de `MAX_TAGS`/`MAX_TAG_LENGTH`.
   */
  async setTags(
    tenantId: string,
    conversationId: string,
    rawTags: string[],
    actorId?: string,
  ) {
    await this.requireConversation(tenantId, conversationId);
    const normalized = Array.from(
      new Set(
        (rawTags ?? [])
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      ),
    );
    if (normalized.length > MAX_TAGS) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: `Máximo ${MAX_TAGS} etiquetas por conversación`,
      });
    }
    const tooLong = normalized.find((t) => t.length > MAX_TAG_LENGTH);
    if (tooLong) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: `La etiqueta "${tooLong}" supera los ${MAX_TAG_LENGTH} caracteres`,
      });
    }
    const updated = await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { tags: normalized },
    });
    await this.audit(tenantId, conversationId, CONVERSATION_AUDIT.tagsChanged, actorId, {
      tags: normalized,
    });
    return updated;
  }

  /**
   * Un agente humano toma un hilo de la cola sin asignar. A diferencia de
   * `/handoff` (que cualquiera puede disparar hacia cualquier userId), esto es
   * "yo lo tomo": falla si ya está asignado a otra persona.
   */
  async claim(tenantId: string, conversationId: string, userId: string) {
    const conv = await this.requireConversation(tenantId, conversationId);
    if (conv.handoffUserId && conv.handoffUserId !== userId) {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "Ya está asignada a otra persona",
      });
    }
    const updated = await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { status: "HANDED_OFF", handoffToHuman: true, handoffUserId: userId },
    });
    await this.audit(tenantId, conversationId, CONVERSATION_AUDIT.claimed, userId);
    return updated;
  }

  /**
   * Vincula el hilo a una ficha de cliente (p. ej. recién creada desde el
   * panel de contexto de la conversación, "Cliente sin ficha" → "Crear
   * cliente"). De paso deja una `CustomerIdentity` para este canal/teléfono,
   * si no existe otra ya: así la próxima vez que este número escriba, ya hay
   * con quién asociarlo automáticamente.
   */
  async linkCustomer(
    tenantId: string,
    conversationId: string,
    customerId: string,
    actorId?: string,
  ) {
    const conv = await this.requireConversationWithConnection(tenantId, conversationId, {
      requireHandoff: false,
    });
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Cliente no accesible" });
    }
    const channel = conv.connection.provider === "META" ? "WHATSAPP_META" : "WHATSAPP_EVOLUTION";
    const existingIdentity = await this.prisma.customerIdentity.findUnique({
      where: { channel_externalId: { channel, externalId: conv.externalPhone } },
    });
    if (!existingIdentity) {
      await this.prisma.customerIdentity.create({
        data: {
          customerId,
          channel,
          externalId: conv.externalPhone,
          verifiedAt: new Date(),
        },
      });
    }
    const updated = await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { customerId },
    });
    await this.audit(tenantId, conversationId, CONVERSATION_AUDIT.customerLinked, actorId);
    return updated;
  }

  /**
   * Personas activas como agente de WhatsApp (`Membership.isAgent`), con
   * cuántos hilos llevan asignados ahora mismo — un solo `groupBy`, no N+1.
   */
  async listAgents(tenantId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { tenantId, status: "ACTIVE", isAgent: true },
      select: { id: true, userId: true, user: { select: { fullName: true, email: true } } },
      orderBy: { user: { fullName: "asc" } },
    });
    const userIds = memberships.map((m) => m.userId);
    const counts = userIds.length
      ? await this.prisma.whatsAppConversation.groupBy({
          by: ["handoffUserId"],
          where: { tenantId, status: "HANDED_OFF", handoffUserId: { in: userIds } },
          _count: { _all: true },
        })
      : [];
    const countByUser = new Map(counts.map((c) => [c.handoffUserId, c._count._all]));
    return memberships.map((m) => ({
      id: m.id,
      userId: m.userId,
      fullName: m.user.fullName,
      email: m.user.email,
      activeConversations: countByUser.get(m.userId) ?? 0,
    }));
  }

  /** Devuelve el hilo al agente: a partir de aquí el bot vuelve a contestar. */
  async returnToAgent(tenantId: string, conversationId: string, actorId?: string) {
    await this.requireConversation(tenantId, conversationId);
    const updated = await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { handoffToHuman: false, handoffUserId: null, status: "OPEN" },
    });
    // Sin esto el agente seguía con `handoff=True` en su propio estado y
    // contestaba vacío (HUMAN_ACTIVE) al siguiente mensaje: el bot "volvía"
    // solo en la base de datos.
    await this.agentLifecycle.release(tenantId, conversationId);
    await this.audit(tenantId, conversationId, CONVERSATION_AUDIT.returned, actorId);
    return updated;
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
    actorId?: string,
  ) {
    const conv = await this.prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    if (!conv) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Conversación no accesible" });
    }
    const updated = await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: {
        status: "HANDED_OFF",
        handoffToHuman: true,
        handoffUserId: userId,
      },
      include: { handoffUser: { select: { fullName: true } } },
    });
    await this.audit(tenantId, conversationId, CONVERSATION_AUDIT.handoff, actorId, {
      userId,
      userName: updated.handoffUser?.fullName ?? null,
    });
    const { handoffUser: _handoffUser, ...conversation } = updated;
    return conversation;
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
    const result = await adapter.healthCheck(conn.id);
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
    if (filters.tag) where.tags = { has: filters.tag };
    // `unassigned` es la cola de la bandeja: transferido a una persona pero sin
    // dueño. Va en el `where` (no filtrando en memoria la página ya truncada)
    // para que "los 50 más viejos sin asignar" sean de verdad los más viejos.
    if (filters.assignee === "unassigned") {
      where.handoffToHuman = true;
      where.handoffUserId = null;
    } else if (filters.assignee) {
      where.handoffUserId = filters.assignee;
    }
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
        handoffUser: { select: { id: true, fullName: true } },
        messages: LATEST_MESSAGE,
      },
      orderBy: { lastMessageAt: filters.sort === "oldest" ? "asc" : "desc" },
      take: limit,
    });

    // `lastInboundAt` exacto aunque el último mensaje sea nuestro: un
    // groupBy sobre los hilos ya acotados, en vez de traer todo el historial.
    //
    // El nombre del cliente va en la misma tanda: `WhatsAppConversation` no
    // declara una relación a `Customer` (solo guarda `customerId`), así que en
    // vez de agregar una FK con migración se resuelve con UN `findMany` por
    // página — no una consulta por fila.
    const customerIds = Array.from(
      new Set(rows.map((r) => r.customerId).filter((id): id is string => !!id)),
    );
    const [lastInbound, customers] = await Promise.all([
      rows.length
        ? this.prisma.whatsAppMessage.groupBy({
            by: ["conversationId"],
            where: {
              tenantId,
              direction: "INBOUND",
              conversationId: { in: rows.map((r) => r.id) },
            },
            _max: { createdAt: true },
          })
        : Promise.resolve([]),
      customerIds.length
        ? this.prisma.customer.findMany({
            where: { tenantId, id: { in: customerIds } },
            select: { id: true, fullName: true },
          })
        : Promise.resolve([]),
    ]);
    const lastInboundById = new Map(lastInbound.map((g) => [g.conversationId, g._max.createdAt]));
    const customerById = new Map(customers.map((c) => [c.id, c]));

    return rows.map(({ messages, ...row }) => ({
      ...row,
      unanswered: isUnanswered(messages),
      lastInboundAt: lastInboundById.get(row.id) ?? null,
      lastMessagePreview: previewOf(messages),
      customer: row.customerId ? (customerById.get(row.customerId) ?? null) : null,
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
        handoffUserId: true,
        lastMessageAt: true,
        messages: LATEST_MESSAGE,
      },
    });
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const stats: ConversationStats = {
      open: 0,
      handedOff: 0,
      unanswered: 0,
      today: 0,
      queue: 0,
      assigned: 0,
    };
    for (const c of rows) {
      if (c.status === "OPEN") stats.open += 1;
      if (c.handoffToHuman) stats.handedOff += 1;
      // Los contadores de las pestañas salen de este mismo barrido: la
      // "Cola" y "Por agente" son vistas guardadas de la bandeja, no otra
      // consulta.
      if (c.handoffToHuman && !c.handoffUserId) stats.queue += 1;
      if (c.handoffToHuman && c.handoffUserId) stats.assigned += 1;
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