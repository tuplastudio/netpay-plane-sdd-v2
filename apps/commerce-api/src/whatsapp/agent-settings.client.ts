/**
 * Lectura de la configuración por tenant del agente desde commerce-api.
 *
 * Esos ajustes NO viven en Postgres: el agente los guarda como un JSON por
 * tenant (`AGENT_SETTINGS_DIR`), y el panel los edita contra `GET/PUT
 * /settings` de agent-v2. Aquí solo se leen —el job de autocierre necesita
 * saber si el tenant lo activó y con qué plazo— usando el mismo patrón
 * autenticado con `x-internal-key` que ya usa `agent-bridge.service.ts` y el
 * `transcribeAudio` del controlador.
 *
 * Se cachea 60 s: el job corre cada minuto sobre todos los tenants activos y
 * sin caché le pegaría al agente una vez por tenant por minuto para leer un
 * archivo que casi nunca cambia.
 */

import { Injectable, Logger } from "@nestjs/common";

/** Subconjunto de `AgentSettings` (agent-v2) que le importa a commerce-api. */
export interface AgentTenantSettings {
  auto_close_enabled: boolean;
  auto_close_after: string;
  human_reply_filter_enabled: boolean;
  human_reply_filter_action: string;
  /**
   * Modo de cobro del bot: `quote_only` | `quote_and_pay` | `pay_first`.
   * En `quote_only` el negocio no cobra por enlace: el link público de la
   * cotización no ofrece pagar y `POST /orders/public/quote/:token/checkout`
   * se rechaza. Los demás modos solo cambian el flujo del bot.
   */
  checkout_mode: string;
}

const CACHE_TTL_MS = 60_000;
const TIMEOUT_MS = 5_000;

@Injectable()
export class AgentSettingsClient {
  private readonly logger = new Logger(AgentSettingsClient.name);
  private readonly cache = new Map<string, { at: number; value: AgentTenantSettings | null }>();

  private get agentUrl(): string {
    return process.env.AGENT_URL ?? "http://localhost:8000";
  }

  private get headers(): Record<string, string> {
    const key = process.env.AGENT_INTERNAL_KEY ?? "";
    return key ? { "x-internal-key": key } : {};
  }

  /** `null` cuando el agente no respondió: quien llama debe tratarlo como "sin configuración". */
  async get(tenantId: string): Promise<AgentTenantSettings | null> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    let value: AgentTenantSettings | null = null;
    try {
      const res = await fetch(
        `${this.agentUrl}/settings?tenantId=${encodeURIComponent(tenantId)}`,
        { headers: this.headers, signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (res.ok) {
        const body = (await res.json()) as { settings?: Partial<AgentTenantSettings> };
        const s = body.settings ?? {};
        value = {
          auto_close_enabled: Boolean(s.auto_close_enabled),
          auto_close_after: String(s.auto_close_after ?? ""),
          human_reply_filter_enabled: Boolean(s.human_reply_filter_enabled),
          human_reply_filter_action: String(s.human_reply_filter_action ?? "block"),
          checkout_mode: String(s.checkout_mode ?? "quote_and_pay"),
        };
      } else {
        this.logger.warn(`Agente respondió ${res.status} al leer ajustes de ${tenantId}`);
      }
    } catch (error) {
      this.logger.warn(`No se pudieron leer los ajustes de ${tenantId}: ${(error as Error).message}`);
    }

    // También se cachea el fallo: si el agente está caído, reintentarlo cada
    // minuto por tenant no lo revive y sí llena el log.
    this.cache.set(tenantId, { at: Date.now(), value });
    return value;
  }

  /**
   * `false` solo cuando el tenant está en `quote_only`. Si el agente no
   * respondió se asume que sí se cobra (el flujo de siempre): apagar el
   * cobro por un fallo transitorio dejaría a un negocio sin vender.
   */
  async paymentLinksEnabled(tenantId: string): Promise<boolean> {
    const settings = await this.get(tenantId);
    return settings?.checkout_mode !== "quote_only";
  }

  /** Solo para pruebas y para forzar una relectura tras guardar en el panel. */
  invalidate(tenantId?: string): void {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }
}
