/**
 * WhatsApp adapters. Ver docs/10-wha.md T-WHA-01..07.
 *
 * Patrón adapter con dos implementaciones:
 *   - MetaChannel: WhatsApp Business Cloud API oficial.
 *   - EvolutionChannel: Baileys/Evolution API por QR.
 *
 * En V2 las llamadas reales requieren credenciales (Meta appId/secret,
 * Evolution API key). Sin esas credenciales el adapter responde en modo
 * fixture (T-WHA-07 health check). Las pruebas con conectores reales
 * son gate de release (G3).
 *
 * El resto del flujo (inbound dedup, mensajes, handoff) es código
 * productivo que opera sobre los datos ya normalizados.
 */

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

export interface SendMessageInput {
  tenantId: string;
  to: string; // E.164
  type: "text" | "template" | "image" | "audio";
  body: string;
  mediaUrl?: string;
  templateName?: string;
  /** Idioma con el que quedó aprobada la plantilla (`es_MX` por defecto). */
  templateLanguage?: string;
  /**
   * Parámetros del cuerpo de la plantilla, en orden `{{1}}`, `{{2}}`, …
   * La clave `body` es el atajo de una plantilla de un solo parámetro:
   * `{{1}}` = el texto ya renderizado.
   */
  templateVars?: Record<string, string>;
}

export interface SendMessageResult {
  externalId: string | null;
  status: "SENT" | "FAILED";
  error?: string;
}

export interface SendDocumentInput {
  tenantId: string;
  to: string; // E.164
  filename: string;
  mimetype: string;
  base64: string;
  caption?: string;
}

/** Tipos de adjunto que entiende Evolution (`mediatype` de sendMedia). */
export type MediaType = "image" | "video" | "audio" | "document";

export interface SendMediaInput extends SendDocumentInput {
  mediatype: MediaType;
}

/** IMAGE/AUDIO/VIDEO/DOCUMENT según el mimetype; lo que no sea media es documento. */
export function mediaTypeFromMime(mimetype: string): MediaType {
  const mime = mimetype.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

/**
 * Parámetros del cuerpo de una plantilla de Meta.
 *
 * Meta los recibe posicionales (`{{1}}`, `{{2}}`, …), no por nombre. Se ordena
 * por clave —`body` primero, que es el atajo de la plantilla de un solo
 * parámetro— para que el orden sea estable entre envíos.
 */
export function templateComponents(
  vars: Record<string, string> | undefined,
): Array<Record<string, unknown>> {
  const entries = Object.entries(vars ?? {}).filter(([, v]) => typeof v === "string" && v.length > 0);
  if (entries.length === 0) return [];
  entries.sort(([a], [b]) => (a === "body" ? -1 : b === "body" ? 1 : a.localeCompare(b)));
  return [
    {
      type: "body",
      parameters: entries.map(([, value]) => ({ type: "text", text: value })),
    },
  ];
}

export interface MediaKey {
  id: string;
  remoteJid: string;
  fromMe?: boolean;
}

export interface ChannelAdapter {
  readonly provider: "META" | "EVOLUTION";
  // Recibe la conexión concreta a revisar. Sin este argumento cada adapter
  // tomaba "la primera conexión ACTIVE del proveedor" de toda la base, así que
  // el health de una empresa se ejecutaba con las credenciales de otra.
  healthCheck(connectionId: string): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
  sendMessage(connectionId: string, input: SendMessageInput): Promise<SendMessageResult>;
  sendDocument?(connectionId: string, input: SendDocumentInput): Promise<SendMessageResult>;
  /** Imagen, video, audio (nota de voz) o documento como adjunto. */
  sendMedia?(connectionId: string, input: SendMediaInput): Promise<SendMessageResult>;
  getMediaBase64?(
    connectionId: string,
    key: MediaKey,
  ): Promise<{ base64: string; mimetype?: string } | null>;
}

@Injectable()
export class MetaChannel implements ChannelAdapter {
  readonly provider = "META" as const;

  constructor(private readonly prisma: PrismaService) {}

  async healthCheck(connectionId: string): Promise<{ ok: boolean; error?: string }> {
    // En V2 con credenciales reales: GET /<phone-id> con appId + token.
    // Sin credenciales: responde FIXTURE (T-WHA-07).
    // El llamador ya validó que la conexión es del tenant (WhatsAppService.health).
    const conn = await this.prisma.whatsAppConnection.findUnique({
      where: { id: connectionId },
    });
    if (!conn || conn.provider !== "META" || conn.status !== "ACTIVE") {
      return { ok: false, error: "No active Meta connection" };
    }
    return { ok: true };
  }

  async sendMessage(connectionId: string, input: SendMessageInput): Promise<SendMessageResult> {
    const conn = await this.prisma.whatsAppConnection.findUnique({
      where: { id: connectionId },
    });
    if (!conn || conn.provider !== "META" || conn.status !== "ACTIVE") {
      return { externalId: null, status: "FAILED", error: "Conexión Meta inactiva" };
    }
    const credentials = (conn.credentials ?? {}) as { token?: string; phoneId?: string };
    if (!credentials.token || !credentials.phoneId) {
      return { externalId: null, status: "FAILED", error: "Credenciales Meta faltantes" };
    }
    // POST https://graph.facebook.com/v17.0/{phone-id}/messages
    // body: { messaging_product: "whatsapp", to, type: "text", text: { body } }
    try {
      const res = await fetch(
        `https://graph.facebook.com/v17.0/${credentials.phoneId}/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${credentials.token}`,
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: input.to,
            type: input.type === "text" ? "text" : "template",
            text: input.type === "text" ? { body: input.body } : undefined,
            template:
              input.type === "template"
                ? {
                    name: input.templateName,
                    language: { code: input.templateLanguage || "es_MX" },
                    components: templateComponents(input.templateVars),
                  }
                : undefined,
          }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!res.ok) {
        return { externalId: null, status: "FAILED", error: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as { messages: Array<{ id: string }> };
      return { externalId: data.messages[0]?.id ?? null, status: "SENT" };
    } catch (err) {
      return { externalId: null, status: "FAILED", error: String(err) };
    }
  }
}

@Injectable()
export class EvolutionChannel implements ChannelAdapter {
  readonly provider = "EVOLUTION" as const;

  constructor(private readonly prisma: PrismaService) {}

  async healthCheck(connectionId: string): Promise<{ ok: boolean; error?: string }> {
    // Igual que en MetaChannel: la conexión concreta, no "la primera ACTIVE"
    // de cualquier empresa — si no, se salía a internet con el baseUrl y el
    // apiKey de otro tenant y se le devolvía a este si respondía.
    const conn = await this.prisma.whatsAppConnection.findUnique({
      where: { id: connectionId },
    });
    if (!conn || conn.provider !== "EVOLUTION" || conn.status !== "ACTIVE") {
      return { ok: false, error: "No active Evolution connection" };
    }
    const creds = (conn.credentials ?? {}) as { baseUrl?: string; apiKey?: string; instance?: string };
    if (!creds.baseUrl || !creds.instance) {
      return { ok: false, error: "Evolution baseUrl/instance no configurados" };
    }
    try {
      // GET /instance/connectionState/{instance}: sin el nombre de instancia
      // en la ruta, Evolution responde 404/400 aunque las credenciales sean
      // correctas — es el endpoint por instancia, no global.
      const res = await fetch(`${creds.baseUrl}/instance/connectionState/${creds.instance}`, {
        headers: { apikey: creds.apiKey ?? "" },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const data = (await res.json().catch(() => null)) as { instance?: { state?: string } } | null;
      const state = data?.instance?.state;
      return { ok: !state || state === "open" };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async sendMessage(connectionId: string, input: SendMessageInput): Promise<SendMessageResult> {
    const conn = await this.prisma.whatsAppConnection.findUnique({
      where: { id: connectionId },
    });
    if (!conn || conn.provider !== "EVOLUTION" || conn.status !== "ACTIVE") {
      return { externalId: null, status: "FAILED", error: "Conexión Evolution inactiva" };
    }
    const creds = (conn.credentials ?? {}) as { baseUrl?: string; instance?: string; apiKey?: string };
    if (!creds.baseUrl || !creds.instance) {
      return { externalId: null, status: "FAILED", error: "Credenciales Evolution faltantes" };
    }
    try {
      const res = await fetch(
        `${creds.baseUrl}/message/sendText/${creds.instance}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", apikey: creds.apiKey ?? "" },
          body: JSON.stringify({ number: input.to, text: input.body }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!res.ok) {
        return { externalId: null, status: "FAILED", error: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as { key?: { id?: string } };
      return { externalId: data.key?.id ?? null, status: "SENT" };
    } catch (err) {
      return { externalId: null, status: "FAILED", error: String(err) };
    }
  }

  /** PDF de cotización u otro documento, como adjunto (no como link). */
  async sendDocument(connectionId: string, input: SendDocumentInput): Promise<SendMessageResult> {
    return this.sendMedia(connectionId, { ...input, mediatype: "document" });
  }

  /**
   * Adjunto genérico. El audio va por `sendWhatsAppAudio` para que llegue
   * como nota de voz (burbuja con play), no como archivo descargable; el
   * resto por `sendMedia` con su `mediatype`.
   */
  async sendMedia(connectionId: string, input: SendMediaInput): Promise<SendMessageResult> {
    const conn = await this.prisma.whatsAppConnection.findUnique({
      where: { id: connectionId },
    });
    if (!conn || conn.provider !== "EVOLUTION" || conn.status !== "ACTIVE") {
      return { externalId: null, status: "FAILED", error: "Conexión Evolution inactiva" };
    }
    const creds = (conn.credentials ?? {}) as { baseUrl?: string; instance?: string; apiKey?: string };
    if (!creds.baseUrl || !creds.instance) {
      return { externalId: null, status: "FAILED", error: "Credenciales Evolution faltantes" };
    }
    const url =
      input.mediatype === "audio"
        ? `${creds.baseUrl}/message/sendWhatsAppAudio/${creds.instance}`
        : `${creds.baseUrl}/message/sendMedia/${creds.instance}`;
    const payload =
      input.mediatype === "audio"
        ? { number: input.to, audio: input.base64 }
        : {
            number: input.to,
            mediatype: input.mediatype,
            mimetype: input.mimetype,
            fileName: input.filename,
            caption: input.caption,
            media: input.base64,
          };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: creds.apiKey ?? "" },
        body: JSON.stringify(payload),
        // Un video o PDF grande tarda bastante más en subirse que un texto.
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        return { externalId: null, status: "FAILED", error: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as { key?: { id?: string } };
      return { externalId: data.key?.id ?? null, status: "SENT" };
    } catch (err) {
      return { externalId: null, status: "FAILED", error: String(err) };
    }
  }

  /**
   * Descarga audio/imagen/documento de un mensaje entrante como base64.
   * Evolution no manda el binario en el webhook, solo la referencia (key).
   */
  async getMediaBase64(
    connectionId: string,
    key: MediaKey,
  ): Promise<{ base64: string; mimetype?: string } | null> {
    const conn = await this.prisma.whatsAppConnection.findUnique({
      where: { id: connectionId },
    });
    if (!conn || conn.provider !== "EVOLUTION") return null;
    const creds = (conn.credentials ?? {}) as { baseUrl?: string; instance?: string; apiKey?: string };
    if (!creds.baseUrl || !creds.instance) return null;
    try {
      const res = await fetch(
        `${creds.baseUrl}/chat/getBase64FromMediaMessage/${creds.instance}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", apikey: creds.apiKey ?? "" },
          body: JSON.stringify({
            message: { key: { id: key.id, remoteJid: key.remoteJid, fromMe: key.fromMe ?? false } },
            convertToMp4: false,
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { base64?: string; mimetype?: string };
      if (!data.base64) return null;
      return { base64: data.base64, mimetype: data.mimetype };
    } catch {
      return null;
    }
  }
}