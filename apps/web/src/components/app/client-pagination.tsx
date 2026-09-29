"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

/**
 * Estado de paginado en cliente sobre un arreglo ya completo en memoria.
 * `reset()` vuelve a la página 1 (llamarlo cuando cambian filtros u orden).
 */
export function usePagination<T>(rows: T[] | undefined, initialSize = 10) {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(initialSize);
  const total = rows?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  const pageRows = React.useMemo(
    () => rows?.slice((current - 1) * pageSize, current * pageSize),
    [rows, current, pageSize],
  );
  return {
    page: current,
    pageSize,
    total,
    totalPages,
    pageRows,
    setPage,
    setPageSize: (n: number) => {
      setPageSize(n);
      setPage(1);
    },
    reset: () => setPage(1),
  };
}

export interface ClientPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  /** Sustantivo en plural para "N resultados". */
  noun?: string;
}

/** Pie de tabla por número de página (anterior/siguiente + tamaño). No se muestra con 0 filas. */
export function ClientPagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  noun = "resultados",
}: ClientPaginationProps) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs">
      <span className="text-muted-foreground">
        <span className="tabular-nums">{from}</span>–<span className="tabular-nums">{to}</span> de{" "}
        <span className="tabular-nums">{total}</span> {noun}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange ? (
          <label className="flex items-center gap-1.5 text-muted-foreground">
            Por página
            <Select
              value={String(pageSize)}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-8 w-20 text-xs"
              aria-label="Filas por página"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-2"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
          Anterior
        </Button>
        <span className="tabular-nums text-muted-foreground">
          Página {page} de {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-2"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Siguiente
          <ChevronRight aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
