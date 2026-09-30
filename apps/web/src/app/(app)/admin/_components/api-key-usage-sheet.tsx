"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, ChevronLeft, ChevronRight, Globe, Timer } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatTile } from "@/components/app/stat-tile";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { useDebouncedValue } from "@/components/app/use-debounced-value";
import {
  formatCount,
  formatDayLabel,
  formatRelativeTime,
  httpStatusTone,
  type ApiKey,
  type ApiKeyUsageEvent,
  type ApiKeyUsageSummary,
} from "./api-key-helpers";

const PAGE_SIZE = 25;
const SUMMARY_DAYS = 30;

type StatusFilter = "" | "2xx" | "3xx" | "4xx" | "5xx";
type RangeFilter = "1" | "7" | "30" | "90";

interface UsagePage {
  data: ApiKeyUsageEvent[];
  pageInfo: { nextCursor: string | null; size: number };
}

/**
 * Panel "Uso" de una API key: resumen (`GET :id/usage/summary?days=30`),
 * gráfica diaria y bitácora paginada por cursor (`GET :id/usage`).
 */
export function ApiKeyUsageSheet({
  basePath,
  apiKey,
  open,
  onOpenChange,
}: {
  basePath: string;
  apiKey: ApiKey | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        title="Uso de la API key"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-3xl"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>Uso de “{apiKey?.name ?? "API key"}”</SheetTitle>
          <SheetDescription>
            {apiKey ? (
              <>
                <span className="font-mono text-xs">{apiKey.prefix}</span> · Últimos {SUMMARY_DAYS} días.
                La bitácora se conserva 90 días.
              </>
            ) : (
              "Sin key seleccionada"
            )}
          </SheetDescription>
        </SheetHeader>
        {apiKey ? <UsageBody key={apiKey.id} basePath={basePath} apiKey={apiKey} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function UsageBody({ basePath, apiKey }: { basePath: string; apiKey: ApiKey }) {
  const summary = useQuery({
    queryKey: ["api-key-usage-summary", basePath, apiKey.id, SUMMARY_DAYS],
    queryFn: async () => {
      const res = await api.get<{ data: ApiKeyUsageSummary }>(`${basePath}/${apiKey.id}/usage/summary`, {
        params: { days: SUMMARY_DAYS },
      });
      return res.data.data;
    },
  });
  const retry = () => void summary.refetch();
  const s = summary.data;
  const errorRate = s && s.totals.requests > 0 ? Math.round((s.totals.errors / s.totals.requests) * 100) : 0;

  return (
    <div className="flex-1 space-y-6 px-6 py-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile
          size="compact"
          label="Peticiones (7 d)"
          value={s ? formatCount(s.totals.requests7d) : "—"}
          hint="Últimos 7 días"
          icon={<Activity className="h-4 w-4" />}
          isLoading={summary.isLoading}
          isError={summary.isError}
          onRetry={retry}
        />
        <StatTile
          size="compact"
          label={`Peticiones (${SUMMARY_DAYS} d)`}
          value={s ? formatCount(s.totals.requests) : "—"}
          hint={s?.totals.avgDurationMs !== null && s ? `Promedio ${formatCount(s.totals.avgDurationMs)} ms` : "Sin tráfico"}
          icon={<Timer className="h-4 w-4" />}
          isLoading={summary.isLoading}
          isError={summary.isError}
          onRetry={retry}
        />
        <StatTile
          size="compact"
          label="Errores (4xx/5xx)"
          value={s ? formatCount(s.totals.errors) : "—"}
          hint={s && s.totals.requests > 0 ? `${errorRate}% de las peticiones` : "Sin tráfico"}
          tone={s && s.totals.errors > 0 ? "warning" : "neutral"}
          icon={<AlertTriangle className="h-4 w-4" />}
          isLoading={summary.isLoading}
          isError={summary.isError}
          onRetry={retry}
        />
        <StatTile
          size="compact"
          label="Última IP"
          value={s?.lastIp ? <span className="font-mono text-base">{s.lastIp}</span> : "—"}
          hint={
            s?.lastUsedAt
              ? `${formatRelativeTime(s.lastUsedAt) ?? ""} · ${formatCount(s.distinctIps)} IP distintas`
              : "Nunca usada"
          }
          icon={<Globe className="h-4 w-4" />}
          isLoading={summary.isLoading}
          isError={summary.isError}
          onRetry={retry}
        />
      </div>

      <section aria-labelledby="usage-chart-title" className="space-y-2">
        <h3 id="usage-chart-title" className="text-sm font-semibold">
          Peticiones por día
        </h3>
        {summary.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : summary.isError ? (
          <p className="text-sm text-destructive-subtle-foreground">No se pudo cargar la gráfica.</p>
        ) : s && s.totals.requests > 0 ? (
          <DailyBars series={s.byDay} />
        ) : (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            Sin peticiones en los últimos {SUMMARY_DAYS} días. En cuanto la integración use la key verás
            aquí el tráfico diario.
          </p>
        )}
      </section>

      <Tabs defaultValue="events">
        <TabsList>
          <TabsTrigger value="events">Eventos</TabsTrigger>
          <TabsTrigger value="paths">Rutas</TabsTrigger>
          <TabsTrigger value="status">Códigos</TabsTrigger>
        </TabsList>
        <TabsContent value="events" className="pt-4">
          <EventsTable basePath={basePath} apiKeyId={apiKey.id} />
        </TabsContent>
        <TabsContent value="paths" className="pt-4">
          <PathsTable summary={summary} />
        </TabsContent>
        <TabsContent value="status" className="pt-4">
          <StatusTable summary={summary} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gráfica diaria (SVG sin dependencias)
// ---------------------------------------------------------------------------

const CHART_W = 640;
const CHART_H = 160;
const PAD_LEFT = 36;
const PAD_BOTTOM = 22;
const PAD_TOP = 8;

/**
 * Barras por día: total en tinta primaria y, apilados abajo, los errores en
 * tinta destructiva. Dos series → leyenda; cada barra lleva `<title>` con el
 * detalle, y una tabla `sr-only` la acompaña para lectores de pantalla.
 */
function DailyBars({ series }: { series: ApiKeyUsageSummary["byDay"] }) {
  const max = Math.max(1, ...series.map((d) => d.total));
  const innerW = CHART_W - PAD_LEFT - 8;
  const innerH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const slot = innerW / series.length;
  const barW = Math.max(2, slot - 2);
  const ticks = [0, Math.ceil(max / 2), max];
  // Etiquetas del eje X: primera, última y cada ~7 días, para no amontonar.
  const labelEvery = series.length > 14 ? 7 : series.length > 7 ? 3 : 1;

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label={`Peticiones por día, últimos ${series.length} días`}
        className="h-40 w-full"
      >
        {ticks.map((t) => {
          const y = PAD_TOP + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={PAD_LEFT} x2={CHART_W - 8} y1={y} y2={y} className="stroke-hairline" strokeWidth={1} />
              <text x={PAD_LEFT - 6} y={y + 3} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {formatCount(t)}
              </text>
            </g>
          );
        })}
        {series.map((d, i) => {
          const x = PAD_LEFT + i * slot + 1;
          const hTotal = (d.total / max) * innerH;
          const hErr = (d.errors / max) * innerH;
          const yTotal = PAD_TOP + innerH - hTotal;
          const yErr = PAD_TOP + innerH - hErr;
          const label = `${formatDayLabel(d.day)}: ${formatCount(d.total)} peticiones, ${formatCount(d.errors)} errores`;
          return (
            <g key={d.day}>
              <title>{label}</title>
              {/* Área de hover mayor que la barra. */}
              <rect x={x - 1} y={PAD_TOP} width={slot} height={innerH} className="fill-transparent hover:fill-muted/60" />
              {d.total > 0 ? (
                <rect x={x} y={yTotal} width={barW} height={hTotal} rx={2} className="fill-primary" />
              ) : null}
              {d.errors > 0 ? (
                <rect x={x} y={yErr} width={barW} height={hErr} rx={2} className="fill-destructive" />
              ) : null}
              {i % labelEvery === 0 || i === series.length - 1 ? (
                <text
                  x={x + barW / 2}
                  y={CHART_H - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {formatDayLabel(d.day)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-primary" />
          Peticiones
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-destructive" />
          Errores (4xx/5xx)
        </span>
      </figcaption>
      <table className="sr-only">
        <caption>Peticiones y errores por día</caption>
        <thead>
          <tr>
            <th scope="col">Día</th>
            <th scope="col">Peticiones</th>
            <th scope="col">Errores</th>
          </tr>
        </thead>
        <tbody>
          {series.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{d.total}</td>
              <td>{d.errors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------

function PathsTable({ summary }: { summary: ReturnType<typeof useQuery<ApiKeyUsageSummary>> }) {
  const columns: Array<DataTableColumn<ApiKeyUsageSummary["byPath"][number]>> = [
    {
      key: "path",
      header: "Ruta",
      cell: (r) => (
        <span className="font-mono text-xs">
          <span className="font-semibold">{r.method}</span> {r.path}
        </span>
      ),
    },
    { key: "count", header: "Peticiones", numeric: true, width: "7rem", cell: (r) => formatCount(r.count) },
    {
      key: "errors",
      header: "Errores",
      numeric: true,
      width: "6rem",
      cell: (r) =>
        r.errors > 0 ? (
          <span className="text-warning-foreground">{formatCount(r.errors)}</span>
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={summary.data?.byPath}
      getRowId={(r) => `${r.method} ${r.path}`}
      isLoading={summary.isLoading}
      isError={summary.isError}
      error={summary.error}
      onRetry={() => void summary.refetch()}
      caption="Rutas más usadas por la key"
      skeletonRows={3}
      empty={{ title: "Sin rutas", description: "Todavía no hay peticiones con esta key." }}
    />
  );
}

function StatusTable({ summary }: { summary: ReturnType<typeof useQuery<ApiKeyUsageSummary>> }) {
  const total = summary.data?.totals.requests ?? 0;
  const columns: Array<DataTableColumn<ApiKeyUsageSummary["byStatus"][number]>> = [
    {
      key: "status",
      header: "Código",
      width: "8rem",
      cell: (r) => (
        <StatusBadge status={String(r.statusCode)} label={String(r.statusCode)} tone={httpStatusTone(r.statusCode)} size="sm" />
      ),
    },
    { key: "count", header: "Peticiones", numeric: true, width: "7rem", cell: (r) => formatCount(r.count) },
    {
      key: "share",
      header: "Proporción",
      numeric: true,
      width: "7rem",
      cell: (r) => `${total > 0 ? Math.round((r.count / total) * 100) : 0}%`,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={summary.data?.byStatus}
      getRowId={(r) => String(r.statusCode)}
      isLoading={summary.isLoading}
      isError={summary.isError}
      error={summary.error}
      onRetry={() => void summary.refetch()}
      caption="Peticiones por código de respuesta"
      skeletonRows={3}
      empty={{ title: "Sin respuestas", description: "Todavía no hay peticiones con esta key." }}
    />
  );
}

/**
 * Bitácora paginada por cursor: se guarda la pila de cursores visitados para
 * poder volver atrás sin que el backend tenga que soportar páginas numeradas.
 */
function EventsTable({ basePath, apiKeyId }: { basePath: string; apiKeyId: string }) {
  const [pathFilter, setPathFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [range, setRange] = useState<RangeFilter>("7");
  const [cursors, setCursors] = useState<string[]>([]);
  const debouncedPath = useDebouncedValue(pathFilter.trim(), 300);

  // Cualquier cambio de filtro vuelve a la primera página.
  useEffect(() => {
    setCursors([]);
  }, [debouncedPath, statusFilter, range]);

  const from = useMemo(
    () => new Date(Date.now() - Number(range) * 24 * 60 * 60 * 1000).toISOString(),
    // Se recalcula solo al cambiar el rango, no en cada render.
    [range],
  );
  const cursor = cursors[cursors.length - 1];

  const page = useQuery({
    queryKey: ["api-key-usage", basePath, apiKeyId, { path: debouncedPath, status: statusFilter, from, cursor }],
    queryFn: async () => {
      const res = await api.get<UsagePage>(`${basePath}/${apiKeyId}/usage`, {
        params: {
          limit: PAGE_SIZE,
          from,
          ...(debouncedPath ? { path: debouncedPath } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(cursor ? { cursor } : {}),
        },
      });
      return res.data;
    },
    placeholderData: keepPreviousData,
  });

  const columns: Array<DataTableColumn<ApiKeyUsageEvent>> = [
    {
      key: "occurredAt",
      header: "Cuándo",
      width: "10rem",
      cell: (e) => <DateTime value={e.occurredAt} className="text-muted-foreground" />,
    },
    {
      key: "request",
      header: "Petición",
      cell: (e) => (
        <span className="flex flex-col">
          <span className="font-mono text-xs">
            <span className="font-semibold">{e.method}</span> {e.path}
          </span>
          {e.scopeUsed ? (
            <span className="font-mono text-micro text-muted-foreground">{e.scopeUsed}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "status",
      header: "Respuesta",
      width: "9rem",
      cell: (e) => (
        <span className="flex flex-col gap-0.5">
          <StatusBadge status={String(e.statusCode)} label={String(e.statusCode)} tone={httpStatusTone(e.statusCode)} size="sm" />
          {e.errorCode ? (
            <Badge variant="outline" size="sm" className="w-fit font-mono font-medium">
              {e.errorCode}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "duration",
      header: "Duración",
      numeric: true,
      width: "6rem",
      cell: (e) => `${formatCount(e.durationMs)} ms`,
    },
    {
      key: "ip",
      header: "Origen",
      width: "10rem",
      cell: (e) => (
        <span className="flex flex-col" title={e.userAgent ?? undefined}>
          <span className="font-mono text-xs">{e.ip ?? "—"}</span>
          {e.userAgent ? (
            <span className="max-w-[10rem] truncate text-micro text-muted-foreground">{e.userAgent}</span>
          ) : null}
        </span>
      ),
    },
  ];

  const nextCursor = page.data?.pageInfo.nextCursor ?? null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem]">
        <div className="space-y-1">
          <Label htmlFor="usage-path" className="text-xs">
            Ruta contiene
          </Label>
          <Input
            id="usage-path"
            value={pathFilter}
            onChange={(e) => setPathFilter(e.target.value)}
            placeholder="/api/v1/orders"
            autoComplete="off"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="usage-status" className="text-xs">
            Respuesta
          </Label>
          <Select id="usage-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="">Todas</option>
            <option value="2xx">2xx · OK</option>
            <option value="3xx">3xx · Redirección</option>
            <option value="4xx">4xx · Error del cliente</option>
            <option value="5xx">5xx · Error del servidor</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="usage-range" className="text-xs">
            Periodo
          </Label>
          <Select id="usage-range" value={range} onChange={(e) => setRange(e.target.value as RangeFilter)}>
            <option value="1">Últimas 24 h</option>
            <option value="7">Últimos 7 días</option>
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
          </Select>
        </div>
      </div>

      <div className="rounded-card border">
        <DataTable
          columns={columns}
          rows={page.data?.data}
          isLoading={page.isLoading}
          isError={page.isError}
          error={page.error}
          onRetry={() => void page.refetch()}
          caption="Bitácora de peticiones de la key"
          skeletonRows={5}
          empty={{
            icon: <Activity className="h-6 w-6" />,
            title: "Sin peticiones",
            description:
              debouncedPath || statusFilter
                ? "Ningún evento coincide con los filtros en este periodo."
                : "Esta key no ha recibido peticiones en el periodo elegido.",
          }}
          pagination={
            page.data && (page.data.data.length > 0 || cursors.length > 0) ? (
              <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs sm:px-4">
                <span className="text-muted-foreground">
                  Página {cursors.length + 1}
                  {page.isFetching ? " · actualizando…" : ""}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    disabled={cursors.length === 0 || page.isFetching}
                    onClick={() => setCursors((c) => c.slice(0, -1))}
                  >
                    <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
                    Anterior
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    disabled={!nextCursor || page.isFetching}
                    onClick={() => nextCursor && setCursors((c) => [...c, nextCursor])}
                  >
                    Siguiente
                    <ChevronRight aria-hidden className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : null
          }
        />
      </div>
      <p className="text-micro text-muted-foreground">
        Las rutas se guardan sin identificadores (<span className="font-mono">/orders/:id</span>) y sin
        query string. Pasa el cursor sobre una fecha para ver el timestamp exacto.
      </p>
    </div>
  );
}
