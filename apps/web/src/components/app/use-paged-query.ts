"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PAGE_SIZE_OPTIONS, type TablePagerProps } from "./table-pager";

/**
 * Página que conviene precargar tras pintar `page`: la siguiente, si existe.
 * `null` cuando ya es la última (o no hay total fiable). Pura, para probarla.
 */
export function nextPageToPrefetch(page: number, total: number, pageSize: number): number | null {
  if (!Number.isFinite(total) || total <= 0 || pageSize <= 0) return null;
  const totalPages = Math.ceil(total / pageSize);
  return page < totalPages ? page + 1 : null;
}

/** Forma que devuelven los listados paginados de commerce-api. */
export interface PagedResponse<T> {
  data: T[];
  pageInfo?: { total: number; limit: number; offset: number };
}

export interface UsePagedQueryOptions {
  /** Prefijo del `queryKey`, p. ej. `["orders"]`. Se le agregan filtros, página y tamaño. */
  key: readonly unknown[];
  /** Ruta relativa al cliente `api` (`/orders`). */
  path: string;
  /**
   * Filtros que van al backend como query params (`q`, `status`…). Al cambiar
   * (por valor) la página vuelve a 1. Los `undefined`/"" no se mandan.
   */
  params?: Record<string, string | number | boolean | undefined | null>;
  defaultPageSize?: number;
  /** Prefijo de los params de URL cuando hay dos tablas en una pantalla (`ledger` → `ledger_page`). */
  urlPrefix?: string;
  enabled?: boolean;
}

/**
 * Listado con paginación en el servidor (`limit`/`offset`) y estado en la URL
 * (`?page=&size=`), para que "atrás" y los links compartidos conserven la
 * página. Vuelve a la página 1 cuando cambian los filtros; conserva la página
 * anterior visible mientras llega la siguiente (`keepPreviousData`).
 *
 * Tolera un backend viejo sin `pageInfo`: `paged` queda en `false` y la
 * pantalla no debe pintar el pager (el total sería inventado).
 */
export function usePagedQuery<T>({
  key,
  path,
  params,
  defaultPageSize = 25,
  urlPrefix = "",
  enabled = true,
}: UsePagedQueryOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const pageKey = urlPrefix ? `${urlPrefix}_page` : "page";
  const sizeKey = urlPrefix ? `${urlPrefix}_size` : "size";

  const rawPage = Number(searchParams.get(pageKey));
  const rawSize = Number(searchParams.get(sizeKey));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(rawSize)
    ? rawSize
    : defaultPageSize;

  const cleanParams = useMemo(() => {
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== null && v !== "") out[k] = v;
    }
    return out;
  }, [params]);
  const filterSignature = JSON.stringify(cleanParams);

  const setUrl = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Cambió un filtro → página 1 (no en el primer render: ahí se respeta la URL).
  const lastSignature = useRef(filterSignature);
  useEffect(() => {
    if (lastSignature.current === filterSignature) return;
    lastSignature.current = filterSignature;
    if (page !== 1) setUrl({ [pageKey]: null });
    // Solo reacciona a los filtros.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSignature]);

  const queryClient = useQueryClient();
  const fetchPage = useCallback(
    async (p: number): Promise<PagedResponse<T>> => {
      const res = await api.get<PagedResponse<T>>(path, {
        params: { ...cleanParams, limit: pageSize, offset: (p - 1) * pageSize },
      });
      return res.data;
    },
    [path, cleanParams, pageSize],
  );

  const query = useQuery({
    queryKey: [...key, cleanParams, page, pageSize],
    queryFn: () => fetchPage(page),
    placeholderData: keepPreviousData,
    enabled,
  });

  const rows = query.data?.data;
  const paged = query.data?.pageInfo !== undefined;
  const total = query.data?.pageInfo?.total ?? rows?.length ?? 0;

  // Precarga la página siguiente en cuanto llega la actual: "Siguiente" pinta
  // al instante desde caché. Comparte `queryKey` con la consulta real, así
  // que no se duplica la petición cuando el usuario avanza.
  useEffect(() => {
    if (!enabled || !paged || query.isFetching) return;
    const next = nextPageToPrefetch(page, total, pageSize);
    if (next === null) return;
    void queryClient.prefetchQuery({
      queryKey: [...key, cleanParams, next, pageSize],
      queryFn: () => fetchPage(next),
    });
    // `key` es un literal estable del llamador; se usa la firma de filtros.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, paged, query.isFetching, page, total, pageSize, filterSignature, fetchPage, queryClient]);

  // Quedó fuera de rango (se borraron filas, el total encogió): ir a la última.
  useEffect(() => {
    if (!paged || query.isFetching) return;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (page > totalPages) setUrl({ [pageKey]: totalPages <= 1 ? null : String(totalPages) });
  }, [paged, query.isFetching, total, pageSize, page, pageKey, setUrl]);

  const pagerProps: TablePagerProps = {
    page,
    pageSize,
    total,
    loading: query.isFetching,
    onPageChange: (p) => setUrl({ [pageKey]: p <= 1 ? null : String(p) }),
    onPageSizeChange: (s) =>
      setUrl({ [sizeKey]: s === defaultPageSize ? null : String(s), [pageKey]: null }),
  };

  return {
    rows,
    total,
    paged,
    page,
    pageSize,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isFetching: query.isFetching,
    refetch: query.refetch,
    pagerProps,
  };
}
