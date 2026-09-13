"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  Building2,
  CircleDollarSign,
  Coins,
  Cpu,
  MailOpen,
  MessageSquare,
  Package,
  Plus,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { StatTile } from "@/components/app/stat-tile";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { Money } from "@/components/app/money";
import { DateTime } from "@/components/app/date-time";
import { CreateTenantSheet } from "./create-tenant-sheet";
import { UsageTrendChart } from "./_components/usage-trend-chart";
import { RecentActivityFeed, type ActivityRow } from "./_components/recent-activity-feed";
import {
  SA_OVERVIEW_KEY,
  SA_ROOT_KEY,
  SA_TENANTS_KEY,
  type Overview,
  type TenantRow,
  formatInt,
} from "./_shared";

const TOP_N = 5;

const topColumns: Array<DataTableColumn<TenantRow>> = [
  {
    key: "name",
    header: "Empresa",
    cell: (t) => (
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ background: t.primaryColor }}
        />
        <span className="font-medium">{t.name}</span>
      </div>
    ),
  },
  { key: "slug", header: "Slug", className: "font-mono text-xs", cell: (t) => t.slug },
  {
    key: "status",
    header: "Estado",
    width: "8rem",
    cell: (t) => <StatusBadge status={t.status} domain="tenant" size="sm" />,
  },
  {
    key: "tokens",
    header: "Tokens",
    numeric: true,
    width: "8rem",
    cell: (t) => formatInt(t.usageMtd?.totalTokens),
  },
  {
    key: "cost",
    header: "Gasto mes",
    numeric: true,
    width: "9rem",
    cell: (t) => <Money value={t.usageMtd?.costUsd} currency="USD" />,
  },
];

export default function SuperAdminOverviewPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const overview = useQuery({
    queryKey: SA_OVERVIEW_KEY,
    queryFn: async () => {
      const res = await api.get<{ data: Overview }>("/super-admin/overview");
      return res.data.data;
    },
  });

  const tenants = useQuery({
    queryKey: SA_TENANTS_KEY,
    queryFn: async () => {
      const res = await api.get<{ data: TenantRow[] }>("/super-admin/tenants");
      return res.data.data;
    },
  });

  const top = useMemo(() => {
    if (!tenants.data) return undefined;
    return [...tenants.data]
      .sort((a, b) => Number(b.usageMtd?.costUsd ?? 0) - Number(a.usageMtd?.costUsd ?? 0))
      .slice(0, TOP_N);
  }, [tenants.data]);

  const activityRows = useMemo<ActivityRow[]>(() => {
    if (!overview.data) return [];
    return overview.data.recentActivity.map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.targetType,
      createdAt: row.createdAt,
      actor: row.actor,
      tenant: row.tenant,
    }));
  }, [overview.data]);

  const o = overview.data;
  const tile = {
    isLoading: overview.isLoading,
    isError: overview.isError,
    onRetry: () => void overview.refetch(),
  };

  return (
    <div>
      <PageHeader
        title="Plataforma"
        description="Empresas, usuarios y gasto del agente en toda la plataforma."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Crear empresa
          </Button>
        }
      />

      <div className="space-y-6">
        {/* Fila 1: KPIs principales. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <StatTile size="compact"
            {...tile}
            label="Empresas activas"
            tone="success"
            icon={<Building2 className="h-4 w-4" />}
            value={formatInt(o?.tenants.active)}
            hint={
              o === undefined
                ? undefined
                : o.tenants.disabled === 0
                  ? "Ninguna suspendida"
                  : `${formatInt(o.tenants.disabled)} ${o.tenants.disabled === 1 ? "suspendida" : "suspendidas"}`
            }
          />
          <StatTile size="compact"
            {...tile}
            label="Usuarios"
            icon={<Users className="h-4 w-4" />}
            value={formatInt(o?.users)}
            hint={o === undefined ? undefined : "Cuentas en toda la plataforma"}
          />
          <StatTile size="compact"
            {...tile}
            label="Invitaciones pendientes"
            tone={o && o.pendingInvitations > 0 ? "warning" : "neutral"}
            icon={<MailOpen className="h-4 w-4" />}
            value={formatInt(o?.pendingInvitations)}
            hint={
              o === undefined
                ? undefined
                : o.pendingInvitations === 0
                  ? "Nadie espera aceptar"
                  : "Sin aceptar todavía"
            }
          />
          <StatTile size="compact"
            {...tile}
            label="Gasto del mes"
            tone="info"
            icon={<Coins className="h-4 w-4" />}
            value={<Money value={o?.usageMtd.costUsd} currency="USD" />}
            hint={
              o === undefined
                ? undefined
                : `${formatInt(o.usageMtd.events)} ${o.usageMtd.events === 1 ? "turno" : "turnos"} del agente · estimado`
            }
          />
          <StatTile size="compact"
            {...tile}
            label="Tokens del mes"
            icon={<Cpu className="h-4 w-4" />}
            value={formatInt(o?.usageMtd.totalTokens)}
            hint={o === undefined ? undefined : "Entrada + salida"}
          />
        </div>

        {/* Fila 2: KPIs comerciales (lo que un operador quiere ver al entrar). */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile size="compact"
            {...tile}
            label="Nuevas empresas (mes)"
            tone="success"
            icon={<Sparkles className="h-4 w-4" />}
            value={formatInt(o?.newTenantsThisMonth)}
            hint="Altas en lo que va del mes"
          />
          <StatTile size="compact"
            {...tile}
            label="Conversaciones activas"
            tone="info"
            icon={<MessageSquare className="h-4 w-4" />}
            value={formatInt(o?.activeConversations)}
            hint="Hilos abiertos o en mano humana"
          />
          <StatTile size="compact"
            {...tile}
            label="Pedidos del mes"
            icon={<Package className="h-4 w-4" />}
            value={formatInt(o?.ordersMtd)}
            hint="Cruzando todas las empresas"
          />
          <StatTile size="compact"
            {...tile}
            label="Ventas cobradas (mes)"
            tone="success"
            icon={<CircleDollarSign className="h-4 w-4" />}
            value={<Money value={o?.revenueMtd} />}
            hint="Solo pedidos PAID/DELIVERED"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Tendencia de uso (7 días). */}
          <Section
            title="Gasto del agente · últimos 7 días"
            description="Costo diario del agente en USD. Pico más alto destacado."
            headerIcon={<TrendingUp className="h-4 w-4" />}
            density="compact"
            className="lg:col-span-2"
          >
            <UsageTrendChart
              data={o?.usageTrend ?? []}
              isLoading={overview.isLoading}
              isError={overview.isError}
              onRetry={() => void overview.refetch()}
            />
          </Section>

          {/* Acciones rápidas. */}
          <Section
            title="Acciones rápidas"
            description="Lo más común al entrar al portal."
            headerIcon={<ArrowUpRight className="h-4 w-4" />}
            density="compact"
          >
            <ul className="space-y-1.5 text-sm">
              <li>
                <Link
                  href="/super-admin/tenants"
                  className="group flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
                >
                  <span className="flex items-center gap-2">
                    <Building2 aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                    Ver todas las empresas
                  </span>
                  <span className="text-xs text-muted-foreground group-hover:text-foreground">
                    {formatInt(tenants.data?.length)} →
                  </span>
                </Link>
              </li>
              <li>
                <Link
                  href="/super-admin/users"
                  className="group flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
                >
                  <span className="flex items-center gap-2">
                    <Users aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                    Directorio de usuarios
                  </span>
                  <span className="text-xs text-muted-foreground group-hover:text-foreground">
                    {formatInt(o?.users)} →
                  </span>
                </Link>
              </li>
              <li>
                <Link
                  href="/super-admin/usage"
                  className="group flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
                >
                  <span className="flex items-center gap-2">
                    <Coins aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                    Estado de cuenta del mes
                  </span>
                  <span className="text-xs text-muted-foreground group-hover:text-foreground">
                    <Money value={o?.usageMtd.costUsd} currency="USD" /> →
                  </span>
                </Link>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="flex w-full items-center justify-between rounded-md border border-dashed border-border bg-background px-3 py-2 text-left text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
                >
                  <span className="flex items-center gap-2">
                    <Plus aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                    Crear una empresa nueva
                  </span>
                </button>
              </li>
            </ul>
          </Section>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Empresas con más gasto este mes. */}
          <Section
            title="Empresas con más gasto este mes"
            description={`Las ${TOP_N} con mayor costo estimado del agente.`}
            headerIcon={<Building2 className="h-4 w-4" />}
            density="compact"
            padded={false}
            actions={
              <Button asChild variant="outline" size="sm">
                <Link href="/super-admin/tenants">Ver todas las empresas</Link>
              </Button>
            }
            className="lg:col-span-2"
          >
            <DataTable
              columns={topColumns}
              rows={top}
              isLoading={tenants.isLoading}
              isError={tenants.isError}
              error={tenants.error}
              onRetry={() => void tenants.refetch()}
              getRowHref={(t) => `/super-admin/${t.id}`}
              getRowActionLabel={(t) => `Ver ${t.name}`}
              skeletonRows={TOP_N}
              caption="Empresas ordenadas por gasto del mes"
              empty={{
                icon: <Building2 className="h-6 w-6" />,
                title: "Sin empresas",
                description: "Crea la primera empresa para empezar a operar su catálogo y su bot.",
                action: (
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Crear empresa
                  </Button>
                ),
              }}
            />
          </Section>

          {/* Auditoría reciente cross-tenant. */}
          <Section
            title="Actividad reciente"
            description="Últimos movimientos en cualquier empresa."
            headerIcon={<Activity className="h-4 w-4" />}
            density="compact"
          >
            <RecentActivityFeed rows={activityRows} isLoading={overview.isLoading} />
          </Section>
        </div>

        {o && o.newTenantsThisMonth > 0 ? (
          <p className="text-center text-xs text-muted-foreground">
            Datos actualizados al <DateTime value={o.to} /> · <DateTime value={o.from} withTime={false} /> al cierre del día.
          </p>
        ) : null}
      </div>

      <CreateTenantSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => queryClient.invalidateQueries({ queryKey: SA_ROOT_KEY })}
      />
    </div>
  );
}
