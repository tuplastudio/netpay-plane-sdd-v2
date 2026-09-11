/**
 * Filtro de respuestas humanas (lado commerce-api).
 *
 * Antes de que salga por WhatsApp lo que escribió una persona desde el inbox,
 * el texto se manda a `POST /moderation/reply` de agent-v2, que lo clasifica
 * con un modelo pequeño. El agente decide con la configuración del tenant:
 * si el filtro está apagado contesta `allowed: true` sin gastar una llamada
 * al LLM.
 *
 * Falla hacia abierto en los dos lados: si el agente no responde, tarda o
 * devuelve algo raro, el mensaje sale igual. Un moderador caído no puede
 * dejar al negocio sin contestarle a sus clientes.
 *
 * Misma plomería que `agent-bridge.service.ts` y que el `transcribeAudio` del
 * controlador: `AGENT_URL` + cabecera `x-internal-key`.
 */

import { Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";

export interface ModerationDecision {
  allowed: boolean;
  reason: string | null;
  categories: string[];
  model: string;
  latencyMs: number;
  /** Qué pidió el tenant que se haga con un mensaje marcado. */
  action: "block" | "warn";
  /** `false` cuando la decisión no la tomó el clasificador (apagado o caído). */
  checked: boolean;
}

const TIMEOUT_MS = 12_000;

const ALLOWED_BY_DEFAULT: ModerationDecision = {
  allowed: true,
  reason: null,
  categories: [],
  model: "",
  latencyMs: 0,
  action: "block",
  checked: false,
};

@Injectable()
export class ReplyModerationService {
  private readonly logger = new Logger(ReplyModerationService.name);

  private get agentUrl(): string {
    return process.env.AGENT_URL ?? "http://localhost:8000";
  }

  private get headers(): Record<string, string> {
    const key = process.env.AGENT_INTERNAL_KEY ?? "";
    return key ? { "x-internal-key": key } : {};
  }

  /** Clasifica el texto. Nunca lanza por fallas de red: devuelve "permitido". */
  async review(tenantId: string, text: string): Promise<ModerationDecision> {
    const body = (text ?? "").trim();
    if (!body) return ALLOWED_BY_DEFAULT;
    try {
      const res = await fetch(`${this.agentUrl}/moderation/reply`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.headers },
        body: JSON.stringify({ tenantId, text: body }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Filtro de respuestas respondió ${res.status}; se deja pasar`);
        return ALLOWED_BY_DEFAULT;
      }
      const data = (await res.json()) as Partial<ModerationDecision>;
      return {
        allowed: data.allowed !== false,
        reason: typeof data.reason === "string" && data.reason ? data.reason : null,
        categories: Array.isArray(data.categories) ? data.categories.map(String) : [],
        model: String(data.model ?? ""),
        latencyMs: Number(data.latencyMs ?? 0),
        action: data.action === "warn" ? "warn" : "block",
        checked: data.checked === true,
      };
    } catch (error) {
      this.logger.warn(`Filtro de respuestas no disponible: ${(error as Error).message}`);
      return ALLOWED_BY_DEFAULT;
    }
  }

  /**
   * Revisa y, si el tenant pidió `block`, corta el envío con 422
   * (`RULE_VIOLATION` en el envelope de `HttpExceptionFilter`) y el motivo en
   * español para que el operador reescriba. Con `warn` deja pasar y devuelve
   * la decisión para que quien llama la registre.
   */
  async enforce(tenantId: string, text: string): Promise<ModerationDecision> {
    const decision = await this.review(tenantId, text);
    if (!decision.allowed && decision.action === "block") {
      throw new UnprocessableEntityException({
        code: "RULE_VIOLATION",
        message:
          decision.reason ??
          "El mensaje no cumple las reglas de trato al cliente. Reescríbelo antes de enviarlo.",
      });
    }
    return decision;
  }

  /** Nota interna que queda en el hilo cuando la acción configurada es `warn`. */
  static warningNote(decision: ModerationDecision): string {
    const categories = decision.categories.length ? ` [${decision.categories.join(", ")}]` : "";
    return `⚠️ Filtro de respuestas: el mensaje se envió pese a marcarse${categories}. ${
      decision.reason ?? "Sin motivo detallado."
    }`;
  }
}
