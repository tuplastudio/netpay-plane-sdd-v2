"use client";

import { useQuery } from "@tanstack/react-query";
import { Bot, Coins, Gauge } from "lucide-react";
import { api } from "@/lib/api";
import { Section } from "@/components/app/section";
import { StatTile } from "@/components/app/stat-tile";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { Money } from "@/components/app/money";

interface UsageByModel {
  model: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
}

interface UsageSummary {
  totalCostUsd: string;
  totalTokens: number;
  byModel: UsageByModel[];
}

/**
 * Conteos (tokens, turnos) con separador de miles es-MX. No hay primitiva para
 * enteros no monetarios; `Money` no aplica y `toLocaleString` en línea está
 * prohibido por el sistema de diseño.
 */
const COUNT_FORMAT = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const formatCount = (n: number) => COUNT_FORMAT.format(n);

const columns: Array<DataTableColumn<UsageByModel>> = [
  {
    key: "model",
    header: "Modelo",
    className: "font-mono text-xs",
    cell: (m) => m.model,
  },
  { key: "events", header: "Turnos", numeric: true, width: "7rem", cell: (m) => formatCount(m.events) },
  {
    key: "input",
    header: "Entrada",
    numeric: true,
    width: "9rem",
    cell: (m) => formatCount(m.inputTokens),
  },
  {
    key: "output",
    header: "Salida",
    numeric: true,
    width: "9rem",
    cell: (m) => formatCount(m.outputTokens),
  },
  {
    key: "cost",
    header: "Costo",
    numeric: true,
    width: "9rem",
    cell: (m) => <Money value={m.costUsd} currency="USD" />,
  },
];

export function UsageSection() {
  const usage = useQuery({
    queryKey: ["tenant-usage-summary"],
    queryFn: async () => {
      const res = await api.get<{ data: UsageSummary }>("/usage/summary");
      return res.data.data;
    },
  });

  const retry = () => void usage.refetch();

  return (
    <Section
      title="Uso y costo del agente"
      headerIcon={<Gauge className="h-4 w-4" />}
      description="Consumo del mes en curso. El costo es estimado, no la factura de OpenRouter."
      padded={false}
    >
      <div className="grid grid-cols-2 gap-2 p-4 sm:p-6 sm:pt-0">
        <StatTile size="compact"
          label="Costo estimado"
          value={<Money value={usage.data?.totalCostUsd} currency="USD" />}
          hint="Mes en curso"
          icon={<Coins className="h-4 w-4" />}
          isLoading={usage.isLoading}
          isError={usage.isError}
          onRetry={retry}
        />
        <StatTile size="compact"
          label="Tokens"
          value={usage.data ? formatCount(usage.data.totalTokens) : "—"}
          hint="Entrada + salida"
          icon={<Bot className="h-4 w-4" />}
          isLoading={usage.isLoading}
          isError={usage.isError}
          onRetry={retry}
        />
      </div>

      <DataTable
        columns={columns}
        rows={usage.data?.byModel}
        isLoading={usage.isLoading}
        isError={usage.isError}
        error={usage.error}
        onRetry={retry}
        caption="Consumo del agente por modelo"
        skeletonRows={2}
        empty={{
          icon: <Bot className="h-6 w-6" />,
          title: "Sin consumo este mes",
          description: "En cuanto el agente atienda la primera conversación verás aquí el desglose por modelo.",
        }}
      />
    </Section>
  );
}
