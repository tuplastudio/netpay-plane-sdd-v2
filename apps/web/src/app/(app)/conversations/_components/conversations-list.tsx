"use client";
import { useCallback, useMemo, useRef, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { MessagesSquare, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import {
  CONVERSATIONS_LIMIT,
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
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

/** Horas transcurridas desde una fecha ISO, o null si no hay/está rota. */
function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / 3_600_000;
}

/**
 * Tiempo de espera: cuánto lleva el cliente sin respuesta. Es lo más cercano a
 * un SLA de primera respuesta que se puede calcular con lo que hay, y es la
 * columna que decide a quién atender primero.
 *
 * Solo aplica a hilos sin responder y no cerrados: un hilo ya contestado no
 * "espera" nada, y uno cerrado tampoco. Rojo a partir de una hora, ámbar antes.
 */
function WaitingCell({ conversation }: { conversation: Conversation }) {
  const waiting = conversation.unanswered && conversation.status !== "CLOSED";
  if (!waiting) {
    return (
      <>
        <span aria-hidden className="text-xs text-muted-foreground">
          —
        </span>
        <span className="sr-only">Sin pendientes</span>
      </>
    );
  }
  const hours = hoursSince(conversation.lastInboundAt ?? conversation.lastMessageAt);
  const urgent = hours !== null && hours >= 1;
  const label = relativeTime(conversation.lastInboundAt ?? conversation.lastMessageAt);
  return (
    <Badge variant={urgent ? "destructive" : "warning"} size="sm">
      {label ? `Esperando ${label}` : "Sin responder"}
    </Badge>
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
        Agente
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

/**
 * Lista de conversaciones sobre `DataTable`, la misma tabla que usan
 * catálogo/pedidos/pagos/auditoría: mismas filas enfocables de verdad (un
 * `<button>` real en la primera celda, orden de tabulación nativo, Enter/Espacio
 * activan), mismos estados de carga/error/vacío.
 *
 * Encima de eso se agrega la navegación con flechas entre filas (▲/▼ y
 * Inicio/Fin): `DataTable` no la trae porque la mayoría de sus tablas viven en
 * páginas con scroll de la ventana, no en un panel de bandeja donde tiene
 * sentido "hojear" con el teclado sin soltar las manos del home row.
 *
 * Las columnas son las de una cola de tickets, y son **las mismas en las tres
 * vistas guardadas** (Bandeja / Cola / Por agente): quién escribe, qué dijo,
 * quién lo lleva, con qué etiquetas y cuánto lleva esperando. Lo que cambia
 * entre vistas es el `assignee` que se le pide al API, no la tabla.
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
}: {
  query: UseQueryResult<ConversationList>;
  filtered: boolean;
  selectedId: string | undefined;
  onSelect: (conversation: Conversation) => void;
  onClearFilters: () => void;
  /** Vista derivada: reemplaza las filas del query tal cual. */
  rows?: Conversation[];
  emptyTitle?: string;
  emptyDescription?: string;
  /** Ícono del estado vacío de la lista. Si no se pasa, se elige uno por filtro. */
  emptyIcon?: ReactNode;
  /** Acciones rápidas por fila, sin abrir el hilo (tomar, cerrar, reabrir). */
  renderTrailingAction?: (conversation: Conversation) => ReactNode;
}) {
  const rows = rowsOverride ?? query.data?.data;
  const capped = !rowsOverride && (rows?.length ?? 0) >= CONVERSATIONS_LIMIT;
  const containerRef = useRef<HTMLDivElement>(null);

  // Roving por flechas sobre las filas ya enfocables de `DataTable`: el botón
  // de acción de fila vive siempre en la primera celda (orden del DOM), así
  // que basta con moverse de `<tr>` en `<tr>` y enfocar su primer control.
  // No reemplaza Tab/Enter/Espacio (siguen siendo nativos de `DataTable`),
  // solo añade ↑/↓/Inicio/Fin para hojear sin volver al mouse.
  const onKeyDownNav = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const container = containerRef.current;
    const active = document.activeElement as HTMLElement | null;
    if (!container || !active || !container.contains(active)) return;
    const row = active.closest("tr");
    if (!row) return;
    const allRows = Array.from(container.querySelectorAll("tbody tr"));
    const idx = allRows.indexOf(row);
    if (idx === -1) return;
    let target: Element | undefined;
    if (e.key === "ArrowDown") target = allRows[idx + 1];
    else if (e.key === "ArrowUp") target = allRows[idx - 1];
    else if (e.key === "Home") target = allRows[0];
    else if (e.key === "End") target = allRows[allRows.length - 1];
    if (!target) return;
    e.preventDefault();
    (target.querySelector("button, a") as HTMLElement | null)?.focus();
  }, []);

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
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {c.externalPhone}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "line-clamp-1 text-xs",
                c.unanswered && c.status !== "CLOSED"
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
        width: "9rem",
        cell: (c) => (
          <div className="flex flex-col items-start gap-1">
            <StatusBadge status={c.status} domain="conversation" withDot />
            <span className="text-[10px] text-muted-foreground">
              {providerLabel(c.connection.provider)}
            </span>
          </div>
        ),
      },
      {
        key: "assignee",
        header: "Asignado",
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
        key: "waiting",
        header: "Espera",
        width: "9rem",
        cell: (c) => <WaitingCell conversation={c} />,
      },
    ];
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
  }, [renderTrailingAction]);

  return (
    <div
      ref={containerRef}
      onKeyDown={onKeyDownNav}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <DataTable
        columns={columns}
        rows={rows}
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={onSelect}
        getRowActionLabel={(c) =>
          `Abrir conversación con ${c.customer?.fullName ?? c.externalPhone}`
        }
        getRowClassName={(c) => cn(c.id === selectedId && "bg-muted")}
        caption="Conversaciones de WhatsApp"
        skeletonRows={6}
        stickyHeader
        className="flex min-h-0 flex-1 flex-col"
        containerClassName="min-h-0 flex-1 overflow-y-auto"
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
          capped ? (
            <p className="p-3 text-center text-[11px] text-muted-foreground">
              Se muestran las {CONVERSATIONS_LIMIT} más recientes.
            </p>
          ) : undefined
        }
      />
    </div>
  );
}
