"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface TablePagerProps {
  /** Página actual, base 1. */
  page: number;
  pageSize: number;
  /** Total de filas que devuelve el backend para el filtro actual. */
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  /** Opciones del selector de tamaño. */
  pageSizeOptions?: readonly number[];
  /** Deshabilita los botones mientras llega la siguiente página. */
  loading?: boolean;
}

/**
 * Pager por número de página para listados con `limit`/`offset` en el backend.
 * Controlado: quien lo usa (normalmente `usePagedQuery`) es dueño del estado.
 *
 * Se pinta siempre que haya al menos una fila — el "1–7 de 7" con
 * anterior/siguiente deshabilitados es la prueba visible de que el listado
 * SÍ está paginado, aunque hoy quepa completo en una página. Ocultarlo del
 * todo (como antes) dejaba a quien mira la pantalla sin forma de distinguir
 * "no hay más páginas" de "esto no pagina".
 */
export function TablePager({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  loading = false,
}: TablePagerProps) {
  if (total <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);
  const atStart = current <= 1;
  const atEnd = current >= totalPages;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs sm:px-4">
      <span className="text-muted-foreground">
        <span className="tabular-nums">{from}</span>–<span className="tabular-nums">{to}</span> de{" "}
        <span className="tabular-nums">{total}</span>
      </span>

      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange ? (
          <label className="flex items-center gap-1.5 text-muted-foreground">
            Por página
            <div className="w-16">
              <Select
                value={String(pageSize)}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="h-7 pl-2 pr-6 text-xs sm:h-7 sm:text-xs"
                aria-label="Filas por página"
              >
                {pageSizeOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
          </label>
        ) : null}

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={atStart || loading}
            onClick={() => onPageChange(1)}
            aria-label="Primera página"
          >
            <ChevronsLeft aria-hidden className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2"
            disabled={atStart || loading}
            onClick={() => onPageChange(current - 1)}
          >
            <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
            Anterior
          </Button>
          <span className="px-1 tabular-nums text-muted-foreground">
            Página {current} de {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2"
            disabled={atEnd || loading}
            onClick={() => onPageChange(current + 1)}
          >
            Siguiente
            <ChevronRight aria-hidden className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={atEnd || loading}
            onClick={() => onPageChange(totalPages)}
            aria-label="Última página"
          >
            <ChevronsRight aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
