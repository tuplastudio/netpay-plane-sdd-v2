/**
 * Scheduler de fuentes de datos: cada minuto dispara las fuentes cuya
 * `nextRunAt` venció.
 *
 * Vive aquí y no en commerce-worker por la misma razón que
 * `ConversationAutoCloseService` y `QuoteReminderService`: el worker es un
 * consumidor de RabbitMQ sin scheduler y `@nestjs/schedule` no está en el
 * monorepo. Mismo patrón: `setInterval` de un minuto con `unref()`.
 *
 * Concurrencia: el lock es una columna (`DataSource.lockedAt`) que se toma
 * con un `updateMany` condicional (ver DataSourceService.claimLock), así que
 * varias réplicas del API pueden correr el tick sin duplicar runs. Un lock
 * más viejo que LOCK_TTL_MS se considera huérfano (proceso caído a media
 * sincronización) y se vuelve a tomar.
 *
 * Se apaga con `DATA_SOURCE_SCHEDULER_JOB=false` (p.ej. en réplicas que no
 * deben ejecutar jobs o en pruebas locales).
 */

import { ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DataSourceService } from "./data-source.service.js";

export const SCHEDULER_INTERVAL_MS = 60_000;

/** Fuentes por tick: el resto cae en el siguiente minuto. */
export const MAX_SOURCES_PER_TICK = 20;

export interface SchedulerTick {
  due: number;
  started: number;
  skipped: number;
}

@Injectable()
export class DataSourceSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataSourceSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  /** Evita encimar dos ticks en el mismo proceso. */
  private running = false;

  constructor(private readonly dataSources: DataSourceService) {}

  onModuleInit(): void {
    if ((process.env.DATA_SOURCE_SCHEDULER_JOB ?? "true").toLowerCase() === "false") {
      this.logger.log("Scheduler de fuentes de datos deshabilitado por entorno");
      return;
    }
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) =>
        this.logger.error(`Scheduler de fuentes falló: ${(error as Error).message}`),
      );
    }, SCHEDULER_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Un tick. Público para las pruebas. */
  async runOnce(now: Date = new Date()): Promise<SchedulerTick> {
    if (this.running) return { due: 0, started: 0, skipped: 0 };
    this.running = true;
    try {
      const due = await this.dataSources.findDue(now, MAX_SOURCES_PER_TICK);
      const tick: SchedulerTick = { due: due.length, started: 0, skipped: 0 };
      for (const source of due) {
        try {
          await this.dataSources.triggerSync(source.tenantId, source.id, "SCHEDULE", null);
          tick.started += 1;
        } catch (err) {
          // Otra réplica ganó el lock entre el findDue y el claim: no es error.
          if (err instanceof ConflictException) {
            tick.skipped += 1;
            continue;
          }
          this.logger.error(`No se pudo lanzar la fuente ${source.id}: ${(err as Error).message}`);
          tick.skipped += 1;
        }
      }
      if (tick.started > 0) this.logger.log(`Scheduler: ${tick.started} fuente(s) lanzadas`);
      return tick;
    } finally {
      this.running = false;
    }
  }
}
