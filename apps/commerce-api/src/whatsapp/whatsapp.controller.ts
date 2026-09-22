import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Delete,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import argon2 from "argon2";
import type { Response } from "express";
import {
  DEFAULT_CONVERSATION_LIMIT,
  MANUAL_STATUSES,
  WhatsAppService,
  type ConversationListFilters,
  type ConversationSort,
  type ManualConversationStatus,
} from "./whatsapp.service.js";
import { ConversationContextService } from "./conversation-context.service.js";
import { MAX_PAGE_SIZE } from "../common/pagination.js";
import { AgentBridgeService } from "./agent-bridge.service.js";
import { EvolutionApiError, EvolutionOnboardingService } from "./evolution-onboarding.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { Public } from "../auth/guards/principal.guard.js";
import { RequestContext } from "../common/context/request-context.js";

const CONVERSATION_STATUSES = ["OPEN", "HANDED_OFF", "CLOSED"] as const;
const HANDOFF_FILTERS = ["agent", "human"] as const;
const WHATSAPP_PROVIDERS = ["META", "EVOLUTION"] as const;
const CONVERSATION_SORTS = ["recent", "oldest"] as const;
/** UUID v4 o el literal `unassigned` (la cola sin dueño). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valor de un query param acotado a una lista; vacío = sin filtro. */
function parseEnum<T extends string>(
  name: string,
  raw: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (!raw) return undefined;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new BadRequestException(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return raw as T;
}

function parseDate(name: string, raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${name} must be an ISO date`);
  return d;
}

/**
 * `assignee`: el id de la persona dueña del hilo, o `unassigned` para la cola
 * sin dueño. Se valida la forma de UUID aquí para no mandar basura al `where`
 * (Postgres revienta un uuid mal formado con un 500, no con un 400).
 */
function parseAssignee(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (value === "unassigned") return value;
  if (!UUID_RE.test(value)) {
    throw new BadRequestException("assignee must be a UUID or 'unassigned'");
  }
  return value;
}

function parseLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_CONVERSATION_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new BadRequestException(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }
  return Math.min(n, MAX_PAGE_SIZE);
}

@Controller("whatsapp")
@UseGuards(RoleGuard)
export class WhatsAppController {
  constructor(
    private readonly wa: WhatsAppService,
    private readonly agent: AgentBridgeService,
    private readonly context: ConversationContextService,
    private readonly evolutionOnboarding: EvolutionOnboardingService,
  ) {}

  @Get("connections")
  @RequireScopes("chat.read" as never)
  async listConnections() {
    const tenantId = RequestContext.tenantId!;
    return { data: await this.wa.listConnections(tenantId), requestId: RequestContext.requestId };
  }

  @Post("connect")
  @HttpCode(201)
  @RequireScopes("chat.write" as never)
  async connect(
    @Body()
    body: {
      provider: "META" | "EVOLUTION";
      phoneNumber?: string;
      credentials: Record<string, unknown>;
      webhookUrl?: string;
    },
  ) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.connect(tenantId, body),
      requestId: RequestContext.requestId,
    };
  }

  @Post(":id/disconnect")
  @HttpCode(204)
  @RequireScopes("chat.write" as never)
  async disconnect(@Param("id") id: string) {
    const tenantId = RequestContext.tenantId!;
    await this.wa.disconnect(tenantId, id);
  }

  @Post(":id/rotate-webhook-secret")
  @RequireScopes("chat.write" as never)
  async rotateWebhookSecret(@Param("id") id: string) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.rotateWebhookSecret(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  /**
   * Cambia solo la URL pública del webhook (útil cuando se levanta otro túnel
   * ngrok, Cloudflare Tunnel o cambia el dominio). Conserva el `webhookSecret`
   * actual: NO lo rota. Si la URL debe validarse como HTTPS absoluto, se
   * rechaza en runtime con `400`.
   *
   * Casos típicos:
   * - Bot dejó de responder y el `webhookUrl` quedó apuntando a un túnel de
   *   ngrok muerto (err 3200 al pegarle). Levantas uno nuevo, actualizas aquí.
   * - Cambiaste de demo.ngrok.io a prod.midominio.com.
   */
  @Patch(":id/webhook-url")
  @RequireScopes("chat.write" as never)
  async updateWebhookUrl(
    @Param("id") id: string,
    @Body() body: { webhookUrl?: string },
  ) {
    const url = (body.webhookUrl ?? "").trim();
    if (!url) {
      throw new BadRequestException({
        code: "VALIDATION",
        message: "webhookUrl es obligatorio",
      });
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException({
        code: "VALIDATION",
        message: "webhookUrl no es una URL válida",
      });
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new BadRequestException({
        code: "VALIDATION",
        message: "webhookUrl debe ser http(s)",
      });
    }
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.updateWebhookUrl(tenantId, id, url),
      requestId: RequestContext.requestId,
    };
  }

  @Post(":id/health")
  @RequireScopes("chat.read" as never)
  async health(@Param("id") id: string) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.health(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  // ---- Self-registration con Evolution -------------------------------------
  // Hasta ahora el operador tenía que entrar a `evolution.dominio/manager`,
  // crear la instancia a mano y luego pegar credenciales en este portal. Los
  // endpoints de abajo cierran ese paso: desde el portal Web basta con pedir
  // "alta" — el backend crea la instancia en Evolution, registra el webhook
  // y devuelve el QR ya listo.

  /** `POST /whatsapp/evolution/provision`. Crea una instancia nueva y la conecta al tenant. */
  @Post("evolution/provision")
  @HttpCode(201)
  @RequireScopes("chat.write" as never)
  async provisionEvolution(@Body() body: { phoneNumber?: string }) {
    const tenantId = RequestContext.tenantId!;
    try {
      const result = await this.wa.provisionEvolution(tenantId, body.phoneNumber);
      return { data: result, requestId: RequestContext.requestId };
    } catch (err) {
      if (err instanceof EvolutionApiError) {
        throw new BadRequestException({
          code: "EVOLUTION_API_ERROR",
          message: err.message,
          status: err.status,
        });
      }
      throw err;
    }
  }

  /** `GET /whatsapp/evolution/qr/:instance`. Refresca el QR (rota cada ~60s). */
  @Get("evolution/qr/:instance")
  @RequireScopes("chat.read" as never)
  async evolutionQrCode(@Param("instance") instance: string) {
    const tenantId = RequestContext.tenantId!;
    const base64 = await this.evolutionOnboarding.fetchQrCode(tenantId, instance);
    return { data: { qrCodeBase64: base64 }, requestId: RequestContext.requestId };
  }

  /** `GET /whatsapp/evolution/image/:instance`. Devuelve el QR como PNG. */
  @Get("evolution/image/:instance")
  @RequireScopes("chat.read" as never)
  async evolutionQrImage(
    @Param("instance") instance: string,
    @Res() res: Response,
  ) {
    const tenantId = RequestContext.tenantId!;
    const base64 = await this.evolutionOnboarding.fetchQrCode(tenantId, instance);
    if (!base64) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "QR no disponible" } });
      return;
    }
    const match = base64.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) {
      res.status(502).json({ error: { code: "BAD_QR_FORMAT", message: "Evolution devolvió un QR inesperado" } });
      return;
    }
    const buf = Buffer.from(match[2] ?? "", "base64");
    res.setHeader("content-type", `image/${match[1]}`);
    res.setHeader("cache-control", "no-store");
    res.send(buf);
  }

  /** `GET /whatsapp/evolution/state/:instance`. Estado de la instancia. */
  @Get("evolution/state/:instance")
  @RequireScopes("chat.read" as never)
  async evolutionState(@Param("instance") instance: string) {
    const tenantId = RequestContext.tenantId!;
    try {
      const state = await this.evolutionOnboarding.connectionState(tenantId, instance);
      return { data: state, requestId: RequestContext.requestId };
    } catch (err) {
      if (err instanceof EvolutionApiError) {
        throw new BadRequestException({
          code: "EVOLUTION_API_ERROR",
          message: err.message,
          status: err.status,
        });
      }
      throw err;
    }
  }

  /**
   * `POST /whatsapp/evolution/finalize/:instance`. Confirma la instancia y
   * la deja en `ACTIVE` guardando `WhatsAppConnection`. Se llama cuando el
   * cliente ya escaneó el QR y el estado de Evolution es `open`.
   */
  @Post("evolution/finalize/:instance")
  @HttpCode(200)
  @RequireScopes("chat.write" as never)
  async finalizeEvolution(
    @Param("instance") instance: string,
    @Body() body: { phoneNumber?: string },
  ) {
    const tenantId = RequestContext.tenantId!;
    const result = await this.wa.finalizeEvolutionConnection(
      tenantId,
      instance,
      body.phoneNumber,
    );
    return { data: result, requestId: RequestContext.requestId };
  }

  /** `DELETE /whatsapp/evolution/instance/:instance`. Limpia la instancia en Evolution. */
  @Delete("evolution/instance/:instance")
  @HttpCode(204)
  @RequireScopes("chat.write" as never)
  async evolutionCleanup(@Param("instance") instance: string) {
    const tenantId = RequestContext.tenantId!;
    await this.evolutionOnboarding.disconnectAndDelete(tenantId, instance);
  }

  /**
   * Bandeja de conversaciones. `data` respeta los filtros; `stats` describe el
   * tenant completo para que la tira de resumen no cambie al filtrar.
   */
  @Get("conversations")
  @RequireScopes("chat.read" as never)
  async conversations(
    @Query("q") q?: string,
    @Query("status") status?: string,
    @Query("handoff") handoff?: string,
    @Query("provider") provider?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("tag") tag?: string,
    @Query("sort") sort?: string,
    @Query("assignee") assignee?: string,
  ) {
    const tenantId = RequestContext.tenantId!;
    const filters: ConversationListFilters = {
      q: q?.trim() || undefined,
      status: parseEnum("status", status, CONVERSATION_STATUSES),
      handoff: parseEnum("handoff", handoff, HANDOFF_FILTERS),
      provider: parseEnum("provider", provider, WHATSAPP_PROVIDERS),
      from: parseDate("from", from),
      to: parseDate("to", to),
      limit: parseLimit(limit),
      tag: tag?.trim().toLowerCase() || undefined,
      sort: parseEnum<ConversationSort>("sort", sort, CONVERSATION_SORTS),
      assignee: parseAssignee(assignee),
    };
    const [data, stats] = await Promise.all([
      this.wa.listConversations(tenantId, filters),
      this.wa.conversationStats(tenantId),
    ]);
    return { data, stats, requestId: RequestContext.requestId };
  }

  @Get("conversations/:id/messages")
  @RequireScopes("chat.read" as never)
  async messages(@Param("id") id: string) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.listMessages(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  /**
   * Contexto CRM completo del hilo en una sola lectura: ficha del cliente,
   * agregados de gasto, pedidos/cotizaciones/pagos recientes, notas internas y
   * la línea de tiempo fusionada. Ver `conversation-context.service.ts`.
   */
  @Get("conversations/:id/context")
  @RequireScopes("chat.read" as never)
  async conversationContext(@Param("id") id: string) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.context.get(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  /**
   * Cerrar / reabrir un hilo a mano. Antes solo el job de inactividad podía
   * cerrar y nada podía reabrir.
   */
  @Patch("conversations/:id/status")
  @RequireScopes("chat.write" as never)
  async setStatus(@Param("id") id: string, @Body() body: { status?: string }) {
    const tenantId = RequestContext.tenantId!;
    const status = parseEnum<ManualConversationStatus>("status", body?.status, MANUAL_STATUSES);
    if (!status) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: `status debe ser uno de: ${MANUAL_STATUSES.join(", ")}`,
      });
    }
    return {
      data: await this.wa.setStatus(tenantId, id, status, RequestContext.userId),
      requestId: RequestContext.requestId,
    };
  }

  /** Personas activas como agente de WhatsApp y cuántos hilos llevan ahora. */
  @Get("agents")
  @RequireScopes("chat.read" as never)
  async agents() {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.listAgents(tenantId),
      requestId: RequestContext.requestId,
    };
  }

  @Get("messages/:id/notes")
  @RequireScopes("chat.read" as never)
  async messageNotes(@Param("id") id: string) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.listMessageNotes(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  @Post("messages/:id/notes")
  @HttpCode(201)
  @RequireScopes("chat.write" as never)
  async addMessageNote(@Param("id") id: string, @Body() body: { body: string }) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.addMessageNote(tenantId, id, RequestContext.userId, body?.body),
      requestId: RequestContext.requestId,
    };
  }

  /** Vincula el hilo a una ficha de cliente ("Cliente sin ficha" → "Crear cliente"). */
  @Patch("conversations/:id/customer")
  @RequireScopes("chat.write" as never)
  async linkCustomer(@Param("id") id: string, @Body() body: { customerId: string }) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.linkCustomer(tenantId, id, body?.customerId, RequestContext.userId),
      requestId: RequestContext.requestId,
    };
  }

  @Patch("conversations/:id/tags")
  @RequireScopes("chat.write" as never)
  async setTags(@Param("id") id: string, @Body() body: { tags: string[] }) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.setTags(
        tenantId,
        id,
        Array.isArray(body?.tags) ? body.tags : [],
        RequestContext.userId,
      ),
      requestId: RequestContext.requestId,
    };
  }

  /** Un agente humano toma un hilo de la cola sin asignar ("Tomar"). */
  @Post("conversations/:id/claim")
  @HttpCode(200)
  @RequireScopes("chat.write" as never)
  async claim(@Param("id") id: string) {
    const tenantId = RequestContext.tenantId!;
    const userId = RequestContext.userId;
    if (!userId) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Esta acción requiere una sesión de usuario del portal",
      });
    }
    return {
      data: await this.wa.claim(tenantId, id, userId),
      requestId: RequestContext.requestId,
    };
  }

  /** Manda un link de cotización (u otro texto) aunque el hilo siga con el agente. */
  @Post("conversations/:id/send-quote")
  @HttpCode(201)
  @RequireScopes("chat.write" as never)
  async sendQuote(@Param("id") id: string, @Body() body: { body: string }) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.sendQuoteMessage(tenantId, id, body?.body),
      requestId: RequestContext.requestId,
    };
  }

  @Post("send")
  @HttpCode(201)
  @RequireScopes("chat.write" as never)
  async send(
    @Body()
    body: {
      to: string;
      type: "text" | "template" | "image" | "audio";
      body: string;
      templateName?: string;
      mediaUrl?: string;
    },
  ) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.send(tenantId, {
        tenantId,
        to: body.to,
        type: body.type,
        body: body.body,
        templateName: body.templateName,
        mediaUrl: body.mediaUrl,
      }),
      requestId: RequestContext.requestId,
    };
  }

  @Post("conversations/:id/handoff")
  @HttpCode(200)
  @RequireScopes("chat.write" as never)
  async handoff(
    @Param("id") id: string,
    @Body() body: { userId: string },
  ) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.handoffToHuman(tenantId, id, body.userId, RequestContext.userId),
      requestId: RequestContext.requestId,
    };
  }

  // ---- Atención humana: lo que hace el operador en un hilo transferido ----

  @Post("conversations/:id/reply")
  @HttpCode(201)
  @RequireScopes("chat.write" as never)
  async reply(@Param("id") id: string, @Body() body: { body: string }) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.replyToConversation(tenantId, id, body?.body),
      requestId: RequestContext.requestId,
    };
  }

  @Post("conversations/:id/attachments")
  @HttpCode(201)
  @RequireScopes("chat.write" as never)
  async attachment(
    @Param("id") id: string,
    @Body() body: { filename: string; mimetype: string; base64: string; caption?: string },
  ) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.sendAttachmentToConversation(tenantId, id, {
        filename: body?.filename,
        mimetype: body?.mimetype,
        base64: body?.base64,
        caption: body?.caption,
      }),
      requestId: RequestContext.requestId,
    };
  }

  @Get("conversations/:id/notes")
  @RequireScopes("chat.read" as never)
  async notes(@Param("id") id: string) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.listNotes(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  @Post("conversations/:id/notes")
  @HttpCode(201)
  @RequireScopes("chat.write" as never)
  async addNote(@Param("id") id: string, @Body() body: { body: string }) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.addNote(tenantId, id, RequestContext.userId, body?.body),
      requestId: RequestContext.requestId,
    };
  }

  @Post("conversations/:id/return")
  @HttpCode(200)
  @RequireScopes("chat.write" as never)
  async returnToAgent(@Param("id") id: string) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.returnToAgent(tenantId, id, RequestContext.userId),
      requestId: RequestContext.requestId,
    };
  }

  // ---- Webhook público para que Meta/Evolution entreguen mensajes ----

  /**
   * Webhook público. Evolution lo llama con la URL que registramos en el alta
   * (`?secret=<plano>`); también se acepta el secreto en `x-webhook-secret`
   * para despliegues donde la URL no puede llevar query. Un `connection.update`
   * con estado `open` activa la conexión solo (ver
   * `WhatsAppService.applyEvolutionConnectionUpdate`).
   */
  @Public()
  @Post("webhook/inbound/:tenantSlug")
  @HttpCode(200)
  async inboundWebhook(
    @Param("tenantSlug") tenantSlug: string,
    @Body() body: unknown,
    @Query("secret") querySecret?: string,
    @Headers("x-webhook-secret") headerSecret?: string,
  ) {
    const secret = querySecret || headerSecret;
    const tenant = await this.wa["prisma"].tenant.findUnique({
      where: { slug: tenantSlug },
    });
    if (!tenant) return { data: { ok: false } };

    const parsed = await this.parseInboundPayload(tenant.id, body, secret);
    if (!parsed.ok) {
      return { data: { ok: false, reason: parsed.reason } };
    }

    if (parsed.connectionUpdate) {
      const result = await this.wa.applyEvolutionConnectionUpdate(tenant.id, parsed.connectionUpdate);
      return { data: { ok: true, connection: result?.status ?? null } };
    }

    let message = parsed.message;
    let messageType: "TEXT" | "AUDIO" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION" = "TEXT";
    let imageBase64: string | undefined;
    let latitude: number | undefined;
    let longitude: number | undefined;

    if (!message && parsed.audio) {
      // Nota de voz: se descarga el binario y se transcribe a nivel backend
      // (T-AIA) para que el texto entre al mismo flujo del agente y quede
      // buscable en WhatsAppMessage.body, igual que un mensaje de texto.
      const media = await this.wa.downloadMedia(parsed.audio.connectionId, parsed.audio.key);
      const transcript = media ? await this.transcribeAudio(media.base64, media.mimetype) : null;
      if (transcript?.trim()) {
        message = {
          provider: parsed.audio.provider,
          connectionId: parsed.audio.connectionId,
          externalPhone: parsed.audio.externalPhone,
          body: transcript,
          externalId: parsed.audio.externalId,
        };
        messageType = "AUDIO";
      }
    }

    if (!message && parsed.image) {
      // Foto de producto, catálogo ajeno, lista escrita a mano, etc.: se
      // manda tal cual al agente (visión), que la interpreta él mismo.
      const media = await this.wa.downloadMedia(parsed.image.connectionId, parsed.image.key);
      if (media) {
        message = {
          provider: parsed.image.provider,
          connectionId: parsed.image.connectionId,
          externalPhone: parsed.image.externalPhone,
          body: parsed.image.caption || "[el cliente envió una imagen]",
          externalId: parsed.image.externalId,
        };
        messageType = "IMAGE";
        imageBase64 = media.base64;
      }
    }

    if (!message && parsed.location) {
      // Ubicación compartida por el cliente desde WhatsApp. NO la guardamos
      // como dirección de envío: las coordenadas del GPS no resuelven la
      // zona del admin (necesita CP / ciudad / estado). El agente usa la
      // lat/lng para confirmar zona horaria o ubicación geográfica general
      // y PIDE el CP / ciudad / estado por texto, como hace el prompt
      // v1.4.1 `55_envio_domicilio.md`.
      const lat = parsed.location.latitude;
      const lng = parsed.location.longitude;
      const caption = parsed.location.caption?.trim();
      const body = caption
        ? `[ubicación compartida: ${lat}, ${lng}] ${caption}`
        : `[el cliente compartió su ubicación: ${lat}, ${lng}]`;
      message = {
        provider: parsed.location.provider,
        connectionId: parsed.location.connectionId,
        externalPhone: parsed.location.externalPhone,
        body,
        externalId: parsed.location.externalId,
      };
      messageType = "LOCATION";
      latitude = lat;
      longitude = lng;
    }

    if (!message) {
      // Evento reconocido pero sin texto que procesar (media sin caption o
      // que no se pudo descargar/transcribir, eco de un mensaje propio,
      // evento de conexión, etc.) — se confirma recepción sin generar un
      // mensaje ni respuesta del agente.
      return { data: { ok: true, ignored: true } };
    }

    const msg = await this.wa.ingestInbound({
      tenantId: tenant.id,
      provider: message.provider,
      connectionId: message.connectionId,
      externalPhone: message.externalPhone,
      body: message.body,
      externalId: message.externalId,
      messageType,
      latitude,
      longitude,
    });

    // El agente responde en el mismo hilo. Si está caído o el chat ya lo tomó
    // un humano, el webhook igual confirma la recepción del mensaje.
    const answered = await this.agent.handleInbound({
      tenantId: tenant.id,
      conversationId: msg.conversationId,
      externalPhone: message.externalPhone,
      text: message.body,
      messageId: msg.externalId ?? msg.id,
      imageBase64,
    });

    return {
      data: {
        ok: true,
        messageId: msg.id,
        answered: Boolean(answered?.reply),
        handoff: Boolean(answered?.handoff),
      },
    };
  }

  private async parseInboundPayload(
    tenantId: string,
    body: unknown,
    secret: string | undefined,
  ): Promise<
    | { ok: false; reason: string }
    | {
        ok: true;
        message: {
          provider: "META" | "EVOLUTION";
          connectionId: string;
          externalPhone: string;
          body: string;
          externalId: string;
        } | null;
        audio?: {
          provider: "EVOLUTION";
          connectionId: string;
          externalPhone: string;
          externalId: string;
          key: { id: string; remoteJid: string; fromMe?: boolean };
        };
        image?: {
          provider: "EVOLUTION";
          connectionId: string;
          externalPhone: string;
          externalId: string;
          key: { id: string; remoteJid: string; fromMe?: boolean };
          caption?: string;
        };
        /** Ubicación compartida por el cliente desde WhatsApp. */
        location?: {
          provider: "EVOLUTION";
          connectionId: string;
          externalPhone: string;
          externalId: string;
          key: { id: string; remoteJid: string; fromMe?: boolean };
          latitude: number;
          longitude: number;
          caption?: string;
        };
        /** Evento `connection.update` de Evolution (QR escaneado, logout…). */
        connectionUpdate?: {
          instance?: string;
          state?: string;
          ownerJid?: string | null;
          statusReason?: number | null;
        };
      }
  > {
    const obj = (body ?? {}) as Record<string, unknown>;

    // Forma legacy/manual (pruebas, curl): ya trae connectionId explícito.
    // Se mantiene sin exigir secreto — solo alcanzable sabiendo el connectionId.
    if (
      typeof obj.connectionId === "string" &&
      typeof obj.externalPhone === "string" &&
      typeof obj.body === "string"
    ) {
      return {
        ok: true,
        message: {
          provider: (obj.provider as "META" | "EVOLUTION" | undefined) ?? "META",
          connectionId: obj.connectionId,
          externalPhone: obj.externalPhone,
          body: obj.body,
          externalId: typeof obj.externalId === "string" ? obj.externalId : crypto.randomUUID(),
        },
      };
    }

    // Forma real de Evolution API: { event, instance, data: { key, message, ... } }.
    if (typeof obj.event === "string" && obj.data && typeof obj.data === "object") {
      const connection = await this.wa["prisma"].whatsAppConnection.findUnique({
        where: { tenantId_provider: { tenantId, provider: "EVOLUTION" } },
      });
      if (!connection) return { ok: false, reason: "no hay conexión Evolution para este tenant" };

      if (connection.webhookSecretHash) {
        const valid = secret ? await argon2.verify(connection.webhookSecretHash, secret) : false;
        if (!valid) return { ok: false, reason: "secreto de webhook inválido o ausente" };
      }

      if (obj.event === "connection.update") {
        const data = obj.data as { state?: string; statusReason?: number; wuid?: string; instance?: string };
        return {
          ok: true,
          message: null,
          connectionUpdate: {
            instance: typeof obj.instance === "string" ? obj.instance : data.instance,
            state: data.state,
            ownerJid: data.wuid ?? null,
            statusReason: typeof data.statusReason === "number" ? data.statusReason : null,
          },
        };
      }

      if (obj.event !== "messages.upsert") {
        return { ok: true, message: null };
      }

      const data = obj.data as {
        key?: { remoteJid?: string; fromMe?: boolean; id?: string };
        message?: {
          conversation?: string;
          extendedTextMessage?: { text?: string };
          audioMessage?: { ptt?: boolean; mimetype?: string };
          imageMessage?: { caption?: string; mimetype?: string };
          locationMessage?: {
            degreesLatitude?: number;
            degreesLongitude?: number;
            caption?: string;
          };
        };
      };
      if (data.key?.fromMe) {
        // Eco de un mensaje que nosotros mismos enviamos.
        return { ok: true, message: null };
      }
      const remoteJid = data.key?.remoteJid;
      const text = data.message?.conversation ?? data.message?.extendedTextMessage?.text;
      if (!remoteJid) {
        return { ok: true, message: null };
      }
      if (!text && data.message?.audioMessage && data.key?.id) {
        return {
          ok: true,
          message: null,
          audio: {
            provider: "EVOLUTION",
            connectionId: connection.id,
            externalPhone: `+${remoteJid.split("@")[0]}`,
            externalId: data.key.id,
            key: { id: data.key.id, remoteJid, fromMe: data.key.fromMe },
          },
        };
      }
      if (!text && data.message?.imageMessage && data.key?.id) {
        return {
          ok: true,
          message: null,
          image: {
            provider: "EVOLUTION",
            connectionId: connection.id,
            externalPhone: `+${remoteJid.split("@")[0]}`,
            externalId: data.key.id,
            key: { id: data.key.id, remoteJid, fromMe: data.key.fromMe },
            caption: data.message.imageMessage.caption,
          },
        };
      }
      if (
        !text &&
        data.message?.locationMessage &&
        typeof data.message.locationMessage.degreesLatitude === "number" &&
        typeof data.message.locationMessage.degreesLongitude === "number" &&
        data.key?.id
      ) {
        return {
          ok: true,
          message: null,
          location: {
            provider: "EVOLUTION",
            connectionId: connection.id,
            externalPhone: `+${remoteJid.split("@")[0]}`,
            externalId: data.key.id,
            key: { id: data.key.id, remoteJid, fromMe: data.key.fromMe },
            latitude: data.message.locationMessage.degreesLatitude,
            longitude: data.message.locationMessage.degreesLongitude,
            caption: data.message.locationMessage.caption,
          },
        };
      }
      if (!text) {
        // Mensaje sin texto (imagen/documento sin caption) u otro evento.
        return { ok: true, message: null };
      }
      const externalPhone = `+${remoteJid.split("@")[0]}`;
      const externalId = data.key?.id ?? crypto.randomUUID();

      return {
        ok: true,
        message: {
          provider: "EVOLUTION",
          connectionId: connection.id,
          externalPhone,
          body: text,
          externalId,
        },
      };
    }

    return { ok: false, reason: "forma de payload no reconocida" };
  }

  /**
   * Nota de voz -> texto vía el STT de agent-service (mismo Whisper que usa
   * el micrófono del chat web). Falla silencioso: si no hay transcripción,
   * el mensaje se descarta como "ignored" arriba, no se cae el webhook.
   */
  private async transcribeAudio(base64: string, mimetype?: string): Promise<string | null> {
    const agentUrl = process.env.AGENT_URL ?? "http://localhost:8000";
    const key = process.env.AGENT_INTERNAL_KEY ?? "";
    const ext = mimetype?.includes("ogg") ? "ogg" : mimetype?.includes("mp4") ? "m4a" : "ogg";
    try {
      const res = await fetch(`${agentUrl}/audio/stt`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { "x-internal-key": key } : {}),
        },
        body: JSON.stringify({ audioBase64: base64, filename: `nota.${ext}` }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { text?: string };
      return data.text ?? null;
    } catch {
      return null;
    }
  }
}