"use client";
import { useCallback, useMemo, useRef, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { MessagesSquare, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { formatDate } from "@/components/app/date-time";
import {
  PRIORITY_LABELS,
  PRIORITY_TONE,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_TONE,
  firstResponseTone,
  priorityOf,
  slaOf,
  waitingTone,
} from "./ticket";
import {
  CONVERSATIONS_LIMIT,
  formatDuration,
  providerLabel,
  type Conversation,
  type ConversationList,
} from "./use-conversations";

/** "Hace 5 min" / "Hace 3 h" / fecha corta, para no repetir <DateTime> en cada fila. */
function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  return formatDate(iso);
}

/**
 * SLA de la fila: cuánto lleva el cliente sin respuesta (lo que decide a quién
 * atender primero) y, si ya hubo, cuánto tardó la primera respuesta humana.
 * Todo con `StatusBadge` + tooltip que explica de dónde sale el número.
 */
function SlaCell({ conversation }: { conversation: Conversation }) {
  const sla = slaOf(conversation);
  if (sla.status === "pending") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <StatusBadge status="PENDING" tone="warning" label="Espera al cliente" size="sm" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          Marcada como pendiente
          {conversation.pendingAt ? ` hace ${relativeTime(conversation.pendingAt)}` : ""}. Vuelve a
          la cola cuando el cliente escriba.
        </TooltipContent>
      </Tooltip>
    );
  }
  if (sla.waitingSeconds !== null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <StatusBadge
              status="WAITING"
              tone={waitingTone(sla.waitingSeconds)}
              label={`Esperando ${formatDuration(sla.waitingSeconds)}`}
              size="sm"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          El último mensaje es del cliente y nadie ha contestado. Rojo a partir de 1 h.
        </TooltipContent>
      </Tooltip>
    );
  }
  if (sla.firstResponseSeconds !== null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <StatusBadge
              status="FIRST_RESPONSE"
              tone={firstResponseTone(sla.firstResponseSeconds)}
              label={`1.ª resp. ${formatDuration(sla.firstResponseSeconds)}`}
              size="sm"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          Tiempo desde que entró a la cola humana hasta la primera respuesta de una persona.
          Verde &lt; 15 min, ámbar &lt; 1 h.
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <>
      <span aria-hidden className="text-xs text-muted-foreground">
        —
      </span>
      <span className="sr-only">Al día</span>
    </>
  );
}

/** Iniciales para el chip del agente asignado (máximo dos). */
function initialsOf(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function AssigneeCell({ conversation }: { conversation: Conversation }) {
  if (!conversation.handoffToHuman) {
    return (
      <Badge variant="neutral" size="sm">
        Bot
      </Badge>
    );
  }
  if (!conversation.handoffUser) {
    return (
      <Badge variant="warning" size="sm">
        Sin asignar
      </Badge>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={conversation.handoffUser.fullName}>
      <span
        aria-hidden
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
      >
        {initialsOf(conversation.handoffUser.fullName)}
      </span>
      <span className="truncate text-xs text-foreground">
        {conversation.handoffUser.fullName.split(" ")[0]}
      </span>
    </span>
  );
}

export interface ListSelection {
  ids: Set<string>;
  toggle: (id: string) => void;
  /** Marca o desmarca TODA la página visible. */
  setPage: (ids: string[], selected: boolean) => void;
}

/**
 * Lista de conversaciones sobre `DataTable`, la misma tabla que usan
 * catálogo/pedidos/pagos/auditoría: mismas filas enfocables de verdad (un
 * `<button>` real en la primera celda, orden de tabulación nativo, Enter/Espacio
 * activan), mismos estados de carga/error/vacío.
 *
 * Encima de eso se agrega la navegación con flechas entre filas (▲/▼ y
 * Inicio/Fin) y, con `selection`, una columna de casillas para las acciones
 * masivas (la tecla `x` marca la fila enfocada). `DataTable` ignora los clics
 * sobre `input`, así que la casilla no abre el hilo.
 *
 * Las columnas son las de una cola de tickets, y son **las mismas en todas
 * las vistas guardadas**: quién escribe, qué dijo, estado + prioridad, quién
 * lo lleva, etiquetas y SLA. Lo que cambia entre vistas es lo que se le pide
 * al API, no la tabla.
 */
export function ConversationsList({
  query,
  filtered,
  selectedId,
  onSelect,
  onClearFilters,
  rows: rowsOverride,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  renderTrailingAction,
  pagination,
  selection,
}: {
  query: UseQueryResult<ConversationList>;
  filtered: boolean;
  selectedId: string | undefined;
  onSelect: (conversation: Conversation) => void;
  onClearFilters: () => void;
  /** Vista derivada: reemplaza las filas del query tal cual. Si viene paginada
   *  (una página ya recortada), pasa también `pagination` con el control. */
  rows?: Conversation[];
  emptyTitle?: string;
  emptyDescription?: string;
  /** Ícono del estado vacío de la lista. Si no se pasa, se elige uno por filtro. */
  emptyIcon?: ReactNode;
  /** Acciones rápidas por fila, sin abrir el hilo (tomar, cerrar, reabrir). */
  renderTrailingAction?: (conversation: Conversation) => ReactNode;
  /** Control de paginación de quien llama. Reemplaza el aviso interno de tope. */
  pagination?: ReactNode;
  /** Selección múltiple para acciones masivas. Sin esto no hay casillas. */
  selection?: ListSelection;
}) {
  const rows = rowsOverride ?? query.data?.data;
  const capped = !pagination && !rowsOverride && (rows?.length ?? 0) >= CONVERSATIONS_LIMIT;
  const containerRef = useRef<HTMLDivElement>(null);

  // Roving por flechas sobre las filas ya enfocables de `DataTable`: el botón
  // de acción de fila vive siempre en la primera celda (orden del DOM), así
  // que basta con moverse de `<tr>` en `<tr>` y enfocar su primer control.
  // No reemplaza Tab/Enter/Espacio (siguen siendo nativos de `DataTable`),
  // solo añade ↑/↓/Inicio/Fin para hojear sin volver al mouse, y `x` para
  // marcar/desmarcar la fila enfocada.
  const onKeyDownNav = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const isX = e.key === "x" || e.key === "X";
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) && !isX) return;
      const container = containerRef.current;
      const active = document.activeElement as HTMLElement | null;
      if (!container || !active || !container.contains(active)) return;
      if (active.tagName === "INPUT" && (active as HTMLInputElement).type !== "checkbox") return;
      const row = active.closest("tr");
      if (!row) return;
      const allRows = Array.from(container.querySelectorAll("tbody tr"));
      const idx = allRows.indexOf(row);
      if (idx === -1) return;
      if (isX) {
        // Las filas del DOM van en el mismo orden que `rows`.
        const id = rows?.[idx]?.id;
        if (id && selection) {
          e.preventDefault();
          selection.toggle(id);
        }
        return;
      }
      let target: Element | undefined;
      if (e.key === "ArrowDown") target = allRows[idx + 1];
      else if (e.key === "ArrowUp") target = allRows[idx - 1];
      else if (e.key === "Home") target = allRows[0];
      else if (e.key === "End") target = allRows[allRows.length - 1];
      if (!target) return;
      e.preventDefault();
      (target.querySelector("button, a") as HTMLElement | null)?.focus();
    },
    [selection, rows],
  );

  const pageIds = useMemo(() => (rows ?? []).map((r) => r.id), [rows]);
  const allSelected = !!selection && pageIds.length > 0 && pageIds.every((id) => selection.ids.has(id));
  const someSelected = !!selection && pageIds.some((id) => selection.ids.has(id));

  const columns = useMemo<Array<DataTableColumn<Conversation>>>(() => {
    const base: Array<DataTableColumn<Conversation>> = [
      {
        key: "customer",
        header: "Cliente",
        cell: (c) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-xs font-medium text-foreground">
                {c.customer?.fullName ?? c.externalPhone}
              </span>
              {c.customer ? (
                <span className="shrink-0 font-mono text-code-sm text-muted-foreground">
                  {c.externalPhone}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "line-clamp-1 text-xs",
                c.unanswered && c.status !== "CLOSED" && !c.pendingAt
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {c.lastMessagePreview ?? "Sin mensajes"}
            </span>
          </div>
        ),
      },
      {
        key: "status",
        header: "Estado",
        width: "10rem",
        cell: (c) => {
          const sla = slaOf(c);
          const priority = priorityOf(c);
          return (
            <div className="flex flex-col items-start gap-1">
              <div className="flex flex-wrap items-center gap-1">
                <StatusBadge
                  status={sla.status.toUpperCase()}
                  tone={TICKET_STATUS_TONE[sla.status]}
                  label={TICKET_STATUS_LABELS[sla.status]}
                  size="sm"
                  withDot
                />
                {priority !== "NORMAL" ? (
                  <StatusBadge
                    status={priority}
                    tone={PRIORITY_TONE[priority]}
                    label={PRIORITY_LABELS[priority]}
                    size="sm"
                    withDot={false}
                  />
                ) : null}
              </div>
              <span className="text-[10px] text-muted-foreground">
                {providerLabel(c.connection.provider)}
              </span>
            </div>
          );
        },
      },
      {
        key: "assignee",
        header: "Atiende",
        width: "8rem",
        cell: (c) => <AssigneeCell conversation={c} />,
      },
      {
        key: "tags",
        header: "Etiquetas",
        width: "10rem",
        cell: (c) =>
          c.tags.length === 0 ? (
            <>
              <span aria-hidden className="text-xs text-muted-foreground">
                —
              </span>
              <span className="sr-only">Sin etiquetas</span>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-1">
              {c.tags.slice(0, 2).map((t) => (
                <Badge key={t} variant="info" size="sm">
                  {t}
                </Badge>
              ))}
              {c.tags.length > 2 ? (
                <span className="text-[10px] text-muted-foreground" title={c.tags.join(", ")}>
                  +{c.tags.length - 2}
                </span>
              ) : null}
            </div>
          ),
      },
      {
        key: "lastMessageAt",
        header: "Último mensaje",
        width: "7rem",
        cell: (c) => (
          <span className="text-xs text-muted-foreground">
            {relativeTime(c.lastMessageAt) || "—"}
          </span>
        ),
      },
      {
        key: "sla",
        header: "SLA",
        width: "10rem",
        cell: (c) => <SlaCell conversation={c} />,
      },
    ];
    if (selection) {
      base.unshift({
        key: "select",
        header: (
          <Checkbox
            aria-label={allSelected ? "Desmarcar toda la página" : "Marcar toda la página"}
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = !allSelected && someSelected;
            }}
            onChange={(e) => selection.setPage(pageIds, e.target.checked)}
          />
        ),
        width: "2.5rem",
        cell: (c) => (
          <Checkbox
            aria-label={`Marcar la conversación con ${c.customer?.fullName ?? c.externalPhone}`}
            checked={selection.ids.has(c.id)}
            onChange={() => selection.toggle(c.id)}
          />
        ),
      });
    }
    if (renderTrailingAction) {
      base.push({
        key: "actions",
        header: <span className="sr-only">Acciones</span>,
        width: "9rem",
        className: "text-right",
        cell: (c) => renderTrailingAction(c),
      });
    }
    return base;
  }, [renderTrailingAction, selection, allSelected, someSelected, pageIds]);

  return (
    <div
      ref={containerRef}
      onKeyDown={onKeyDownNav}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <DataTable
        columns={columns}
        rows={rows}
        isLoading={query.isLoading}
        // Con la bandeja en vivo (refresco cada 10 s) un tropiezo de red no
        // debe tapar las filas que ya se ven: el error a pantalla completa es
        // solo para cuando no hay nada que mostrar.
        isError={query.isError && !query.data}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={onSelect}
        getRowActionLabel={(c) =>
          `Abrir conversación con ${c.customer?.fullName ?? c.externalPhone}`
        }
        getRowClassName={(c) =>
          cn(
            c.id === selectedId && "bg-muted",
            selection?.ids.has(c.id) && "bg-brand-soft/60",
            // Prioridad urgente: borde izquierdo de estado, no relleno.
            priorityOf(c) === "URGENT" && "border-l-2 border-l-destructive",
          )
        }
        caption="Conversaciones de WhatsApp"
        skeletonRows={6}
        stickyHeader
        className="flex min-h-0 flex-1 flex-col"
        containerClassName="min-h-0 min-w-0 flex-1 overflow-auto"
        empty={{
          icon: emptyIcon ?? (filtered ? <SearchX className="h-6 w-6" /> : <MessagesSquare className="h-6 w-6" />),
          title:
            emptyTitle ?? (filtered ? "Ninguna conversación coincide" : "Sin conversaciones todavía"),
          description:
            emptyDescription ??
            (filtered
              ? "Cambia o quita los filtros para ver el resto de los hilos."
              : "En cuanto alguien escriba al número conectado, el hilo aparecerá aquí."),
          action: filtered ? (
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              Limpiar filtros
            </Button>
          ) : undefined,
        }}
        pagination={
          pagination ??
          (capped ? (
            <p className="p-3 text-center text-[11px] text-muted-foreground">
              Se muestran las {CONVERSATIONS_LIMIT} más recientes.
            </p>
          ) : undefined)
        }
      />
    </div>
  );
}
