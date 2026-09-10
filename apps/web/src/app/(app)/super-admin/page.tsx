"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Coins, Cpu, MailOpen, Plus, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { StatTile } from "@/components/app/stat-tile";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { Money } from "@/components/app/money";
import { formatDate } from "@/components/app/date-time";
import { CreateTenantSheet } from "./create-tenant-sheet";
import {
  SA_OVERVIEW_KEY,
  SA_ROOT_KEY,
  SA_TENANTS_KEY,
  type Overview,
  type TenantRow,
  currentMonthLabel,
  formatInt,
} from "./_shared";

const TOP_N = 5;

const topColumns: Array<DataTableColumn<TenantRow>> = [
  { key: "name", header: "Empresa", cell: (t) => <span className="font-medium">{t.name}</span> },
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

  const o = overview.data;
  const tile = {
    isLoading: overview.isLoading,
    isError: overview.isError,
    onRetry: () => void overview.refetch(),
  };
  const period = o ? `${formatDate(o.from)} – ${formatDate(o.to)}` : currentMonthLabel();

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
        <Section title="Resumen" description={`Cifras del mes en curso · ${period}`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <StatTile
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
            <StatTile
              {...tile}
              label="Usuarios"
              icon={<Users className="h-4 w-4" />}
              value={formatInt(o?.users)}
              hint={o === undefined ? undefined : "Cuentas en toda la plataforma"}
            />
            <StatTile
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
            <StatTile
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
            <StatTile
              {...tile}
              label="Tokens del mes"
              icon={<Cpu className="h-4 w-4" />}
              value={formatInt(o?.usageMtd.totalTokens)}
              hint={o === undefined ? undefined : "Entrada + salida"}
            />
          </div>
        </Section>

        <Section
          title="Empresas con más gasto este mes"
          description={`Las ${TOP_N} empresas con mayor costo estimado del agente.`}
          padded={false}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href="/super-admin/tenants">Ver todas las empresas</Link>
            </Button>
          }
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
      </div>

      <CreateTenantSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => queryClient.invalidateQueries({ queryKey: SA_ROOT_KEY })}
      />
    </div>
  );
}
