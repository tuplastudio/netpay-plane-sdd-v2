"use client";

import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type Tone } from "@/components/ui/status-badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { RUN_STATUS_LABELS, TRIGGER_LABELS, isRunning, type DataSource, type DataSourceRun } from "./draft";

const RUN_TONES: Record<string, Tone> = {
  RUNNING: "info",
  SUCCEEDED: "success",
  PARTIAL: "warning",
  FAILED: "destructive",
};

const COUNT = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

/** Historial de corridas de una fuente: conteos por corrida y muestra de errores. */
export function DataSourceRunsSheet({
  source,
  onOpenChange,
}: {
  source: DataSource | null;
  onOpenChange: (open: boolean) => void;
}) {
  const runs = useQuery({
    queryKey: ["data-source-runs", source?.id],
    enabled: source !== null,
    queryFn: async () => {
      const res = await api.get<{ data: DataSourceRun[] }>(`/data-sources/${source!.id}/runs`);
      return res.data.data;
    },
    refetchInterval: (query) => (query.state.data?.some((r) => r.status === "RUNNING") ? 5_000 : false),
  });

  const columns: Array<DataTableColumn<DataSourceRun>> = [
    {
      key: "startedAt",
      header: "Inicio",
      width: "11rem",
      cell: (r) => <DateTime value={r.startedAt} />,
    },
    {
      key: "status",
      header: "Resultado",
      width: "9rem",
      cell: (r) => <StatusBadge status={r.status} label={RUN_STATUS_LABELS[r.status]} tone={RUN_TONES[r.status]} />,
    },
    {
      key: "trigger",
      header: "Origen",
      width: "7rem",
      cell: (r) => (
        <Badge variant="neutral" size="sm">
          {TRIGGER_LABELS[r.triggeredBy] ?? r.triggeredBy}
        </Badge>
      ),
    },
    {
      key: "stats",
      header: "Conteos",
      cell: (r) =>
        r.stats ? (
          <dl className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-xs sm:grid-cols-6">
            <Stat label="Recibidos" value={r.stats.fetched} />
            <Stat label="Creados" value={r.stats.created} />
            <Stat label="Actualizados" value={r.stats.updated} />
            <Stat label="Sin cambios" value={r.stats.skipped} />
            <Stat label="Archivados" value={r.stats.deactivated} />
            <Stat label="Errores" value={r.stats.errors} tone={r.stats.errors > 0 ? "warning" : undefined} />
          </dl>
        ) : r.status === "RUNNING" ? (
          <span className="text-muted-foreground">En curso…</span>
        ) : (
          <span className="text-muted-foreground">Sin conteos</span>
        ),
    },
  ];

  return (
    <Sheet open={source !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl" title="Historial de corridas">
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <History aria-hidden className="h-4 w-4 text-primary" />
            <SheetTitle className="text-base">Historial de corridas</SheetTitle>
          </div>
          <SheetDescription>
            {source ? `${source.name} · últimas 50 sincronizaciones.` : "Últimas 50 sincronizaciones."}
            {source && isRunning(source) ? " Hay una en curso: la lista se actualiza sola." : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <DataTable
            columns={columns}
            rows={runs.data}
            isLoading={runs.isLoading}
            isError={runs.isError}
            error={runs.error}
            onRetry={() => void runs.refetch()}
            caption="Corridas de la fuente"
            empty={{
              icon: <History className="h-6 w-6" />,
              title: "Todavía no hay corridas",
              description: "Pulsa «Sincronizar ahora» o espera a la programación para ver aquí el resultado.",
            }}
          />

          {runs.data?.some((r) => r.errorSample && r.errorSample.length > 0) ? (
            <div className="space-y-3 px-6 py-4">
              <h3 className="text-sm font-semibold">Errores recientes</h3>
              {runs.data
                .filter((r) => r.errorSample && r.errorSample.length > 0)
                .slice(0, 5)
                .map((r) => (
                  <details key={r.id} className="rounded-md border border-hairline bg-card">
                    <summary className="cursor-pointer px-3 py-2 text-sm">
                      <DateTime value={r.startedAt} className="text-muted-foreground" />{" "}
                      <span className="ml-2">{RUN_STATUS_LABELS[r.status]}</span>
                      <span className="ml-2 text-muted-foreground">
                        · {COUNT.format(r.errorSample!.length)} error(es) de muestra
                      </span>
                    </summary>
                    <ul className="space-y-1 border-t border-hairline px-3 py-2 font-mono text-xs">
                      {r.errorSample!.map((e, i) => (
                        <li key={i} className="break-words">
                          {e.index !== undefined ? <span className="text-muted-foreground">#{e.index} </span> : null}
                          {e.sku ? <span className="text-muted-foreground">{e.sku} · </span> : null}
                          {e.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className={tone === "warning" ? "font-semibold tabular-nums text-warning-foreground" : "font-semibold tabular-nums"}>
        {COUNT.format(value)}
      </dd>
    </div>
  );
}
