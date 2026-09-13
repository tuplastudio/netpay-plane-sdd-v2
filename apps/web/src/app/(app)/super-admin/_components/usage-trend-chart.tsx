"use client";

import Link from "next/link";
import { ArrowRight, BarChart3 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/app/money";
import { cn } from "@/lib/utils";

interface UsageTrendPoint {
  day: string;
  events: number;
  tokens: number;
  costUsd: string;
}

/**
 * Gráfico SVG inline (sin libs externas) de la serie de uso de los últimos
 * 7 días. Cada barra es un día, con la altura proporcional al costo. El
 * valor máximo (pico) queda pintado en `primary` para darle peso visual.
 *
 * Se eligió SVG antes que Canvas/Recharts porque es server-renderizable
 * (no requiere JS para verse) y porque los datos siempre son 7 puntos
 * como máximo: cualquier librería pesada sería más ruido que beneficio.
 */
export function UsageTrendChart({
  data,
  isLoading,
  isError,
  onRetry,
}: {
  data: UsageTrendPoint[];
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-7 items-end gap-2 px-1 pt-2" aria-label="Cargando tendencia de uso…">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-md" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <BarChart3 aria-hidden className="h-6 w-6" />
        <p>No se pudo cargar la tendencia.</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="text-xs text-primary underline-offset-4 hover:underline"
          >
            Reintentar
          </button>
        ) : null}
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Sin actividad en los últimos 7 días.
      </div>
    );
  }

  const maxCost = data.reduce((acc, p) => Math.max(acc, Number(p.costUsd)), 0);
  const totalCost = data.reduce((acc, p) => acc + Number(p.costUsd), 0);
  const totalTokens = data.reduce((acc, p) => acc + p.tokens, 0);
  const totalEvents = data.reduce((acc, p) => acc + p.events, 0);

  return (
    <div className="space-y-3">
      {/* Resumen arriba. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          7 días: <Money value={totalCost.toFixed(6)} currency="USD" /> ·{" "}
          {totalEvents.toLocaleString("es-MX")} turnos · {totalTokens.toLocaleString("es-MX")} tokens
        </span>
      </div>

      {/* Barras. */}
      <div className="grid grid-cols-7 items-end gap-2 pt-1" aria-label="Tendencia de gasto del agente">
        {data.map((p, idx) => {
          const cost = Number(p.costUsd);
          const ratio = maxCost > 0 ? cost / maxCost : 0;
          const isPeak = cost > 0 && cost === maxCost;
          const heightPx = Math.max(8, Math.round(ratio * 96));
          const label = formatDayLabel(p.day);
          return (
            <div key={p.day} className="flex flex-col items-center gap-1">
              <div className="relative flex h-24 w-full items-end justify-center">
                <div
                  className={cn(
                    "w-full rounded-t-md transition-[height,background-color]",
                    cost > 0 ? "bg-primary/20" : "bg-muted",
                    isPeak && "bg-primary",
                  )}
                  style={{ height: `${heightPx}px` }}
                  aria-hidden
                />
                <span
                  className={cn(
                    "absolute -top-4 text-[10px] font-medium tabular-nums",
                    isPeak ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {cost > 0 ? compactCost(p.costUsd) : "—"}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground" aria-hidden>
                {label}
              </span>
              <span className="sr-only">
                {label}: {p.events} turnos, {p.tokens} tokens,{" "}
                <Money value={p.costUsd} currency="USD" />
              </span>
              <span
                className="text-[9px] tabular-nums text-muted-foreground"
                title={`${p.events} turnos del agente`}
              >
                {p.events}
              </span>
              {/* Marcador para el índice actual (semánticamente último). */}
              {idx === data.length - 1 ? (
                <span className="sr-only">Día actual</span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Leyenda. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-primary" aria-hidden />
          Pico del periodo
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-primary/20" aria-hidden />
          Día con gasto
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-muted" aria-hidden />
          Sin actividad
        </span>
        <Link
          href="/super-admin/usage"
          className="ml-auto inline-flex items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
        >
          Ver detalle
          <ArrowRight aria-hidden className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

const SHORT_DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** "YYYY-MM-DD" → "Lun 9" en es-MX (sin Intl por costo de hidratación). */
function formatDayLabel(day: string): string {
  const parts = day.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return day;
  const dow = SHORT_DAYS[date.getDay()] ?? "";
  return `${dow} ${d}`;
}

/** "$0.02" en una columna de 24px no cabe: 4 caracteres máximo. */
function compactCost(costUsd: string): string {
  const n = Number(costUsd);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "—";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

