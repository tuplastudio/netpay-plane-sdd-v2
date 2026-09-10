"use client";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_FILTERS,
  type ConversationFilters,
  type ConversationStatus,
  type HandoffFilter,
  type RangeFilter,
} from "./use-conversations";

const HANDOFF_VALUES: HandoffFilter[] = ["all", "agent", "human"];
const STATUS_VALUES: ConversationStatus[] = ["OPEN", "HANDED_OFF", "CLOSED"];
const PROVIDER_VALUES = ["META", "EVOLUTION"];
const RANGE_VALUES: RangeFilter[] = ["all", "today", "7d", "30d"];

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** Lee los filtros de la URL. Un valor inválido cae al default, no rompe. */
export function parseFilters(params: URLSearchParams): ConversationFilters {
  return {
    q: params.get("q")?.trim() ?? "",
    handoff: oneOf(params.get("handoff"), HANDOFF_VALUES, DEFAULT_FILTERS.handoff),
    status: oneOf(params.get("status"), STATUS_VALUES, "" as ConversationStatus | ""),
    provider: oneOf(params.get("provider"), PROVIDER_VALUES, ""),
    range: oneOf(params.get("range"), RANGE_VALUES, DEFAULT_FILTERS.range),
  };
}

export function isFiltered(filters: ConversationFilters): boolean {
  return (Object.keys(DEFAULT_FILTERS) as Array<keyof ConversationFilters>).some(
    (k) => filters[k] !== DEFAULT_FILTERS[k],
  );
}

/**
 * Filtros de la bandeja como estado en la URL (`?q=&handoff=&status=…`), como
 * las pestañas de Admin: pegar el link abre la bandeja ya filtrada y "atrás"
 * no acumula entradas porque se usa `router.replace`. Los valores por defecto
 * se quitan de la URL para que `/conversations` a secas siga siendo la
 * dirección canónica.
 */
export function useConversationFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);

  const setFilters = useCallback(
    (patch: Partial<ConversationFilters>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch) as Array<
        [keyof ConversationFilters, ConversationFilters[keyof ConversationFilters]]
      >) {
        if (!value || value === DEFAULT_FILTERS[key]) next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const clearFilters = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  return { filters, setFilters, clearFilters, filtered: isFiltered(filters) };
}
