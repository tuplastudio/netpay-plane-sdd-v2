"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { ClientPagination, usePagination } from "@/components/app/client-pagination";
import { formatDuration, type AttentionAgentRow } from "../../_components/use-conversations";

type SortKey =
  | "agent"
  | "status"
  | "assigned"
  | "handled"
  | "closed"
  | "msgs"
  | "reply"
  | "resolution";
type Dir = "asc" | "desc";

const VALUE: Record<SortKey, (a: AttentionAgentRow) => string | number | null> = {
  agent: (a) => a.fullName.toLocaleLowerCase("es"),
  status: (a) => (a.active ? 1 : 0),
  assigned: (a) => a.assignedNow,
  handled: (a) => a.handled,
  closed: (a) => a.closed,
  msgs: (a) => a.messagesSent,
  reply: (a) => a.avgFirstReplySeconds,
  resolution: (a) => a.avgResolutionSeconds,
};

/** Orden estable; los `null` (sin dato) siempre van al final, sin importar la dirección. */
export function sortAgents(rows: AttentionAgentRow[], key: SortKey, dir: Dir): AttentionAgentRow[] {
  const get = VALUE[key];
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const a = get(x.row);
      const b = get(y.row);
      if (a === null && b === null) return x.i - y.i;
      if (a === null) return 1;
      if (b === null) return -1;
      const cmp = typeof a === "string" ? a.localeCompare(String(b), "es") : (a as number) - (b as number);
      return cmp * sign || x.i - y.i;
    })
    .map((x) => x.row);
}

const csvCell = (v: string | number | null): string => {
  if (v === null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function agentsToCsv(rows: AttentionAgentRow[]): string {
  const head = [
    "Agente",
    "Correo",
    "Activo",
    "Llevando ahora",
    "Conversaciones atendidas",
    "Cerradas",
    "Mensajes enviados",
    "1.ª respuesta prom. (s)",
    "Resolución prom. (s)",
  ];
  const lines = rows.map((a) =>
    [
      a.fullName,
      a.email,
      a.active ? "Sí" : "No",
      a.assignedNow,
      a.handled,
      a.closed,
      a.messagesSent,
      a.avgFirstReplySeconds,
      a.avgResolutionSeconds,
    ]
      .map(csvCell)
      .join(","),
  );
  return [head.map(csvCell).join(","), ...lines].join("\r\n");
}

function downloadCsv(rows: AttentionAgentRow[]) {
  // BOM para que Excel abra bien los acentos.
  const blob = new Blob(["﻿" + agentsToCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `atencion-por-agente-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
  numeric,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: Dir };
  onSort: (k: SortKey) => void;
  numeric?: boolean;
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      aria-label={`Ordenar por ${label}${active ? (sort.dir === "asc" ? ", ascendente" : ", descendente") : ""}`}
      className={`inline-flex items-center gap-1 rounded-sm uppercase tracking-wide hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        numeric ? "flex-row-reverse" : ""
      } ${active ? "text-foreground" : ""}`}
    >
      {label}
      <Icon aria-hidden className={`h-3 w-3 shrink-0 ${active ? "" : "opacity-50"}`} />
    </button>
  );
}

interface Props {
  rows: AttentionAgentRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** Cambia con los filtros: vuelve a la página 1. */
  resetKey: string;
  filtered: boolean;
}

/** "Atención por agente": orden por columna, paginado en cliente y export CSV. */
export function AgentsTable({ rows, isLoading, isError, onRetry, resetKey, filtered }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: "msgs", dir: "desc" });
  const sorted = useMemo(() => (rows ? sortAgents(rows, sort.key, sort.dir) : undefined), [rows, sort]);
  const pager = usePagination(sorted, 10);
  const { reset } = pager;
  const [lastKey, setLastKey] = useState(resetKey);
  if (lastKey !== resetKey) {
    setLastKey(resetKey);
    reset();
  }

  const onSort = (key: SortKey) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "agent" ? "asc" : "desc" },
    );
    pager.setPage(1);
  };
  const h = (label: string, k: SortKey, numeric?: boolean) => (
    <SortHeader label={label} k={k} sort={sort} onSort={onSort} numeric={numeric} />
  );

  const columns: Array<DataTableColumn<AttentionAgentRow>> = [
    {
      key: "agent",
      header: h("Agente", "agent"),
      cell: (a) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{a.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{a.email}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: h("Estado", "status"),
      cell: (a) =>
        a.active ? (
          <Badge variant="success" size="sm">
            Agente activo
          </Badge>
        ) : (
          <Badge variant="neutral" size="sm">
            Ya no es agente
          </Badge>
        ),
    },
    { key: "assigned", header: h("Llevando ahora", "assigned", true), numeric: true, cell: (a) => a.assignedNow },
    { key: "handled", header: h("Atendidas", "handled", true), numeric: true, cell: (a) => a.handled },
    { key: "closed", header: h("Cerradas", "closed", true), numeric: true, cell: (a) => a.closed },
    { key: "msgs", header: h("Mensajes", "msgs", true), numeric: true, cell: (a) => a.messagesSent },
    {
      key: "reply",
      header: h("1.ª resp. (prom.)", "reply", true),
      numeric: true,
      cell: (a) => formatDuration(a.avgFirstReplySeconds),
    },
    {
      key: "resolution",
      header: h("Resolución (prom.)", "resolution", true),
      numeric: true,
      cell: (a) => formatDuration(a.avgResolutionSeconds),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <p className="text-xs text-muted-foreground">
          Orden: <span className="font-medium text-foreground">clic en un encabezado</span>. Los
          promedios sin dato van al final.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={!sorted || sorted.length === 0}
          onClick={() => sorted && downloadCsv(sorted)}
        >
          <Download aria-hidden className="h-3.5 w-3.5" />
          Exportar CSV
        </Button>
      </div>
      <DataTable
        columns={columns}
        rows={pager.pageRows}
        getRowId={(a) => a.userId}
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        caption="Atención por agente"
        empty={{
          icon: <Users className="h-6 w-6" />,
          title: filtered ? "Ningún agente coincide con los filtros" : "Sin agentes todavía",
          description: filtered
            ? "Cambia o quita los filtros para ver al resto del equipo."
            : "Marca a las personas de tu equipo como agente en Admin › Miembros para que puedan tomar conversaciones.",
        }}
        pagination={
          <ClientPagination
            page={pager.page}
            pageSize={pager.pageSize}
            total={pager.total}
            totalPages={pager.totalPages}
            onPageChange={pager.setPage}
            onPageSizeChange={pager.setPageSize}
            noun="agentes"
          />
        }
      />
    </div>
  );
}
