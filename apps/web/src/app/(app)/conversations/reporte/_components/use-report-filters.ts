"use client";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AttentionQuery } from "../../_components/use-conversations";

export type Preset = "today" | "7d" | "30d" | "90d" | "custom";
export type Provider = "META" | "EVOLUTION";

export const PRESETS: Array<{ value: Exclude<Preset, "custom">; label: string; days: number }> = [
  { value: "today", label: "Hoy", days: 0 },
  { value: "7d", label: "Últimos 7 días", days: 7 },
  { value: "30d", label: "Últimos 30 días", days: 30 },
  { value: "90d", label: "Últimos 90 días", days: 90 },
];

export interface ReportFilters {
  preset: Preset;
  /** YYYY-MM-DD, solo con `preset=custom`. */
  from: string;
  to: string;
  agent: string;
  provider: "" | Provider;
}

const DEFAULTS: ReportFilters = { preset: "30d", from: "", to: "", agent: "", provider: "" };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

function localMidnight(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

export function parseFilters(p: URLSearchParams): ReportFilters {
  const preset = p.get("preset");
  const from = p.get("from") ?? "";
  const to = p.get("to") ?? "";
  const agent = p.get("agent") ?? "";
  const provider = p.get("provider");
  return {
    preset:
      preset === "today" || preset === "7d" || preset === "90d" || preset === "custom"
        ? preset
        : "30d",
    from: DATE_RE.test(from) ? from : "",
    to: DATE_RE.test(to) ? to : "",
    agent: UUID_RE.test(agent) ? agent : "",
    provider: provider === "META" || provider === "EVOLUTION" ? provider : "",
  };
}

/** Error de validación del rango personalizado, o null si se puede consultar. */
export function rangeError(f: ReportFilters): string | null {
  if (f.preset !== "custom") return null;
  if (!f.from || !f.to) return "Elige fecha de inicio y de fin.";
  const a = localMidnight(f.from).getTime();
  const b = localMidnight(f.to).getTime();
  if (a > b) return "La fecha de inicio debe ser anterior o igual a la de fin.";
  if ((b - a) / DAY_MS + 1 > MAX_DAYS) return `El rango no puede pasar de ${MAX_DAYS} días.`;
  return null;
}

/** Rango ISO [from, to) para el API; el fin del personalizado es inclusivo (día completo). */
export function rangeOf(f: ReportFilters, now = new Date()): { from: string; to: string } {
  if (f.preset === "custom" && !rangeError(f)) {
    const to = localMidnight(f.to);
    to.setDate(to.getDate() + 1);
    return { from: localMidnight(f.from).toISOString(), to: to.toISOString() };
  }
  const preset = PRESETS.find((x) => x.value === f.preset) ?? PRESETS[2]!;
  const to = new Date(now.getTime() + 60_000);
  const from = new Date(now);
  if (preset.days === 0) from.setHours(0, 0, 0, 0);
  else from.setTime(now.getTime() - preset.days * DAY_MS);
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * Filtros del reporte en la URL (`?preset=&from=&to=&agent=&provider=`), igual
 * que la bandeja: se pueden compartir y "atrás" no acumula (`router.replace`).
 */
export function useReportFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);

  const setFilters = useCallback(
    (patch: Partial<ReportFilters>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch) as Array<[keyof ReportFilters, string]>) {
        if (!value || value === DEFAULTS[key]) next.delete(key);
        else next.set(key, value);
      }
      // Fuera del modo personalizado las fechas no significan nada.
      if ((patch.preset ?? filters.preset) !== "custom") {
        next.delete("from");
        next.delete("to");
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [filters.preset, pathname, router, searchParams],
  );

  const clear = useCallback(() => router.replace(pathname, { scroll: false }), [pathname, router]);

  const isFiltered =
    filters.preset !== DEFAULTS.preset || filters.agent !== "" || filters.provider !== "";

  const error = rangeError(filters);
  // Se recalcula solo si cambian los filtros (no en cada render): un `to` que
  // avanzara con el reloj cambiaría la queryKey y dispararía un fetch por render.
  const range = useMemo(() => rangeOf(filters), [filters]);
  const query: AttentionQuery = useMemo(
    () => ({
      ...range,
      agentId: filters.agent || undefined,
      provider: filters.provider || undefined,
    }),
    [range, filters.agent, filters.provider],
  );

  return { filters, setFilters, clear, isFiltered, error, query };
}
