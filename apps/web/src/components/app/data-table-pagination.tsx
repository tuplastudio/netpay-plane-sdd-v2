"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export interface PageInfo {
  nextCursor: string | null;
  size: number;
}

export interface PaginationProps {
  /** Cursor actual de la página que se está viendo. `null` = primera página. */
  cursor: string | null;
  /** Información de la página devuelta por el backend. */
  pageInfo: PageInfo | undefined;
  /** Tamaño de página activo (lo que se manda al backend como `limit`). */
  pageSize: number;
  loading?: boolean;
  /** Se llama cuando cambia cursor o tamaño. */
  onChange: (next: { cursor: string | null; pageSize: number }) => void;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

/**
 * Controles cursor-based. No hay "página N de M": solo "atrás / siguiente"
 * porque el cursor es opaco y el backend decide cuántos quedan. Cuando
 * `nextCursor` es `null` no hay más; cuando `cursor` es `null` no hay
 * anterior.
 */
export function DataTablePagination({
  cursor,
  pageInfo,
  pageSize,
  loading,
  onChange,
}: PaginationProps) {
  const hasPrev = !!cursor;
  const hasNext = !!pageInfo?.nextCursor;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm sm:px-6">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="tabular-nums">{pageInfo?.size ?? 0}</span>
        <span>resultados</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Por página
          <Select
            value={String(pageSize)}
            onChange={(e) => onChange({ cursor: null, pageSize: Number(e.target.value) })}
            className="h-8 w-20"
            aria-label="Tamaño de página"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasPrev || loading}
            onClick={() => onChange({ cursor: null, pageSize })}
          >
            <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
            Primera
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasNext || loading}
            onClick={() => onChange({ cursor: pageInfo?.nextCursor ?? null, pageSize })}
          >
            Siguiente
            <ChevronRight aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}