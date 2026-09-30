"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DatabaseZap, History, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge, type Tone } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Section } from "@/components/app/section";
import { InfoTip, Tip } from "@/components/app/info-tip";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiErrorMessage } from "../api-error";
import {
  KIND_LABELS,
  RUN_STATUS_LABELS,
  SOURCE_STATUS_LABELS,
  describeSchedule,
  isRunning,
  type DataSource,
} from "./draft";
import { DataSourceWizard } from "./data-source-wizard";
import { DataSourceRunsSheet } from "./data-source-runs-sheet";

export const dataSourcesQueryKey = ["data-sources"] as const;

const SOURCE_TONES: Record<string, Tone> = { ACTIVE: "success", PAUSED: "neutral", ERROR: "destructive" };
const RUN_TONES: Record<string, Tone> = {
  RUNNING: "info",
  SUCCEEDED: "success",
  PARTIAL: "warning",
  FAILED: "destructive",
};

/**
 * Fuentes de datos: APIs REST o servidores MCP de los que se sincroniza el
 * catálogo. Lista + asistente de alta/edición + historial de corridas.
 * Mientras alguna fuente esté corriendo, la lista se refresca sola.
 */
export function DataSourcesSection() {
  const queryClient = useQueryClient();
  const [wizard, setWizard] = useState<{ open: boolean; source: DataSource | null }>({ open: false, source: null });
  const [runsFor, setRunsFor] = useState<DataSource | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DataSource | null>(null);

  const sources = useQuery({
    queryKey: dataSourcesQueryKey,
    queryFn: async () => {
      const res = await api.get<{ data: DataSource[] }>("/data-sources");
      return res.data.data;
    },
    refetchInterval: (query) => (query.state.data?.some((s) => isRunning(s)) ? 5_000 : false),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: dataSourcesQueryKey });

  const sync = useMutation({
    mutationFn: async (source: DataSource) => {
      await api.post(`/data-sources/${source.id}/sync`);
      return source;
    },
    onSuccess: async (source) => {
      toast.success(`Sincronización iniciada: ${source.name}`);
      await invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo iniciar la sincronización")),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/data-sources/${id}`);
    },
    onSuccess: async () => {
      toast.success("Fuente eliminada. Los productos importados se conservan.");
      setDeleteTarget(null);
      await invalidate();
    },
    onError: (error) => {
      setDeleteTarget(null);
      toast.error(apiErrorMessage(error, "No se pudo eliminar la fuente"));
    },
  });

  const columns = useMemo<Array<DataTableColumn<DataSource>>>(
    () => [
      {
        key: "name",
        header: "Fuente",
        cell: (s) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{s.name}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{s.url}</p>
          </div>
        ),
      },
      {
        key: "kind",
        header: "Tipo",
        width: "8rem",
        cell: (s) => (
          <Badge variant="neutral" size="sm">
            {KIND_LABELS[s.kind]}
          </Badge>
        ),
      },
      {
        key: "status",
        header: "Estado",
        width: "9rem",
        cell: (s) =>
          isRunning(s) ? (
            <StatusBadge status="RUNNING" label="Sincronizando" tone="info" />
          ) : (
            <StatusBadge status={s.status} label={SOURCE_STATUS_LABELS[s.status]} tone={SOURCE_TONES[s.status]} />
          ),
      },
      {
        key: "lastRun",
        header: (
          <span className="inline-flex items-center gap-1">
            Última corrida
            <InfoTip label="Última corrida" text="Cuándo terminó la última sincronización y cómo salió. Abre el historial para ver conteos y errores." />
          </span>
        ),
        width: "13rem",
        cell: (s) =>
          s.lastRunAt ? (
            <div className="flex flex-col gap-1">
              <DateTime value={s.lastRunAt} className="text-muted-foreground" />
              {s.lastStatus ? (
                <StatusBadge
                  status={s.lastStatus}
                  size="sm"
                  label={RUN_STATUS_LABELS[s.lastStatus]}
                  tone={RUN_TONES[s.lastStatus]}
                />
              ) : null}
            </div>
          ) : (
            <span className="text-muted-foreground">Nunca</span>
          ),
      },
      {
        key: "nextRun",
        header: "Próxima",
        width: "11rem",
        cell: (s) => (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm">{describeSchedule(s)}</span>
            {s.nextRunAt && s.status !== "PAUSED" ? (
              <DateTime value={s.nextRunAt} className="text-xs text-muted-foreground" />
            ) : null}
          </div>
        ),
      },
      {
        key: "actions",
        header: <span className="sr-only">Acciones</span>,
        width: "12rem",
        className: "text-right",
        cell: (s) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => sync.mutate(s)}
              disabled={isRunning(s) || sync.isPending}
              aria-label={`Sincronizar ahora ${s.name}`}
            >
              <RefreshCw aria-hidden className="h-3.5 w-3.5" />
              Sincronizar ahora
            </Button>
            <DropdownMenu>
              <Tip label="Más acciones">
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`Más acciones de ${s.name}`}>
                    <MoreHorizontal aria-hidden className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </Tip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setRunsFor(s)}>
                  <History aria-hidden className="h-4 w-4" />
                  Historial de corridas
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setWizard({ open: true, source: s })}>
                  <Pencil aria-hidden className="h-4 w-4" />
                  Editar
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteTarget(s)}>
                  <Trash2 aria-hidden className="h-4 w-4" />
                  Eliminar fuente
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [sync],
  );

  return (
    <>
      <Section
        title="Fuentes de datos"
        headerIcon={<DatabaseZap className="h-4 w-4" />}
        description="Sincroniza tu catálogo desde una API REST o un servidor MCP: productos, precios y existencias se actualizan solos según la programación."
        actions={
          <Button onClick={() => setWizard({ open: true, source: null })}>
            <Plus aria-hidden className="h-4 w-4" />
            Nueva fuente
          </Button>
        }
        padded={false}
      >
        <DataTable
          columns={columns}
          rows={sources.data}
          isLoading={sources.isLoading}
          isError={sources.isError}
          error={sources.error}
          onRetry={() => void sources.refetch()}
          caption="Fuentes de datos del catálogo"
          empty={{
            icon: <DatabaseZap className="h-6 w-6" />,
            title: "Sin fuentes de datos",
            description:
              "Conecta tu ERP, tienda en línea o un servidor MCP para que el catálogo se mantenga al día sin capturar a mano.",
            action: (
              <Button onClick={() => setWizard({ open: true, source: null })}>
                <Plus aria-hidden className="h-4 w-4" />
                Nueva fuente
              </Button>
            ),
          }}
        />
      </Section>

      {sources.data?.some((s) => s.lastError && s.status === "ERROR") ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Las fuentes con error siguen su programación: se reintentan en la próxima corrida. Revisa el historial para ver el motivo.
        </p>
      ) : null}

      <DataSourceWizard
        key={wizard.source?.id ?? (wizard.open ? "new" : "closed")}
        open={wizard.open}
        source={wizard.source}
        onOpenChange={(open) => setWizard((w) => ({ ...w, open }))}
        onSaved={async () => {
          setWizard({ open: false, source: null });
          await invalidate();
        }}
      />

      <DataSourceRunsSheet source={runsFor} onOpenChange={(open) => (open ? null : setRunsFor(null))} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => (open ? null : setDeleteTarget(null))}
        title="Eliminar fuente de datos"
        description={
          deleteTarget
            ? `Se elimina "${deleteTarget.name}" y su historial. Los productos ya importados se conservan en el catálogo y dejan de actualizarse.`
            : undefined
        }
        confirmLabel="Eliminar"
        pending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
      />
    </>
  );
}
