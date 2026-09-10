import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";

export interface UsageSummaryRow {
  model: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
}

/** Un renglón del desglose día × modelo (`detailForTenant`). */
export interface UsageDetailRow {
  /** "YYYY-MM-DD" en la zona horaria del tenant. */
  day: string;
  model: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
}

/** Fila cruda del `$queryRaw` de `detailForTenant`, antes de normalizar. */
export interface UsageDetailRawRow {
  day: string;
  model: string;
  events: number | bigint;
  inputTokens: number | bigint | null;
  outputTokens: number | bigint | null;
  costUsd: Prisma.Decimal | string | number | null;
}

/**
 * Normaliza lo que devuelve Postgres (COUNT → bigint, SUM de Decimal → Decimal)
 * al mismo contrato que `UsageSummaryRow`: enteros como `number` y el costo
 * como string decimal de 6 posiciones. Pura, para probarla sin base.
 */
export function mapUsageDetailRows(rows: UsageDetailRawRow[]): UsageDetailRow[] {
  return rows.map((r) => ({
    day: r.day,
    model: r.model,
    events: Number(r.events),
    inputTokens: Number(r.inputTokens ?? 0),
    outputTokens: Number(r.outputTokens ?? 0),
    costUsd: Number(r.costUsd ?? 0).toFixed(6),
  }));
}

/** Zona por defecto si el tenant no trae una válida (misma que el portal). */
const DEFAULT_TIME_ZONE = "America/Mexico_City";

/**
 * Sólo nombres IANA ("America/Mexico_City", "UTC"). El valor viaja como
 * parámetro ligado, no interpolado, pero de todos modos no mandamos basura a
 * `AT TIME ZONE`: con una zona inválida Postgres tira error y la pantalla se
 * cae por un dato de configuración.
 */
function safeTimeZone(value: string | null | undefined): string {
  if (!value || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    tenantId: string,
    input: { model: string; inputTokens: number; outputTokens: number; costUsd: string },
  ) {
    return this.prisma.agentUsageEvent.create({
      data: {
        tenantId,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costUsd: input.costUsd,
      },
    });
  }

  parseRange(from?: string, to?: string): { gte: Date; lte: Date } {
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1); // inicio del mes actual
    const gte = from ? new Date(from) : defaultFrom;
    const lte = to ? new Date(to) : now;
    if (Number.isNaN(gte.getTime()) || Number.isNaN(lte.getTime())) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "from/to inválidos" });
    }
    return { gte, lte };
  }

  /** Resumen por modelo de un solo tenant, para el "estado de cuenta" propio. */
  async summaryForTenant(tenantId: string, from?: string, to?: string) {
    const { gte, lte } = this.parseRange(from, to);
    const rows = await this.prisma.agentUsageEvent.groupBy({
      by: ["model"],
      where: { tenantId, createdAt: { gte, lte } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    });
    const byModel: UsageSummaryRow[] = rows.map((r) => ({
      model: r.model,
      events: r._count._all,
      inputTokens: r._sum.inputTokens ?? 0,
      outputTokens: r._sum.outputTokens ?? 0,
      costUsd: (r._sum.costUsd ?? 0).toString(),
    }));
    const totalCost = byModel.reduce((acc, r) => acc + Number(r.costUsd), 0);
    const totalTokens = byModel.reduce((acc, r) => acc + r.inputTokens + r.outputTokens, 0);
    return { from: gte, to: lte, byModel, totalCostUsd: totalCost.toFixed(6), totalTokens };
  }

  /** Estado de cuenta cross-tenant para super-admin, con filtro opcional por tenant. */
  async summaryAllTenants(input: { tenantId?: string; from?: string; to?: string }) {
    const { gte, lte } = this.parseRange(input.from, input.to);
    const rows = await this.prisma.agentUsageEvent.groupBy({
      by: ["tenantId"],
      where: {
        createdAt: { gte, lte },
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      orderBy: { _sum: { costUsd: "desc" } },
    });
    const tenantIds = rows.map((r) => r.tenantId);
    const tenants = tenantIds.length
      ? await this.prisma.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, name: true, slug: true },
        })
      : [];
    const tenantById = new Map(tenants.map((t) => [t.id, t]));

    const byTenant = rows.map((r) => ({
      tenantId: r.tenantId,
      tenantName: tenantById.get(r.tenantId)?.name ?? "?",
      tenantSlug: tenantById.get(r.tenantId)?.slug ?? "?",
      events: r._count._all,
      inputTokens: r._sum.inputTokens ?? 0,
      outputTokens: r._sum.outputTokens ?? 0,
      costUsd: (r._sum.costUsd ?? 0).toString(),
    }));
    const totalCost = byTenant.reduce((acc, r) => acc + Number(r.costUsd), 0);
    const totalTokens = byTenant.reduce((acc, r) => acc + r.inputTokens + r.outputTokens, 0);
    return { from: gte, to: lte, byTenant, totalCostUsd: totalCost.toFixed(6), totalTokens };
  }

  /**
   * Desglose día × modelo de un tenant, para el drill-down de super-admin.
   * Agrega en la base (GROUP BY sobre la fecha local del tenant), no en JS.
   * Lanza 404 si la empresa no existe: el super-admin pide por id y un id
   * inventado no debe verse igual que "sin consumo".
   */
  async detailForTenant(tenantId: string, from?: string, to?: string) {
    const { gte, lte } = this.parseRange(from, to);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, timezone: true },
    });
    if (!tenant) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Empresa no encontrada" });
    }
    const timeZone = safeTimeZone(tenant.timezone);
    const raw = await this.prisma.$queryRaw<UsageDetailRawRow[]>(Prisma.sql`
      SELECT
        to_char(("createdAt" AT TIME ZONE ${timeZone}::text)::date, 'YYYY-MM-DD') AS "day",
        "model",
        COUNT(*)::int AS "events",
        COALESCE(SUM("inputTokens"), 0)::int AS "inputTokens",
        COALESCE(SUM("outputTokens"), 0)::int AS "outputTokens",
        COALESCE(SUM("costUsd"), 0) AS "costUsd"
      FROM "AgentUsageEvent"
      WHERE "tenantId" = ${tenantId}::uuid
        AND "createdAt" >= ${gte}
        AND "createdAt" <= ${lte}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);
    const byDayAndModel = mapUsageDetailRows(raw);
    const totalCost = byDayAndModel.reduce((acc, r) => acc + Number(r.costUsd), 0);
    const totalTokens = byDayAndModel.reduce((acc, r) => acc + r.inputTokens + r.outputTokens, 0);
    return {
      from: gte,
      to: lte,
      timeZone,
      byDayAndModel,
      totalCostUsd: totalCost.toFixed(6),
      totalTokens,
    };
  }
}
