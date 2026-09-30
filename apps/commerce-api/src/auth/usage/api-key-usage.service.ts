/**
 * Bitácora de uso de API keys (T-IAM-05b).
 *
 *  - `record()`: encola una fila; se escribe en lote (ver ApiKeyUsageBuffer).
 *  - `lastUsedAt` de la key se actualiza con throttle (una vez por minuto por
 *    key), no en cada petición.
 *  - Consulta: listado paginado por cursor y resumen agregado por día, ruta y
 *    status.
 *  - Retención: `purgeOlderThan(days)`; el servicio la ejecuta solo cada 6 h
 *    (`API_KEY_USAGE_RETENTION_DAYS`, 90 por defecto) y además la expone
 *    `POST /super-admin/api-keys/usage/purge` para lanzarla a mano.
 */

import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import {
  ApiKeyUsageBuffer,
  ApiKeyUsageEntry,
  LastUsedThrottle,
} from "./api-key-usage.buffer.js";

export const DEFAULT_USAGE_RETENTION_DAYS = 90;
const RETENTION_SWEEP_MS = 6 * 60 * 60 * 1000;
const LAST_USED_WINDOW_MS = 60_000;
/** Zona del portal: los días del resumen se cortan con este reloj. */
const SUMMARY_TZ = "America/Mexico_City";
export const USAGE_PAGE_DEFAULT = 50;
export const USAGE_PAGE_MAX = 200;
export const SUMMARY_TOP_PATHS = 20;

export interface UsageListFilters {
  from?: Date;
  to?: Date;
  /** Subcadena de la ruta normalizada. */
  path?: string;
  /** Código exacto (`404`) o clase (`4xx`). */
  status?: string;
  cursor?: string;
  limit?: number;
}

export interface UsageDayBucket {
  /** `YYYY-MM-DD` en la zona del portal. */
  day: string;
  total: number;
  errors: number;
}

export interface UsageSummary {
  days: number;
  from: string;
  to: string;
  totals: { requests: number; errors: number; requests7d: number; avgDurationMs: number | null };
  lastUsedAt: string | null;
  lastIp: string | null;
  distinctIps: number;
  byDay: UsageDayBucket[];
  byPath: Array<{ method: string; path: string; count: number; errors: number }>;
  byStatus: Array<{ statusCode: number; count: number }>;
}

/** Cursor opaco: `occurredAt|id` en base64url. */
export function encodeUsageCursor(row: { occurredAt: Date; id: string }): string {
  return Buffer.from(`${row.occurredAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

export function decodeUsageCursor(cursor: string): { occurredAt: Date; id: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const sep = decoded.indexOf("|");
  if (sep <= 0) return null;
  const occurredAt = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (Number.isNaN(occurredAt.getTime()) || id.length === 0) return null;
  return { occurredAt, id };
}

/** `404` → `{gte:404, lt:405}`; `4xx` → `{gte:400, lt:500}`; otra cosa → 400. */
export function statusFilterToRange(status: string): { gte: number; lt: number } {
  const exact = /^([1-5]\d\d)$/.exec(status);
  if (exact) {
    const code = Number(exact[1]);
    return { gte: code, lt: code + 1 };
  }
  const klass = /^([1-5])xx$/i.exec(status);
  if (klass) {
    const base = Number(klass[1]) * 100;
    return { gte: base, lt: base + 100 };
  }
  throw new BadRequestException({
    code: "VALIDATION_FAILED",
    message: "status debe ser un código (404) o una clase (4xx)",
  });
}

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: SUMMARY_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha `YYYY-MM-DD` de un instante, en la zona del portal. */
export function dayKey(at: Date): string {
  return dayFormat.format(at);
}

/**
 * Serie diaria completa para los últimos `days` días terminando en `now`:
 * los días sin tráfico salen con cero para que la gráfica no tenga huecos.
 */
export function fillDaySeries(
  rows: ReadonlyArray<UsageDayBucket>,
  days: number,
  now: Date,
): UsageDayBucket[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: UsageDayBucket[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = dayKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000));
    const hit = byDay.get(key);
    out.push({ day: key, total: hit?.total ?? 0, errors: hit?.errors ?? 0 });
  }
  return out;
}

@Injectable()
export class ApiKeyUsageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApiKeyUsageService.name);
  private readonly buffer: ApiKeyUsageBuffer;
  private readonly throttle = new LastUsedThrottle(LAST_USED_WINDOW_MS);
  private retentionTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {
    this.buffer = new ApiKeyUsageBuffer((entries) => this.write(entries), {
      onError: (error, dropped) =>
        this.logger.warn(`No se pudo escribir la bitácora de uso (${dropped} filas descartadas): ${String(error)}`),
    });
  }

  onModuleInit(): void {
    // Retención automática: un barrido al arrancar y luego cada 6 h. El
    // temporizador no mantiene vivo el proceso.
    const days = this.retentionDays();
    if (days <= 0) return;
    const sweep = () => {
      void this.purgeOlderThan(days).catch((error: unknown) =>
        this.logger.warn(`Purga de bitácora de uso falló: ${String(error)}`),
      );
    };
    this.retentionTimer = setInterval(sweep, RETENTION_SWEEP_MS);
    this.retentionTimer.unref?.();
    // Diferido para no competir con el arranque (conexión, RLS check).
    setTimeout(sweep, 30_000).unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    await this.buffer.stop();
  }

  /** Encola una fila. Nunca lanza ni espera a la base. */
  record(entry: ApiKeyUsageEntry): void {
    this.buffer.push(entry);
    if (this.throttle.shouldTouch(entry.apiKeyId, entry.occurredAt.getTime())) {
      void this.prisma.apiKey
        .updateMany({ where: { id: entry.apiKeyId }, data: { lastUsedAt: entry.occurredAt } })
        .catch((error: unknown) => this.logger.warn(`lastUsedAt no actualizado: ${String(error)}`));
    }
  }

  /** Fuerza la escritura de lo pendiente (tests y shutdown). */
  flush(): Promise<void> {
    return this.buffer.flush();
  }

  private async write(entries: ApiKeyUsageEntry[]): Promise<void> {
    await this.prisma.apiKeyUsage.createMany({ data: entries });
  }

  /** Borra filas anteriores a `days` días. Devuelve cuántas se fueron. */
  async purgeOlderThan(days: number = this.retentionDays()): Promise<number> {
    const safeDays = Math.max(1, Math.floor(days));
    const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.apiKeyUsage.deleteMany({ where: { occurredAt: { lt: cutoff } } });
    if (result.count > 0) {
      this.logger.log(`Bitácora de uso: purgadas ${result.count} filas anteriores a ${cutoff.toISOString()}`);
    }
    return result.count;
  }

  retentionDays(): number {
    const raw = Number.parseInt(process.env.API_KEY_USAGE_RETENTION_DAYS ?? "", 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_USAGE_RETENTION_DAYS;
  }

  // ---- Consulta ----

  async list(apiKeyId: string, filters: UsageListFilters) {
    const limit = Math.min(Math.max(filters.limit ?? USAGE_PAGE_DEFAULT, 1), USAGE_PAGE_MAX);
    const where: Prisma.ApiKeyUsageWhereInput = { apiKeyId };
    const and: Prisma.ApiKeyUsageWhereInput[] = [];
    if (filters.from || filters.to) {
      where.occurredAt = {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      };
    }
    if (filters.path) where.path = { contains: filters.path };
    if (filters.status) where.statusCode = statusFilterToRange(filters.status);
    if (filters.cursor) {
      const cursor = decodeUsageCursor(filters.cursor);
      if (!cursor) {
        throw new BadRequestException({ code: "VALIDATION_FAILED", message: "cursor inválido" });
      }
      and.push({
        OR: [
          { occurredAt: { lt: cursor.occurredAt } },
          { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
        ],
      });
    }
    if (and.length > 0) where.AND = and;

    const rows = await this.prisma.apiKeyUsage.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    return {
      items,
      pageInfo: {
        nextCursor: hasMore && last ? encodeUsageCursor(last) : null,
        size: items.length,
      },
    };
  }

  async summary(apiKeyId: string, days: number, now = new Date()): Promise<UsageSummary> {
    const safeDays = Math.min(Math.max(Math.floor(days), 1), 365);
    const from = new Date(now.getTime() - safeDays * 24 * 60 * 60 * 1000);
    const from7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const window: Prisma.ApiKeyUsageWhereInput = { apiKeyId, occurredAt: { gte: from, lte: now } };

    const [requests, errors, requests7d, avg, last, byStatus, byPath, byPathErrors, byDayRaw, ipsRaw] =
      await Promise.all([
        this.prisma.apiKeyUsage.count({ where: window }),
        this.prisma.apiKeyUsage.count({ where: { ...window, statusCode: { gte: 400 } } }),
        this.prisma.apiKeyUsage.count({ where: { apiKeyId, occurredAt: { gte: from7d, lte: now } } }),
        this.prisma.apiKeyUsage.aggregate({ where: window, _avg: { durationMs: true } }),
        this.prisma.apiKeyUsage.findFirst({
          where: { apiKeyId },
          orderBy: { occurredAt: "desc" },
          select: { occurredAt: true, ip: true },
        }),
        this.prisma.apiKeyUsage.groupBy({
          by: ["statusCode"],
          where: window,
          _count: { _all: true },
          orderBy: { statusCode: "asc" },
        }),
        this.prisma.apiKeyUsage.groupBy({
          by: ["method", "path"],
          where: window,
          _count: { _all: true },
          orderBy: { _count: { path: "desc" } },
          take: SUMMARY_TOP_PATHS,
        }),
        this.prisma.apiKeyUsage.groupBy({
          by: ["method", "path"],
          where: { ...window, statusCode: { gte: 400 } },
          _count: { _all: true },
        }),
        this.prisma.$queryRaw<Array<{ day: string; total: bigint | number; errors: bigint | number }>>`
          SELECT to_char(("occurredAt" AT TIME ZONE ${SUMMARY_TZ}), 'YYYY-MM-DD') AS day,
                 COUNT(*)::bigint AS total,
                 COUNT(*) FILTER (WHERE "statusCode" >= 400)::bigint AS errors
            FROM "ApiKeyUsage"
           WHERE "apiKeyId" = ${apiKeyId}::uuid
             AND "occurredAt" >= ${from}
             AND "occurredAt" <= ${now}
           GROUP BY 1
        `,
        this.prisma.$queryRaw<Array<{ ips: bigint | number }>>`
          SELECT COUNT(DISTINCT "ip")::bigint AS ips
            FROM "ApiKeyUsage"
           WHERE "apiKeyId" = ${apiKeyId}::uuid
             AND "occurredAt" >= ${from}
             AND "occurredAt" <= ${now}
             AND "ip" IS NOT NULL
        `,
      ]);

    const errorsByPath = new Map(
      byPathErrors.map((r) => [`${r.method} ${r.path}`, r._count._all]),
    );

    return {
      days: safeDays,
      from: from.toISOString(),
      to: now.toISOString(),
      totals: {
        requests,
        errors,
        requests7d,
        avgDurationMs: avg._avg.durationMs === null ? null : Math.round(avg._avg.durationMs),
      },
      lastUsedAt: last?.occurredAt.toISOString() ?? null,
      lastIp: last?.ip ?? null,
      distinctIps: Number(ipsRaw[0]?.ips ?? 0),
      byDay: fillDaySeries(
        byDayRaw.map((r) => ({ day: r.day, total: Number(r.total), errors: Number(r.errors) })),
        safeDays,
        now,
      ),
      byPath: byPath.map((r) => ({
        method: r.method,
        path: r.path,
        count: r._count._all,
        errors: errorsByPath.get(`${r.method} ${r.path}`) ?? 0,
      })),
      byStatus: byStatus.map((r) => ({ statusCode: r.statusCode, count: r._count._all })),
    };
  }
}
