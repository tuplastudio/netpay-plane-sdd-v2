"use client";

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Coins, Cpu, MessagesSquare, TrendingUp, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { Section } from "@/components/app/section";
import { StatTile } from "@/components/app/stat-tile";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { Money, formatMoney } from "@/components/app/money";
import {
  type ModelUsageRow,
  type TenantUsage,
  formatInt,
  monthOptions,
  monthRange,
  monthLabel,
  saTenantUsageKey,
} from "../../_shared";
import { ModelUsageSheet, MonthUsageSheet } from "./usage-detail-sheets";

const HISTORY_MONTHS = 6;

interface MonthUsage {
  month: string;
  costUsd: string;
  totalTokens: number;
  events: number;
}

const modelColumns: Array<DataTableColumn<ModelUsageRow>> = [
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

const historyColumns: Array<DataTableColumn<MonthUsage>> = [
  { key: "month", header: "Mes", cell: (r) => monthLabel(r.month) },
  {
    key: "events",
    header: "Turnos",
    numeric: true,
    width: "6rem",
    cell: (r) => formatInt(r.events),
  },
  {
    key: "totalTokens",
    header: "Tokens",
    numeric: true,
    width: "8rem",
    cell: (r) => formatInt(r.totalTokens),
  },
  {
    key: "costUsd",
    header: "Costo estimado",
    numeric: true,
    width: "10rem",
    cell: (r) => <Money value={r.costUsd} currency="USD" />,
  },
];

/**
 * Pestaña "Costos" del detalle de empresa: gasto del mes en curso, gasto
 * histórico (todos los registros) y un histórico mes-a-mes de los últimos
 * seis meses para ver tendencia. Los importes son **estimados** — el cálculo
 * viene del servicio del agente, no de la factura real del proveedor.
 */
export function TenantCostTab({ tenantId }: { tenantId: string }) {
  // Mes seleccionado en la tabla de tendencia; abre el panel de detalle.
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  // 1) Mes en curso (rango por defecto del backend: inicio de mes → ahora).
  const current = useQuery({
    queryKey: ["super-admin", "tenant", tenantId, "cost", "current"],
    queryFn: async () => {
      const res = await api.get<{ data: TenantUsage }>(`/super-admin/tenants/${tenantId}/usage`);
      return res.data.data;
    },
  });

  // 2) Histórico total: rango "desde el primer evento" → ahora.
  //    2020-01-01 cubre cualquier tenant sin saturar la BD; si la fila está
  //    vacía el backend igual devuelve 0 y el UI lo cuenta correctamente.
  const allTime = useQuery({
    queryKey: ["super-admin", "tenant", tenantId, "cost", "all-time"],
    queryFn: async () => {
      const res = await api.get<{ data: TenantUsage }>(
        `/super-admin/tenants/${tenantId}/usage`,
        { params: { from: "2020-01-01T00:00:00Z" } },
      );
      return res.data.data;
    },
  });

  // 3) Tendencia: últimos HISTORY_MONTHS meses en paralelo. `useQueries`
  //    mantiene el orden de las queries en el array de salida, así podemos
  //    mapear 1-a-1 con `monthOptions()` sin perder el más reciente primero.
  const months = useMemo(() => monthOptions(HISTORY_MONTHS), []);
  const monthlyQueries = useQueries({
    queries: months.map((m) => {
      const { from, to } = monthRange(m.value);
      return {
        queryKey: saTenantUsageKey(tenantId, from, to),
        queryFn: async () => {
          const res = await api.get<{ data: TenantUsage }>(
            `/super-admin/tenants/${tenantId}/usage`,
            { params: { from, to } },
          );
          return res.data.data;
        },
      };
    }),
  });
  const monthlyLoading = monthlyQueries.some((q) => q.isLoading);
  const monthly: MonthUsage[] = useMemo(
    () =>
      months.map((m, i) => {
        const q = monthlyQueries[i];
        const d = q?.data;
        return {
          month: m.value,
          costUsd: d?.totalCostUsd ?? "0",
          totalTokens: d?.totalTokens ?? 0,
          events: d?.byModel.reduce((s, r) => s + r.events, 0) ?? 0,
        };
      }),
    [months, monthlyQueries],
  );

  const allTimeCost = allTime.data?.totalCostUsd;
  const allTimeEvents = allTime.data?.byModel.reduce((s, r) => s + r.events, 0) ?? 0;
  // Meses con consumo (> 0) sobre el rango pedido, para un promedio honesto.
  const monthsWithSpend = monthly.filter((m) => Number(m.costUsd) > 0).length;
  const averagePerActiveMonth =
    monthsWithSpend > 0 && allTimeCost
      ? (Number(allTimeCost) / monthsWithSpend).toFixed(6)
      : null;

  const tile = {
    isLoading: current.isLoading || allTime.isLoading,
    isError: current.isError || allTime.isError,
    onRetry: () => {
      void current.refetch();
      void allTime.refetch();
    },
  };

  return (
    <div className="space-y-6">
      <Section
        title="Gasto del mes"
        description="Periodo en curso. Estimado, no es la factura real del proveedor."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <StatTile size="compact"
            {...tile}
            label="Costo del mes"
            tone="info"
            icon={<Coins className="h-4 w-4" />}
            value={<Money value={current.data?.totalCostUsd} currency="USD" />}
            hint={current.data === undefined ? undefined : "Suma de todos los modelos"}
          />
          <StatTile size="compact"
            {...tile}
            label="Turnos del agente"
            icon={<MessagesSquare className="h-4 w-4" />}
            value={formatInt(
              current.data?.byModel.reduce((s, r) => s + r.events, 0) ?? 0,
            )}
            hint={current.data === undefined ? undefined : "Mensajes atendidos"}
          />
          <StatTile size="compact"
            {...tile}
            label="Tokens del mes"
            icon={<Cpu className="h-4 w-4" />}
            value={formatInt(current.data?.totalTokens)}
            hint={current.data === undefined ? undefined : "Entrada + salida"}
          />
        </div>
      </Section>

      <Section
        title="Acumulado"
        description="Todo el historial registrado por el agente para esta empresa."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <StatTile size="compact"
            {...tile}
            label="Costo total"
            tone="info"
            icon={<Wallet className="h-4 w-4" />}
            value={<Money value={allTimeCost} currency="USD" />}
            hint={allTimeCost === undefined ? undefined : "Desde el primer evento"}
          />
          <StatTile size="compact"
            {...tile}
            label="Turnos totales"
            icon={<MessagesSquare className="h-4 w-4" />}
            value={formatInt(allTimeEvents)}
            hint={allTimeCost === undefined ? undefined : "Suma de todos los periodos"}
          />
          <StatTile size="compact"
            {...tile}
            label="Promedio mensual"
            icon={<TrendingUp className="h-4 w-4" />}
            value={
              averagePerActiveMonth ? (
                <Money value={averagePerActiveMonth} currency="USD" />
              ) : (
                <span aria-hidden className="text-muted-foreground">
                  —
                </span>
              )
            }
            hint={
              monthsWithSpend === 0
                ? "Aún no hay meses con consumo"
                : `Sobre ${monthsWithSpend} ${monthsWithSpend === 1 ? "mes con consumo" : "meses con consumo"}`
            }
          />
        </div>
      </Section>

      <Section
        title="Tendencia"
        description={`Últimos ${HISTORY_MONTHS} meses. Haz clic en un mes para ver su desglose por modelo y por día.`}
        padded={false}
        footer={
          monthly.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Total acumulado en el periodo mostrado:{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {formatMoney(
                  monthly
                    .reduce((acc, m) => acc + Number(m.costUsd), 0)
                    .toFixed(6),
                  "USD",
                )}
              </span>
            </p>
          ) : undefined
        }
      >
        <DataTable
          columns={historyColumns}
          rows={monthly}
          isLoading={monthlyLoading}
          empty={{
            title: "Sin historial",
            description: "Esta empresa aún no tiene consumo registrado.",
          }}
          getRowId={(r) => r.month}
          onRowClick={(r) => setSelectedMonth(r.month)}
          getRowActionLabel={(r) => `Ver detalle de ${monthLabel(r.month)}`}
          caption="Costo mensual estimado"
        />
      </Section>

      <TenantUsageSectionReadOnly tenantId={tenantId} />

      <MonthUsageSheet
        tenantId={tenantId}
        month={selectedMonth}
        onClose={() => setSelectedMonth(null)}
      />
    </div>
  );
}

/**
 * Reuso del componente existente, pero envuelto para no contaminar el árbol
 * de `<Tabs>` con un `Section` que ya no queremos aquí (la cabecera "Resumen"
 * ya no aplica).
 */
function TenantUsageSectionReadOnly({ tenantId }: { tenantId: string }) {
  return <TenantByModelMonth tenantId={tenantId} />;
}

/**
 * Wrapper "sólo tabla" del desglose por modelo del mes actual — vive también
 * en "Costos" porque es la pieza más útil al revisar el gasto.
 */
function TenantByModelMonth({ tenantId }: { tenantId: string }) {
  // Modelo seleccionado en la tabla; abre el panel con su serie diaria.
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  // Mismo mes que el primer bloque, pero como rango explícito: el panel de
  // detalle pide `from/to` para que su caché no dependa de "ahora".
  const currentMonth = useMemo(() => monthOptions(1)[0]?.value ?? "", []);
  const range = useMemo(() => monthRange(currentMonth), [currentMonth]);

  const current = useQuery({
    queryKey: ["super-admin", "tenant", tenantId, "cost", "current"],
    queryFn: async () => {
      const res = await api.get<{ data: TenantUsage }>(
        `/super-admin/tenants/${tenantId}/usage`,
      );
      return res.data.data;
    },
  });

  return (
    <Section
      title="Por modelo (mes en curso)"
      description="Mismo mes que el primer bloque. Haz clic en un modelo para ver su consumo día a día."
      padded={false}
    >
      <DataTable
        columns={modelColumns}
        rows={current.data?.byModel}
        isLoading={current.isLoading}
        isError={current.isError}
        error={current.error}
        onRetry={() => void current.refetch()}
        getRowId={(r) => r.model}
        onRowClick={(r) => setSelectedModel(r.model)}
        getRowActionLabel={(r) => `Ver detalle de ${r.model}`}
        skeletonRows={3}
        caption="Desglose por modelo del mes en curso"
        empty={{
          title: "Sin consumo en este periodo",
          description: "La empresa no usó al agente en el mes en curso.",
        }}
      />

      <ModelUsageSheet
        tenantId={tenantId}
        model={selectedModel}
        range={range}
        periodLabel={monthLabel(currentMonth)}
        onClose={() => setSelectedModel(null)}
      />
    </Section>
  );
}