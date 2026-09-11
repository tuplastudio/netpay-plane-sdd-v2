/**
 * Autocierre de conversaciones por inactividad.
 *
 * Cada tenant decide desde el panel del agente si lo quiere
 * (`auto_close_enabled`) y con qué ventana sin mensajes (`auto_close_after`,
 * en formato compacto: `30s`, `15m`, `2h`, `1d`). El job vive aquí y no en el
 * agente porque quien manda sobre `WhatsAppConversation` es esta API.
 *
 * **Cómo se agenda.** El repo no tiene cron: `apps/commerce-worker` es un
 * consumidor de outbox/inbox de RabbitMQ, no un scheduler, y `@nestjs/schedule`
 * no es dependencia del monorepo. En vez de agregar un paquete nuevo se usa un
 * `setInterval` de un minuto con `unref()` en un servicio dedicado, que es la
 * misma granularidad que daría un `@Cron("* * * * *")`. Si algún día entra
 * `@nestjs/schedule`, `runOnce()` se anota con `@Cron` y `onModuleInit`
 * desaparece: el trabajo real ya está separado del temporizador.
 *
 * **Qué le hace a un hilo.** Lo pasa a `CLOSED` y además suelta el handoff
 * (`handoffToHuman: false`, `handoffUserId: null`), igual que
 * `returnToAgent()`. La inactividad es inactividad: un hilo que una persona
 * tomó y dejó abandonado tres días también está inactivo, y dejarlo marcado
 * como "lo atiende fulano" haría que el bot nunca vuelva a contestarle a ese
 * cliente (ver el `if (conversation.handoffToHuman) return null` de
 * `agent-bridge.service.ts`). Al cerrarse queda liberado.
 *
 * **Idempotencia y costo.** Un solo `updateMany` por tenant, acotado por
 * `(tenantId, lastMessageAt)` —índice que ya existe en el esquema— y con
 * `status != CLOSED`, así que una segunda pasada sobre lo mismo no toca nada.
 * Los hilos sin `lastMessageAt` (creados sin mensajes) nunca entran: no hay
 * "última actividad" contra la cual medir.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { AgentSettingsClient, AgentTenantSettings } from "./agent-settings.client.js";
import { autoCloseSeconds } from "./duration.js";

/** Cada cuánto se revisa. Un minuto: la ventana mínima configurable es 30 s. */
export const AUTO_CLOSE_INTERVAL_MS = 60_000;

export const AUTO_CLOSE_AUDIT_ACTION = "whatsapp.conversation.auto_closed";

export interface AutoCloseRun {
  tenantsChecked: number;
  tenantsEnabled: number;
  closed: number;
}

@Injectable()
export class ConversationAutoCloseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConversationAutoCloseService.name);
  private timer: NodeJS.Timeout | null = null;
  /** Evita que dos pasadas se encimen si una tarda más de un minuto. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentSettings: AgentSettingsClient,
  ) {}

  onModuleInit(): void {
    if ((process.env.WHATSAPP_AUTO_CLOSE_JOB ?? "true").toLowerCase() === "false") {
      this.logger.log("Autocierre de conversaciones deshabilitado por entorno");
      return;
    }
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) =>
        this.logger.error(`Autocierre falló: ${(error as Error).message}`),
      );
    }, AUTO_CLOSE_INTERVAL_MS);
    // Un temporizador de fondo no debe impedir que el proceso termine.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Una pasada completa. Público para poder ejercerlo en pruebas. */
  async runOnce(now: Date = new Date()): Promise<AutoCloseRun> {
    if (this.running) return { tenantsChecked: 0, tenantsEnabled: 0, closed: 0 };
    this.running = true;
    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { status: "ACTIVE" },
        select: { id: true },
      });
      const run: AutoCloseRun = { tenantsChecked: tenants.length, tenantsEnabled: 0, closed: 0 };
      for (const tenant of tenants) {
        const settings = await this.agentSettings.get(tenant.id);
        const seconds = windowSecondsFor(settings);
        if (!seconds) continue;
        run.tenantsEnabled += 1;
        run.closed += await this.closeInactive(tenant.id, seconds, now);
      }
      return run;
    } finally {
      this.running = false;
    }
  }

  /** Cierra en lote los hilos inactivos de un tenant y deja un solo AuditLog. */
  private async closeInactive(tenantId: string, seconds: number, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - seconds * 1000);
    const { count } = await this.prisma.whatsAppConversation.updateMany({
      where: {
        tenantId,
        status: { not: "CLOSED" },
        lastMessageAt: { lt: cutoff },
      },
      data: { status: "CLOSED", handoffToHuman: false, handoffUserId: null },
    });
    if (count === 0) return 0;

    // Una entrada por lote, no por hilo: con un plazo corto un tenant grande
    // llenaría la bitácora de ruido.
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: null,
        action: AUTO_CLOSE_AUDIT_ACTION,
        targetType: "WhatsAppConversation",
        metadata: {
          closed: count,
          inactivitySeconds: seconds,
          cutoff: cutoff.toISOString(),
        },
      },
    });
    this.logger.log(`Tenant ${tenantId}: ${count} conversación(es) cerradas por inactividad`);
    return count;
  }
}

/**
 * Segundos de inactividad configurados, o 0 si este tenant no tiene autocierre
 * (apagado, sin plazo, o sin respuesta del agente). Separado de la clase para
 * poder probar la regla de selección sin levantar Nest.
 */
export function windowSecondsFor(settings: AgentTenantSettings | null): number {
  if (!settings?.auto_close_enabled) return 0;
  return autoCloseSeconds(settings.auto_close_after);
}
