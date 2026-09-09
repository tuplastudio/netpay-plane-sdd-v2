import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import argon2 from "argon2";
import { WhatsAppService } from "./whatsapp.service.js";
import { AgentBridgeService } from "./agent-bridge.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { Public } from "../auth/guards/principal.guard.js";
import { RequestContext } from "../common/context/request-context.js";

@Controller("whatsapp")
@UseGuards(RoleGuard)
export class WhatsAppController {
  constructor(
    private readonly wa: WhatsAppService,
    private readonly agent: AgentBridgeService,
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

  @Post(":id/health")
  @RequireScopes("chat.read" as never)
  async health(@Param("id") id: string) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.health(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  @Get("conversations")
  @RequireScopes("chat.read" as never)
  async conversations() {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.wa.listConversations(tenantId),
      requestId: RequestContext.requestId,
    };
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
      data: await this.wa.handoffToHuman(tenantId, id, body.userId),
      requestId: RequestContext.requestId,
    };
  }

  // ---- Webhook público para que Meta/Evolution entreguen mensajes ----

  @Public()
  @Post("webhook/inbound/:tenantSlug")
  @HttpCode(200)
  async inboundWebhook(
    @Param("tenantSlug") tenantSlug: string,
    @Body() body: unknown,
    @Query("secret") secret?: string,
  ) {
    const tenant = await this.wa["prisma"].tenant.findUnique({
      where: { slug: tenantSlug },
    });
    if (!tenant) return { data: { ok: false } };

    const parsed = await this.parseInboundPayload(tenant.id, body, secret);
    if (!parsed.ok) {
      return { data: { ok: false, reason: parsed.reason } };
    }

    let message = parsed.message;
    let messageType: "TEXT" | "AUDIO" | "IMAGE" = "TEXT";
    let imageBase64: string | undefined;

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