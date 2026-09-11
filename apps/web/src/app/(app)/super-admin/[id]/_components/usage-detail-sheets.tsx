"use client";

import { type ReactNode, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Coins, Cpu, MessagesSquare, Percent } from "lucide-react";
import { api } from "@/lib/api";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatTile } from "@/components/app/stat-tile";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { Money } from "@/components/app/money";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import {
  type TenantUsageDetail,
  type UsageDetailRow,
  formatInt,
  monthLabel,
  monthRange,
  saTenantUsageDetailKey,
} from "../../_shared";

/**
 * Paneles laterales de drill-down de la pestaña "Costos":
 *
 * - `MonthUsageSheet`: un mes de la tabla de tendencia → totales del mes,
 *   desglose por modelo y desglose por día.
 * - `ModelUsageSheet`: un modelo de la tabla "por modelo" → totales del
 *   periodo para ese modelo, costo por turno, participación sobre el total y
 *   serie diaria.
 *
 * Ambos comparten la misma query (`GET /super-admin/usage/detail`), que ya
 * viene agregada día × modelo desde el backend; aquí sólo se reagrupa.
 */

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

interface DateRange {
  from: string;
  to: string;
}

function useTenantUsageDetail(tenantId: string, range: DateRange | null) {
  const from = range?.from ?? "";
  const to = range?.to ?? "";
  return useQuery({
    queryKey: saTenantUsageDetailKey(tenantId, from, to),
    enabled: range !== null,
    queryFn: async () => {
      const res = await api.get<{ data: TenantUsageDetail }>("/super-admin/usage/detail", {
        params: { tenantId, from, to },
      });
      return res.data.data;
    },
  });
}

interface Totals {
  events: number;
  inputTokens: number;
  outputTokens: number;
  /** Suma en `number`; se vuelve string de 6 decimales al pintarse. */
  costUsd: number;
}

const ZERO: Totals = { events: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

function sumRows(rows: readonly UsageDetailRow[]): Totals {
  return rows.reduce<Totals>(
    (acc, r) => ({
      events: acc.events + r.events,
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      costUsd: acc.costUsd + Number(r.costUsd),
    }),
    ZERO,
  );
}

interface GroupedRow extends Totals {
  key: string;
}

/** Reagrupa el desglose día × modelo por una de sus dos dimensiones. */
function groupRows(rows: readonly UsageDetailRow[], by: "day" | "model"): GroupedRow[] {
  const buckets = new Map<string, GroupedRow>();
  for (const r of rows) {
    const key = r[by];
    const cur = buckets.get(key) ?? { key, ...ZERO };
    buckets.set(key, {
      key,
      events: cur.events + r.events,
      inputTokens: cur.inputTokens + r.inputTokens,
      outputTokens: cur.outputTokens + r.outputTokens,
      costUsd: cur.costUsd + Number(r.costUsd),
    });
  }
  const out = [...buckets.values()];
  // Días en orden cronológico; modelos del más caro al más barato.
  if (by === "day") out.sort((a, b) => a.key.localeCompare(b.key));
  else out.sort((a, b) => b.costUsd - a.costUsd);
  return out;
}

const cost = (n: number) => n.toFixed(6);

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

/**
 * "YYYY-MM-DD" ya viene en la zona de la empresa, así que NO pasa por
 * `<DateTime>`: ese componente reinterpretaría la medianoche UTC en
 * America/Mexico_City y movería el día uno atrás. Se arma la etiqueta a mano,
 * con nombres estáticos para no depender del locale del navegador.
 */
const WEEKDAYS_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const MONTHS_SHORT_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  const weekday = WEEKDAYS_ES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  return `${weekday} ${String(d).padStart(2, "0")} ${MONTHS_SHORT_ES[m - 1] ?? ""} ${y}`;
}

const PERCENT = new Intl.NumberFormat("es-MX", { style: "percent", maximumFractionDigits: 1 });

// ---------------------------------------------------------------------------
// Columnas
// ---------------------------------------------------------------------------

const tokensColumns: Array<DataTableColumn<GroupedRow>> = [
  { key: "events", header: "Turnos", numeric: true, width: "5.5rem", cell: (r) => formatInt(r.events) },
  {
    key: "tokens",
    header: "Tokens",
    numeric: true,
    width: "7rem",
    cell: (r) => formatInt(r.inputTokens + r.outputTokens),
  },
  {
    key: "costUsd",
    header: "Costo",
    numeric: true,
    width: "7.5rem",
    cell: (r) => <Money value={cost(r.costUsd)} currency="USD" />,
  },
];

const byModelColumns: Array<DataTableColumn<GroupedRow>> = [
  { key: "model", header: "Modelo", className: "font-mono text-xs", cell: (r) => r.key },
  ...tokensColumns,
];

const byDayColumns: Array<DataTableColumn<GroupedRow>> = [
  { key: "day", header: "Día", cell: (r) => dayLabel(r.key) },
  ...tokensColumns,
];

// ---------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="overflow-hidden rounded-lg border">{children}</div>
    </section>
  );
}

/**
 * Mantiene el último valor no nulo mientras el panel se cierra: así el título
 * y las tablas no parpadean a vacío durante la animación de salida.
 */
function useSticky<T>(value: T | null): T | null {
  const [shown, setShown] = useState(value);
  if (value !== null && value !== shown) setShown(value);
  return value ?? shown;
}

// ---------------------------------------------------------------------------
// Mes → detalle
// ---------------------------------------------------------------------------

export function MonthUsageSheet({
  tenantId,
  month,
  onClose,
}: {
  tenantId: string;
  /** "YYYY-MM"; `null` cierra el panel. */
  month: string | null;
  onClose: () => void;
}) {
  const shown = useSticky(month);
  const range = useMemo(() => (shown ? monthRange(shown) : null), [shown]);
  const detail = useTenantUsageDetail(tenantId, month !== null ? range : null);

  const rows = detail.data?.byDayAndModel;
  const totals = useMemo(() => (rows ? sumRows(rows) : null), [rows]);
  const byModel = useMemo(() => (rows ? groupRows(rows, "model") : undefined), [rows]);
  const byDay = useMemo(() => (rows ? groupRows(rows, "day") : undefined), [rows]);

  const tile = {
    size: "compact" as const,
    isLoading: detail.isLoading,
    isError: detail.isError,
    onRetry: () => void detail.refetch(),
  };
  const table = {
    isLoading: detail.isLoading,
    isError: detail.isError,
    error: detail.error,
    onRetry: () => void detail.refetch(),
    skeletonRows: 3,
  };

  return (
    <Sheet open={month !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{shown ? monthLabel(shown) : "Detalle del mes"}</SheetTitle>
          <SheetDescription>
            Consumo del agente en el mes, por modelo y por día. Estimado, no es la factura
            real del proveedor.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              {...tile}
              label="Costo del mes"
              tone="info"
              icon={<Coins className="h-4 w-4" />}
              value={<Money value={totals ? cost(totals.costUsd) : undefined} currency="USD" />}
            />
            <StatTile
              {...tile}
              label="Turnos"
              icon={<MessagesSquare className="h-4 w-4" />}
              value={formatInt(totals?.events)}
            />
            <StatTile
              {...tile}
              label="Tokens entrada"
              icon={<Cpu className="h-4 w-4" />}
              value={formatInt(totals?.inputTokens)}
            />
            <StatTile
              {...tile}
              label="Tokens salida"
              icon={<Cpu className="h-4 w-4" />}
              value={formatInt(totals?.outputTokens)}
            />
          </div>

          <DetailBlock title="Por modelo">
            <DataTable
              {...table}
              columns={byModelColumns}
              rows={byModel}
              getRowId={(r) => r.key}
              caption="Consumo del mes por modelo"
              empty={{
                title: "Sin consumo en este mes",
                description: "La empresa no usó al agente en el periodo.",
              }}
            />
          </DetailBlock>

          <DetailBlock title="Por día">
            <DataTable
              {...table}
              columns={byDayColumns}
              rows={byDay}
              getRowId={(r) => r.key}
              caption="Consumo del mes día a día"
              empty={{
                title: "Sin consumo en este mes",
                description: "No hay días con actividad del agente.",
              }}
            />
          </DetailBlock>

          {detail.data ? (
            <p className="text-xs text-muted-foreground">
              Días según la zona horaria de la empresa ({detail.data.timeZone}).
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Modelo → detalle
// ---------------------------------------------------------------------------

export function ModelUsageSheet({
  tenantId,
  model,
  range,
  periodLabel,
  onClose,
}: {
  tenantId: string;
  /** Id del modelo; `null` cierra el panel. */
  model: string | null;
  /** Rango ISO del periodo que muestra la tabla de origen. */
  range: DateRange;
  /** "Septiembre 2026": va en la descripción del panel. */
  periodLabel: string;
  onClose: () => void;
}) {
  const shown = useSticky(model);
  const detail = useTenantUsageDetail(tenantId, model !== null ? range : null);

  const all = detail.data?.byDayAndModel;
  const mine = useMemo(() => all?.filter((r) => r.model === shown), [all, shown]);
  const periodTotals = useMemo(() => (all ? sumRows(all) : null), [all]);
  const totals = useMemo(() => (mine ? sumRows(mine) : null), [mine]);
  const byDay = useMemo(() => (mine ? groupRows(mine, "day") : undefined), [mine]);

  const costPerTurn = totals && totals.events > 0 ? totals.costUsd / totals.events : null;
  const share =
    totals && periodTotals && periodTotals.costUsd > 0
      ? totals.costUsd / periodTotals.costUsd
      : null;

  const tile = {
    size: "compact" as const,
    isLoading: detail.isLoading,
    isError: detail.isError,
    onRetry: () => void detail.refetch(),
  };

  return (
    <Sheet open={model !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-mono text-base">{shown ?? "Detalle del modelo"}</SheetTitle>
          <SheetDescription>
            {periodLabel} · consumo día a día de este modelo. Estimado, no es la factura real
            del proveedor.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              {...tile}
              label="Costo del periodo"
              tone="info"
              icon={<Coins className="h-4 w-4" />}
              value={<Money value={totals ? cost(totals.costUsd) : undefined} currency="USD" />}
            />
            <StatTile
              {...tile}
              label="Turnos"
              icon={<MessagesSquare className="h-4 w-4" />}
              value={formatInt(totals?.events)}
            />
            <StatTile
              {...tile}
              label="Costo por turno"
              icon={<Coins className="h-4 w-4" />}
              value={
                costPerTurn === null ? (
                  <span aria-hidden className="text-muted-foreground">
                    —
                  </span>
                ) : (
                  <Money value={cost(costPerTurn)} currency="USD" />
                )
              }
            />
            <StatTile
              {...tile}
              label="Participación"
              icon={<Percent className="h-4 w-4" />}
              value={
                share === null ? (
                  <span aria-hidden className="text-muted-foreground">
                    —
                  </span>
                ) : (
                  PERCENT.format(share)
                )
              }
            />
          </div>

          {totals ? (
            <DescriptionList divided>
              <FieldRow label="Tokens entrada" numeric>
                {formatInt(totals.inputTokens)}
              </FieldRow>
              <FieldRow label="Tokens salida" numeric>
                {formatInt(totals.outputTokens)}
              </FieldRow>
              <FieldRow label="Días con consumo" numeric>
                {formatInt(byDay?.length ?? 0)}
              </FieldRow>
              <FieldRow
                label="Total del periodo"
                numeric
                hint={periodTotals ? "Todos los modelos; base de la participación." : undefined}
              >
                <Money value={periodTotals ? cost(periodTotals.costUsd) : undefined} currency="USD" />
              </FieldRow>
            </DescriptionList>
          ) : null}

          <DetailBlock title="Por día">
            <DataTable
              columns={byDayColumns}
              rows={byDay}
              isLoading={detail.isLoading}
              isError={detail.isError}
              error={detail.error}
              onRetry={() => void detail.refetch()}
              skeletonRows={3}
              getRowId={(r) => r.key}
              caption="Consumo diario del modelo"
              empty={{
                icon: <CalendarDays className="h-6 w-6" />,
                title: "Sin consumo en este periodo",
                description: "Este modelo no registró turnos en el periodo.",
              }}
            />
          </DetailBlock>

          {detail.data ? (
            <p className="text-xs text-muted-foreground">
              Días según la zona horaria de la empresa ({detail.data.timeZone}).
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
