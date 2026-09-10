"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface DataTableColumn<T> {
  /** Identificador estable de la columna. Se usa como `key` de React. */
  key: string;
  /** Encabezado. String o nodo (p. ej. un botón de orden). */
  header: React.ReactNode;
  /** Columna de importes o conteos: alineada a la derecha, cifras tabulares. */
  numeric?: boolean;
  /** Ancho fijo/máximo de la columna, tal cual va a `style.width` ("8rem", "15%"). */
  width?: string;
  /** Clases extra para las celdas de esta columna (no para el encabezado). */
  className?: string;
  /** Contenido de la celda para una fila. */
  cell: (row: T) => React.ReactNode;
}

export interface DataTableEmpty {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

export interface DataTableProps<T> {
  columns: Array<DataTableColumn<T>>;
  rows: T[] | undefined;
  /** Estado vacío. Obligatorio: una lista vacía sin explicación es un bug de UX. */
  empty: DataTableEmpty;

  // --- estado de la query (TanStack Query) ---
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;

  /**
   * Identidad de la fila. Por defecto usa `row.id` y cae al índice.
   * Pásalo si tus filas no tienen `id`.
   */
  getRowId?: (row: T, index: number) => string;
  /**
   * Si devuelve una ruta, la fila entera navega ahí: clic en cualquier parte,
   * Enter/Espacio con teclado, y la primera celda lleva un `<Link>` real para
   * que el foco, el "abrir en pestaña nueva" y los lectores de pantalla
   * funcionen. Sin esto la fila se rinde plana.
   */
  getRowHref?: (row: T) => string | undefined;
  /**
   * Fila interactiva que NO navega: abre un Sheet, selecciona, expande.
   * La primera celda lleva un `<button>` real, así que Enter/Espacio, el foco
   * y el nombre accesible funcionan sin inventar un `role` falso en el `<tr>`.
   *
   * Mutuamente excluyente con `getRowHref`: si pasas ambos gana `getRowHref`,
   * porque una ruta es enlazable y compartible y un handler no.
   */
  onRowClick?: (row: T) => void;
  /**
   * Nombre accesible del control de fila (`getRowHref` o `onRowClick`).
   * Si lo omites, el contenido de la primera celda nombra el control, que suele
   * ser lo correcto (el SKU, el folio). Pásalo cuando esa celda no sea un
   * nombre útil: `(p) => \`Editar ${p.sku}\``.
   */
  getRowActionLabel?: (row: T) => string;
  /** Clases por fila, para resaltar filas canceladas o vencidas. */
  getRowClassName?: (row: T) => string | undefined;

/** Resumen de la tabla para lectores de pantalla (`<caption>`). */
  caption?: React.ReactNode;
  /** Muestra el `<caption>` en pantalla en vez de solo para lectores. */
  visibleCaption?: boolean;
  /** Bloque opcional debajo de la tabla (típicamente `DataTablePagination`). */
  pagination?: React.ReactNode;
  /** Fija el encabezado. Requiere acotar la altura con `containerClassName`. */
  stickyHeader?: boolean;
  /** Filas fantasma mientras carga. */
  skeletonRows?: number;
  className?: string;
  containerClassName?: string;
}

function defaultRowId(row: unknown, index: number): string {
  const id = (row as { id?: unknown } | null)?.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : String(index);
}

function errorMessage(error: unknown): string {
  const detail = (
    error as { response?: { data?: { message?: string; error?: { message?: string } } } } | null
  )?.response?.data;
  if (detail?.message) return detail.message;
  if (detail?.error?.message) return detail.error.message;
  return error instanceof Error ? error.message : "";
}

/**
 * Tabla de lista con los cuatro estados de una query resueltos en un solo lugar:
 * cargando (skeleton), error (`Alert` + reintentar), vacío (`EmptyState`) y
 * datos. Es el componente base de TODAS las pantallas de listado del portal;
 * si necesitas algo que no expone, pídelo antes de escribir un `<table>` a mano.
 *
 * Precedencia de estados: error > cargando > vacío > datos. Un error se muestra
 * aunque haya datos viejos en caché, para que nadie opere sobre datos rancios.
 *
 * @example
 * const q = useQuery({ queryKey: ["orders"], queryFn: fetchOrders });
 *
 * const columns: Array<DataTableColumn<Order>> = [
 *   { key: "id", header: "ID", width: "8rem",
 *     cell: (o) => <span className="font-mono text-xs">{o.id.slice(0, 8)}…</span> },
 *   { key: "customer", header: "Cliente", cell: (o) => o.customer.fullName },
 *   { key: "status", header: "Estado",
 *     cell: (o) => <StatusBadge status={o.status} domain="order" /> },
 *   { key: "total", header: "Total", numeric: true,
 *     cell: (o) => <Money value={o.total} /> },
 *   { key: "paidAt", header: "Pagado",
 *     cell: (o) => <DateTime value={o.paidAt} className="text-muted-foreground" /> },
 * ];
 *
 * <Section title="Pedidos" padded={false}>
 *   <DataTable
 *     columns={columns}
 *     rows={q.data}
 *     isLoading={q.isLoading}
 *     isError={q.isError}
 *     error={q.error}
 *     onRetry={() => void q.refetch()}
 *     getRowHref={(o) => `/orders/${o.id}`}
 *     caption="Pedidos del comercio"
 *     empty={{
 *       icon: <PackageOpen className="h-6 w-6" />,
 *       title: "Sin pedidos",
 *       description: "Cuando entre la primera venta la verás aquí.",
 *     }}
 *   />
 * </Section>
 */
export function DataTable<T>({
  columns,
  rows,
  empty,
  isLoading = false,
  isError = false,
  error,
  onRetry,
  getRowId = defaultRowId,
  getRowHref,
  onRowClick,
  getRowActionLabel,
  getRowClassName,
  caption,
  visibleCaption = false,
  stickyHeader = false,
  skeletonRows = 5,
  className,
  containerClassName,
  pagination,
}: DataTableProps<T>) {
  const router = useRouter();

  // --- error -------------------------------------------------------------
  if (isError) {
    const detail = errorMessage(error);
    return (
      <div className="p-4 sm:p-6">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>No se pudo cargar la información</AlertTitle>
          <AlertDescription>
            <p>{detail || "Ocurrió un error inesperado. Inténtalo de nuevo."}</p>
            {onRetry ? (
              <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
                Reintentar
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const header = (
    <TableHeader>
      <TableRow interactive={false}>
        {columns.map((col) => (
          <TableHead
            key={col.key}
            numeric={col.numeric}
            style={col.width ? { width: col.width } : undefined}
          >
            {col.header}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );

  const captionNode = caption ? (
    <TableCaption className={visibleCaption ? undefined : "sr-only"}>{caption}</TableCaption>
  ) : null;

  // --- cargando ----------------------------------------------------------
  if (isLoading) {
    return (
      <div role="status" aria-live="polite" aria-busy>
        <span className="sr-only">Cargando…</span>
        <Table
          className={className}
          containerClassName={containerClassName}
          stickyHeader={stickyHeader}
        >
          {captionNode}
          {header}
          <TableBody>
            {Array.from({ length: skeletonRows }, (_, r) => (
              <TableRow key={r} interactive={false}>
                {columns.map((col, c) => (
                  <TableCell key={col.key} numeric={col.numeric}>
                    <Skeleton
                      className={cn("h-4", col.numeric ? "ml-auto w-16" : c === 0 ? "w-24" : "w-32")}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  // --- vacío -------------------------------------------------------------
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        icon={empty.icon}
        title={empty.title}
        description={empty.description}
        action={empty.action}
      />
    );
  }

  // --- datos -------------------------------------------------------------
  const tableNode = (
    <Table className={className} containerClassName={containerClassName} stickyHeader={stickyHeader}>
      {captionNode}
      {header}
      <TableBody>
        {rows.map((row, index) => {
          const id = getRowId(row, index);
          // `getRowHref` gana sobre `onRowClick`: una ruta es enlazable,
          // compartible y abrible en otra pestaña; un handler no.
          const href = getRowHref?.(row);
          const clickable = !href && Boolean(onRowClick);
          const interactive = Boolean(href) || clickable;

          // En ambos modos interactivos el elemento enfocable es un control
          // real (<Link> o <button>) dentro de la primera celda, no un <tr>
          // con role inventado: así el teclado, el foco y el lector de
          // pantalla se comportan como el usuario espera.
          const focusRing =
            "block w-full rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1";

          return (
            <TableRow
              key={id}
              className={cn(interactive && "cursor-pointer", getRowClassName?.(row))}
              onClick={
                interactive
                  ? (event) => {
                      // No secuestrar clics sobre controles propios de la fila.
                      const target = event.target as HTMLElement;
                      if (target.closest("a,button,input,select,textarea,[role='button']")) return;
                      if (href) router.push(href);
                      else onRowClick?.(row);
                    }
                  : undefined
              }
            >
              {columns.map((col, c) => {
                const content = col.cell(row);
                const isFirst = c === 0;
                return (
                  <TableCell key={col.key} numeric={col.numeric} className={col.className}>
                    {href && isFirst ? (
                      <Link
                        href={href}
                        aria-label={getRowActionLabel?.(row)}
                        className={cn(focusRing, col.numeric ? "text-right" : "text-left")}
                      >
                        {content}
                      </Link>
                    ) : clickable && isFirst ? (
                      <button
                        type="button"
                        onClick={() => onRowClick?.(row)}
                        // Sin `aria-label` explícito, el contenido de la celda
                        // (el SKU, el folio) nombra el botón. Solo lo pisamos
                        // si el llamador dio algo mejor.
                        aria-label={getRowActionLabel?.(row)}
                        className={cn(focusRing, col.numeric ? "text-right" : "text-left")}
                      >
                        {content}
                      </button>
                    ) : (
                      content
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  return pagination ? (
    <div className={cn("flex flex-col", className)}>
      {tableNode}
      {pagination}
    </div>
  ) : (
    tableNode
  );
}
