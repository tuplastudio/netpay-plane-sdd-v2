/**
 * Lecturas cross-tenant para /super-admin: resumen de plataforma, empresas con
 * su gasto del mes y directorio de usuarios.
 *
 * "MTD" (month to date) = desde el primer día del mes actual 00:00 hasta ahora,
 * que es justo el rango por defecto de `UsageService.parseRange()`; se reutiliza
 * para que el panel y el estado de cuenta hablen del mismo periodo.
 */
import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { UsageService } from "../usage/usage.service.js";

export interface UsageMtd {
  costUsd: string;
  totalTokens: number;
  events: number;
}

export const EMPTY_USAGE: UsageMtd = { costUsd: "0.000000", totalTokens: 0, events: 0 };

type UsageSums = {
  _count: { _all: number };
  _sum: { inputTokens: number | null; outputTokens: number | null; costUsd: unknown };
};

function usageOf(row: UsageSums | null | undefined): UsageMtd {
  if (!row) return EMPTY_USAGE;
  const cost = row._sum.costUsd == null ? 0 : Number(row._sum.costUsd.toString());
  return {
    costUsd: cost.toFixed(6),
    totalTokens: (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0),
    events: row._count._all,
  };
}

const SAFE_USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  isSuperAdmin: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const PENDING_INVITATION_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.InvitationSelect;

@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
  ) {}

  // -------------------------------------------------------------------------
  // Uso MTD
  // -------------------------------------------------------------------------

  private mtdRange(): { gte: Date; lte: Date } {
    return this.usage.parseRange();
  }

  /** Un solo groupBy por tenant, para pegarlo a la lista de empresas. */
  async usageMtdByTenant(): Promise<{ from: Date; to: Date; byTenant: Map<string, UsageMtd> }> {
    const { gte, lte } = this.mtdRange();
    const rows = await this.prisma.agentUsageEvent.groupBy({
      by: ["tenantId"],
      where: { createdAt: { gte, lte } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    });
    return {
      from: gte,
      to: lte,
      byTenant: new Map(rows.map((r) => [r.tenantId, usageOf(r)])),
    };
  }

  async usageMtdForTenant(tenantId: string): Promise<UsageMtd> {
    const { gte, lte } = this.mtdRange();
    const agg = await this.prisma.agentUsageEvent.aggregate({
      where: { tenantId, createdAt: { gte, lte } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    });
    return usageOf(agg);
  }

  // -------------------------------------------------------------------------
  // Resumen de plataforma
  // -------------------------------------------------------------------------

  async overview() {
    const { gte, lte } = this.mtdRange();
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [
      tenantsByStatus,
      users,
      pendingInvitations,
      usage,
      newTenantsThisMonth,
      activeConversations,
      ordersMtd,
      revenueMtd,
      usageTrend,
      recentActivity,
    ] = await Promise.all([
      this.prisma.tenant.groupBy({ by: ["status"], _count: { _all: true } }),
      // Usuarios distintos con al menos una membresía (cualquier estado).
      this.prisma.user.count({ where: { memberships: { some: {} } } }),
      this.prisma.invitation.count({ where: { acceptedAt: null, expiresAt: { gt: now } } }),
      this.prisma.agentUsageEvent.aggregate({
        where: { createdAt: { gte, lte } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      }),
      // Nuevas empresas creadas este mes
      this.prisma.tenant.count({
        where: { createdAt: { gte: firstDayOfMonth, lte: now } },
      }),
      // Conversaciones activas (no cerradas) cross-tenant
      this.prisma.whatsAppConversation.count({
        where: { status: { in: ["OPEN", "HANDED_OFF"] } },
      }),
      // Pedidos del mes
      this.prisma.order.count({
        where: { createdAt: { gte, lte } },
      }),
      // Suma de ventas del mes (solo pedidos pagados o entregados)
      this.prisma.order.aggregate({
        where: { createdAt: { gte, lte }, status: { in: ["PAID", "FULFILLED"] } },
        _sum: { total: true },
      }),
      // Tendencia de uso últimos 7 días
      this.prisma.agentUsageEvent.groupBy({
        by: ["createdAt"],
        where: { createdAt: { gte: sevenDaysAgo, lte: now } },
      }).then(async () => {
        // Construir serie día-por-día en JS (es barato, son 7 puntos)
        const events = await this.prisma.agentUsageEvent.findMany({
          where: { createdAt: { gte: sevenDaysAgo, lte: now } },
          select: { createdAt: true, inputTokens: true, outputTokens: true, costUsd: true },
        });
        const byDay = new Map<string, { tokens: number; cost: number; events: number }>();
        for (let i = 6; i >= 0; i--) {
          const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          byDay.set(key, { tokens: 0, cost: 0, events: 0 });
        }
        for (const e of events) {
          const d = e.createdAt;
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const cur = byDay.get(key);
          if (cur) {
            cur.tokens += (e.inputTokens ?? 0) + (e.outputTokens ?? 0);
            cur.cost += Number(e.costUsd);
            cur.events += 1;
          }
        }
        return Array.from(byDay.entries()).map(([day, v]) => ({
          day,
          events: v.events,
          tokens: v.tokens,
          costUsd: v.cost.toFixed(6),
        }));
      }),
      // Auditoría reciente cross-tenant (últimos 8 eventos)
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          actor: { select: { id: true, email: true, fullName: true } },
          tenant: { select: { id: true, name: true, slug: true } },
        },
      }),
    ]);

    const countOf = (status: "ACTIVE" | "DISABLED") =>
      tenantsByStatus.find((r) => r.status === status)?._count._all ?? 0;
    const active = countOf("ACTIVE");
    const disabled = countOf("DISABLED");

    return {
      tenants: { total: active + disabled, active, disabled },
      users,
      pendingInvitations,
      usageMtd: usageOf(usage),
      // Métricas adicionales para el dashboard
      newTenantsThisMonth,
      activeConversations,
      ordersMtd,
      revenueMtd: (revenueMtd?._sum.total ?? 0).toString(),
      usageTrend,
      recentActivity: recentActivity.map((r) => ({
        id: r.id,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        metadata: r.metadata,
        createdAt: r.createdAt,
        actor: r.actor,
        tenant: r.tenant,
      })),
      from: gte,
      to: lte,
    };
  }

  // -------------------------------------------------------------------------
  // Empresas
  // -------------------------------------------------------------------------

  async listTenants() {
    const [tenants, usage] = await Promise.all([
      this.prisma.tenant.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { memberships: true, products: true, orders: true } },
        },
      }),
      this.usageMtdByTenant(),
    ]);
    return tenants.map((t) => ({ ...t, usageMtd: usage.byTenant.get(t.id) ?? EMPTY_USAGE }));
  }

  async getTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        memberships: {
          orderBy: { createdAt: "asc" },
          include: { user: { select: SAFE_USER_SELECT } },
        },
        _count: { select: { memberships: true, products: true, orders: true } },
      },
    });
    if (!tenant) throw this.tenantNotFound();

    const [invitations, usageMtd] = await Promise.all([
      this.prisma.invitation.findMany({
        where: { tenantId: id, acceptedAt: null, expiresAt: { gt: new Date() } },
        select: PENDING_INVITATION_SELECT,
        orderBy: { createdAt: "asc" },
      }),
      this.usageMtdForTenant(id),
    ]);

    return { ...tenant, invitations, usageMtd };
  }

  async requireTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw this.tenantNotFound();
    return tenant;
  }

  async usageForTenant(id: string, from?: string, to?: string) {
    await this.requireTenant(id);
    return this.usage.summaryForTenant(id, from, to);
  }

  async renameTenant(id: string, actorId: string | undefined, name: string) {
    const current = await this.requireTenant(id);
    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: { name, version: { increment: 1 } },
    });
    await this.prisma.auditLog.create({
      data: {
        tenantId: id,
        actorId,
        action: "tenant.renamed",
        targetType: "Tenant",
        targetId: id,
        metadata: { from: current.name, to: name, via: "super-admin" },
      },
    });
    return tenant;
  }

  // -------------------------------------------------------------------------
  // Usuarios (directorio cross-tenant)
  // -------------------------------------------------------------------------

  async listUsers(q?: string) {
    const term = q?.trim();
    const where: Prisma.UserWhereInput | undefined = term
      ? {
          OR: [
            { email: { contains: term, mode: "insensitive" } },
            { fullName: { contains: term, mode: "insensitive" } },
          ],
        }
      : undefined;
    return this.prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      // Selección explícita: nunca passwordHash, totpSecret ni recoveryCodesHash.
      select: {
        ...SAFE_USER_SELECT,
        totpEnabled: true,
        memberships: {
          select: {
            id: true,
            role: true,
            status: true,
            tenant: { select: { id: true, name: true, slug: true, status: true } },
          },
        },
      },
    });
  }

  private tenantNotFound(): NotFoundException {
    return new NotFoundException({ code: "NOT_FOUND", message: "Tenant no encontrado" });
  }
}
