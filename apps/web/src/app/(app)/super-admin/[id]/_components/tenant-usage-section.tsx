"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { api } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Section } from "@/components/app/section";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { Money, formatMoney } from "@/components/app/money";
import {
  type ModelUsageRow,
  type TenantUsage,
  formatInt,
  monthLabel,
  monthOptions,
  monthRange,
  saTenantUsageKey,
} from "../../_shared";
import { ModelUsageSheet } from "./usage-detail-sheets";

const columns: Array<DataTableColumn<ModelUsageRow>> = [
  { key: "model", header: "Modelo", className: "font-mono text-xs", cell: (r) => r.model },
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

/** "Consumo por modelo" de una empresa, con selector de mes. */
export function TenantUsageSection({ tenantId }: { tenantId: string }) {
  const months = useMemo(() => monthOptions(), []);
  const [month, setMonth] = useState(months[0]?.value ?? "");
  const { from, to } = useMemo(() => monthRange(month), [month]);
  // Modelo seleccionado en la tabla; abre el panel con su serie diaria.
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const usage = useQuery({
    queryKey: saTenantUsageKey(tenantId, from, to),
    queryFn: async () => {
      const res = await api.get<{ data: TenantUsage }>(`/super-admin/tenants/${tenantId}/usage`, {
        params: { from, to },
      });
      return res.data.data;
    },
  });

  const selectId = `tenant-usage-month-${tenantId}`;

  return (
    <Section
      title="Consumo por modelo"
      description="Costo estimado del agente por modelo. No es la factura real del proveedor."
      padded={false}
      actions={
        <div className="flex items-center gap-2">
          <Label htmlFor={selectId} className="sr-only">
            Periodo
          </Label>
          <Select
            id={selectId}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 w-48"
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
      }
      footer={
        usage.data && usage.data.byModel.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Total del periodo:{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {formatMoney(usage.data.totalCostUsd, "USD")}
            </span>{" "}
            · <span className="tabular-nums">{formatInt(usage.data.totalTokens)}</span> tokens
          </p>
        ) : undefined
      }
    >
      <DataTable
        columns={columns}
        rows={usage.data?.byModel}
        isLoading={usage.isLoading}
        isError={usage.isError}
        error={usage.error}
        onRetry={() => void usage.refetch()}
        getRowId={(r) => r.model}
        onRowClick={(r) => setSelectedModel(r.model)}
        getRowActionLabel={(r) => `Ver detalle de ${r.model}`}
        skeletonRows={3}
        caption="Consumo de tokens por modelo"
        empty={{
          icon: <Gauge className="h-6 w-6" />,
          title: "Sin consumo en este periodo",
          description: "La empresa no usó al agente en el mes seleccionado.",
        }}
      />

      <ModelUsageSheet
        tenantId={tenantId}
        model={selectedModel}
        range={{ from, to }}
        periodLabel={monthLabel(month)}
        onClose={() => setSelectedModel(null)}
      />
    </Section>
  );
}
