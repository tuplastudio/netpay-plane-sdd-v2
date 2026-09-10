/**
 * Puente WhatsApp → agente → WhatsApp (T-WHA-07 / T-AIA-06).
 *
 * Cada mensaje entrante se manda al agent-service con la conversación de
 * WhatsApp como `conversationId`, de modo que el estado del grafo y el hilo
 * del canal son el mismo hilo. Si el agente escala a humano, la conversación
 * se marca HANDED_OFF y el bot deja de publicar.
 *
 * El agente resuelve catálogo, precios y enlaces por su cuenta con su API key:
 * aquí no se le pasa ningún importe ni URL.
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { WhatsAppService } from "./whatsapp.service.js";

interface AgentReply {
  conversationId: string;
  reply: string;
  handoff: boolean;
  intent: string | null;
  attachment?: { filename: string; mimetype: string; base64: string } | null;
}

@Injectable()
export class AgentBridgeService {
  private readonly logger = new Logger(AgentBridgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wa: WhatsAppService,
  ) {}

  private get agentUrl(): string {
    return process.env.AGENT_URL ?? "http://localhost:8000";
  }

  private get agentHeaders(): Record<string, string> {
    const key = process.env.AGENT_INTERNAL_KEY ?? "";
    return key ? { "x-internal-key": key } : {};
  }

  get enabled(): boolean {
    return (process.env.AGENT_AUTOREPLY ?? "true").toLowerCase() !== "false";
  }

  /**
   * Responde un mensaje entrante. Devuelve null si no corresponde responder
   * (bot desactivado, conversación tomada por un humano o agente caído).
   */
  async handleInbound(input: {
    tenantId: string;
    conversationId: string;
    externalPhone: string;
    text: string;
    messageId: string;
    imageBase64?: string;
  }): Promise<AgentReply | null> {
    if (!this.enabled) return null;

    const conversation = await this.prisma.whatsAppConversation.findFirst({
      where: { id: input.conversationId, tenantId: input.tenantId },
    });
    if (!conversation || conversation.handoffToHuman) return null;

    let payload: AgentReply;
    try {
      const response = await fetch(`${this.agentUrl}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.agentHeaders },
        body: JSON.stringify({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          text: input.text,
          imageBase64: input.imageBase64,
          channel: "whatsapp",
          customerPhone: input.externalPhone,
          // Scopes del canal: el agente ya valida cada herramienta con su
          // propia API key contra este mismo backend.
          principalScopes: [
            "catalog.read",
            "quotes.read",
            "quotes.write",
            "orders.read",
            "orders.write",
            "chat.read",
            "chat.write",
          ],
        }),
        signal: AbortSignal.timeout(input.imageBase64 ? 45_000 : 30_000),
      });
      if (!response.ok) {
        this.logger.warn(`Agente respondió ${response.status} para ${input.conversationId}`);
        return null;
      }
      payload = (await response.json()) as AgentReply;
    } catch (error) {
      this.logger.warn(`Agente no disponible: ${(error as Error).message}`);
      return null;
    }

    if (payload.reply?.trim()) {
      await this.wa.send(input.tenantId, {
        tenantId: input.tenantId,
        to: input.externalPhone,
        type: "text",
        body: payload.reply,
      });
    }

    if (payload.attachment) {
      // Se manda después del texto: en WhatsApp un documento sin nada antes
      // se siente más a spam que a "aquí está tu cotización".
      const result = await this.wa.sendDocument(input.tenantId, {
        to: input.externalPhone,
        filename: payload.attachment.filename,
        mimetype: payload.attachment.mimetype,
        base64: payload.attachment.base64,
      });
      if (result.status === "FAILED") {
        this.logger.warn(`No se pudo mandar el adjunto a ${input.conversationId}: ${result.error}`);
      }
    }

    if (payload.handoff) {
      await this.prisma.whatsAppConversation.update({
        where: { id: input.conversationId },
        data: { status: "HANDED_OFF", handoffToHuman: true },
      });
    }

    return payload;
  }
}
