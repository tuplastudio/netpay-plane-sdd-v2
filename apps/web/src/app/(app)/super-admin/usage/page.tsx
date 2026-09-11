"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Coins, Cpu, Gauge, MessagesSquare } from "lucide-react";
import { api } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { StatTile } from "@/components/app/stat-tile";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { Money } from "@/components/app/money";
import {
  SA_TENANTS_KEY,
  type TenantRow,
  formatInt,
  monthLabel,
  monthOptions,
  monthRange,
  saUsageKey,
} from "../_shared";

interface TenantUsageRow {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
}

interface UsageSummary {
  from: string;
  to: string;
  byTenant: TenantUsageRow[];
  totalCostUsd: string;
  totalTokens: number;
}

const columns: Array<DataTableColumn<TenantUsageRow>> = [
  { key: "tenantName", header: "Empresa", cell: (r) => <span className="font-medium">{r.tenantName}</span> },
  { key: "tenantSlug", header: "Slug", className: "font-mono text-xs", cell: (r) => r.tenantSlug },
  { key: "events", header: "Turnos", numeric: true, width: "6rem", cell: (r) => formatInt(r.events) },
  {
    key: "inputTokens",
    header: "Tokens entrada",
    numeric: true,
    width: "9rem",
    cell: (r) => formatInt(r.inputTokens),
  },
  {
    key: "outputTokens",
    header: "Tokens salida",
    numeric: true,
    width: "9rem",
    cell: (r) => formatInt(r.outputTokens),
  },
  {
    key: "costUsd",
    header: "Costo estimado",
    numeric: true,
    width: "9rem",
    cell: (r) => <Money value={r.costUsd} currency="USD" />,
  },
];

export default function SuperAdminUsagePage() {
  const months = useMemo(() => monthOptions(), []);
  const [month, setMonth] = useState(months[0]?.value ?? "");
  const [tenantId, setTenantId] = useState("");
  const { from, to } = useMemo(() => monthRange(month), [month]);

  const tenants = useQuery({
    queryKey: SA_TENANTS_KEY,
    queryFn: async () => {
      const res = await api.get<{ data: TenantRow[] }>("/super-admin/tenants");
      return res.data.data;
    },
  });

  const usage = useQuery({
    queryKey: saUsageKey(month, tenantId),
    queryFn: async () => {
      const res = await api.get<{ data: UsageSummary }>("/super-admin/usage", {
        params: { from, to, ...(tenantId ? { tenantId } : {}) },
      });
      return res.data.data;
    },
  });

  const u = usage.data;
  const totalEvents = useMemo(
    () => u?.byTenant.reduce((sum, r) => sum + r.events, 0) ?? 0,
    [u],
  );
  const tile = {
    isLoading: usage.isLoading,
    isError: usage.isError,
    onRetry: () => void usage.refetch(),
  };
  const tenantLabel = tenantId
    ? (tenants.data?.find((t) => t.id === tenantId)?.name ?? "la empresa")
    : "todas las empresas";

  return (
    <div>
      <PageHeader
        title="Uso y costos"
        description="Consumo de tokens del agente por empresa. Costo estimado, no la factura real del proveedor."
      />

      <div className="space-y-6">
        <Section title="Filtros" density="compact">
          <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
            <div className="space-y-1.5">
              <Label htmlFor="usage-month">Periodo</Label>
              <Select id="usage-month" value={month} onChange={(e) => setMonth(e.target.value)}>
                {months.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="usage-tenant">Empresa</Label>
              <Select
                id="usage-tenant"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
              >
                <option value="">Todas</option>
                {(tenants.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </Section>

        <Section
          title="Total del periodo"
          description={`${monthLabel(month)} · ${tenantLabel}`}
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatTile size="compact"
              {...tile}
              label="Costo estimado"
              tone="info"
              icon={<Coins className="h-4 w-4" />}
              value={<Money value={u?.totalCostUsd} currency="USD" />}
              hint={u === undefined ? undefined : "Suma de todos los modelos"}
            />
            <StatTile size="compact"
              {...tile}
              label="Tokens"
              icon={<Cpu className="h-4 w-4" />}
              value={formatInt(u?.totalTokens)}
              hint={u === undefined ? undefined : "Entrada + salida"}
            />
            <StatTile size="compact"
              {...tile}
              label="Turnos del agente"
              icon={<MessagesSquare className="h-4 w-4" />}
              value={formatInt(totalEvents)}
              hint={
                u === undefined
                  ? undefined
                  : `${formatInt(u.byTenant.length)} ${u.byTenant.length === 1 ? "empresa con consumo" : "empresas con consumo"}`
              }
            />
          </div>
        </Section>

        <Section title="Consumo por empresa" padded={false}>
          <DataTable
            columns={columns}
            rows={u?.byTenant}
            isLoading={usage.isLoading}
            isError={usage.isError}
            error={usage.error}
            onRetry={() => void usage.refetch()}
            getRowId={(r) => r.tenantId}
            getRowHref={(r) => `/super-admin/${r.tenantId}`}
            getRowActionLabel={(r) => `Ver ${r.tenantName}`}
            caption="Consumo de tokens por empresa"
            empty={{
              icon: <Gauge className="h-6 w-6" />,
              title: "Sin consumo en este periodo",
              description: "Ninguna empresa usó al agente en el rango seleccionado.",
            }}
          />
        </Section>
      </div>
    </div>
  );
}
