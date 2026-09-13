/**
 * Ciclo de vida de una conversación visto desde el agente (agent-v2).
 *
 * `WhatsAppConversation` (Postgres) y el hilo del agente (checkpoint de
 * LangGraph) son dos estados distintos de LA MISMA conversación, y los dos
 * llevan su propia marca de handoff. Si commerce-api devuelve un hilo al bot
 * (`returnToAgent`, reabrir, autocierre) sin avisarle al agente, el agente
 * sigue creyendo que una persona lo atiende (`handoff=True` en su estado):
 * al siguiente mensaje contesta vacío con `intent: HUMAN_ACTIVE`, el puente
 * vuelve a marcar HANDED_OFF en la base, y el bot no le contesta nunca más a
 * ese cliente. Este cliente cierra ese hueco:
 *
 *  - `release`  → `POST /conversations/{id}/release`: el agente vuelve a
 *    contestar. Se llama cada vez que aquí se suelta el handoff.
 *  - `close`    → `POST /conversations/{id}/close?delete=true`: el agente
 *    guarda su memoria episódica (comportamiento, sin datos) y borra el hilo,
 *    para que un cliente que vuelve a escribir semanas después no herede
 *    carritos ni cotizaciones viejas.
 *
 * Todo es best-effort: nunca lanza, nunca bloquea una operación de negocio.
 * Un 404 cuenta como éxito (el agente no tenía hilo para esa conversación).
 * Mismo patrón de autenticación que `agent-bridge.service.ts`.
 */

import { Injectable, Logger } from "@nestjs/common";

const RELEASE_TIMEOUT_MS = 5_000;
/** El cierre puede extraer el episodio con un modelo: se le da más margen. */
const CLOSE_TIMEOUT_MS = 30_000;

export interface AgentCloseResult {
  ok: boolean;
  /** `true` si el agente devolvió un episodio (memoria episódica guardada). */
  episodeCaptured: boolean;
}

@Injectable()
export class AgentLifecycleClient {
  private readonly logger = new Logger(AgentLifecycleClient.name);

  private get agentUrl(): string {
    return process.env.AGENT_URL ?? "http://localhost:8000";
  }

  private get headers(): Record<string, string> {
    const key = process.env.AGENT_INTERNAL_KEY ?? "";
    return key ? { "x-internal-key": key } : {};
  }

  private url(conversationId: string, action: string, params: Record<string, string>): string {
    const query = new URLSearchParams(params).toString();
    return `${this.agentUrl}/conversations/${encodeURIComponent(conversationId)}/${action}?${query}`;
  }

  /** Devuelve el hilo al bot en el agente. `true` si el agente lo aceptó (o no tenía hilo). */
  async release(tenantId: string, conversationId: string): Promise<boolean> {
    try {
      const res = await fetch(this.url(conversationId, "release", { tenantId }), {
        method: "POST",
        headers: this.headers,
        signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS),
      });
      if (res.ok || res.status === 404) return true;
      this.logger.warn(`Agente respondió ${res.status} al liberar ${conversationId}`);
      return false;
    } catch (error) {
      this.logger.warn(`No se pudo liberar ${conversationId} en el agente: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Cierra el hilo en el agente: captura el episodio y, por defecto, borra
   * el checkpoint (carritos, cotizaciones, historial) de esa conversación.
   */
  async close(
    tenantId: string,
    conversationId: string,
    opts: { delete?: boolean; channel?: string } = {},
  ): Promise<AgentCloseResult> {
    const params: Record<string, string> = {
      tenantId,
      delete: String(opts.delete ?? true),
      channel: opts.channel ?? "whatsapp",
    };
    try {
      const res = await fetch(this.url(conversationId, "close", params), {
        method: "POST",
        headers: this.headers,
        signal: AbortSignal.timeout(CLOSE_TIMEOUT_MS),
      });
      if (res.status === 404) return { ok: true, episodeCaptured: false };
      if (!res.ok) {
        this.logger.warn(`Agente respondió ${res.status} al cerrar ${conversationId}`);
        return { ok: false, episodeCaptured: false };
      }
      const body = (await res.json().catch(() => ({}))) as { episode?: unknown };
      return { ok: true, episodeCaptured: Boolean(body.episode) };
    } catch (error) {
      this.logger.warn(`No se pudo cerrar ${conversationId} en el agente: ${(error as Error).message}`);
      return { ok: false, episodeCaptured: false };
    }
  }

  /** Cierra varios hilos con concurrencia acotada (autocierre por lotes). */
  async closeMany(tenantId: string, conversationIds: string[], concurrency = 4): Promise<number> {
    let captured = 0;
    for (let i = 0; i < conversationIds.length; i += concurrency) {
      const chunk = conversationIds.slice(i, i + concurrency);
      const results = await Promise.all(chunk.map((id) => this.close(tenantId, id)));
      captured += results.filter((r) => r.episodeCaptured).length;
    }
    return captured;
  }
}
