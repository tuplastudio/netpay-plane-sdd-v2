import * as React from "react";
import { AlertCircle, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Tone } from "@/components/ui/status-badge";

/** Tinta del valor por tono. `neutral` deja el valor en tinta normal. */
const VALUE_TONE: Record<Tone, string> = {
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  info: "text-info-foreground",
  neutral: "text-foreground",
  destructive: "text-destructive-subtle-foreground",
};

/** Fondo del chip del ícono, a juego con el tono. */
const ICON_TONE: Record<Tone, string> = {
  success: "bg-success-subtle text-success-foreground",
  warning: "bg-warning-subtle text-warning-foreground",
  info: "bg-info-subtle text-info-foreground",
  neutral: "bg-muted text-muted-foreground",
  destructive: "bg-destructive-subtle text-destructive-subtle-foreground",
};

export interface StatTileProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Qué se está midiendo. Va ARRIBA del valor, en meta (`text-xs`). */
  label: React.ReactNode;
  /** El número. Grande y con `tabular-nums`. Acepta `<Money>` directamente. */
  value: React.ReactNode;
  /** Línea de contexto bajo el valor: comparativo, periodo, desglose. */
  hint?: React.ReactNode;
  /** Ícono de lucide. Se rinde en un chip a la derecha, `aria-hidden`. */
  icon?: React.ReactNode;
  /** Tono semántico del valor. Por defecto `neutral` (tinta normal). */
  tone?: Tone;
  /**
   * Densidad del mosaico.
   * - `default`: `p-4`, valor `text-2xl`, pista debajo.
   * - `compact`: `p-3`, valor `text-lg`, ícono más chico y la pista pasa al
   *   `title` del mosaico. Para tiras de resumen sobre un listado, donde
   *   cuatro tarjetas altas empujan la tabla fuera de la primera pantalla.
   */
  size?: "default" | "compact";

  // --- estado de la query (mismo contrato que `DataTable`) ---
  /** Skeleton en lugar del valor, del mismo alto para que la rejilla no salte. */
  isLoading?: boolean;
  /** Mensaje "No se pudo cargar" en lugar del valor. Precede a `isLoading`. */
  isError?: boolean;
  /** Muestra "Reintentar" en el estado de error. */
  onRetry?: () => void;

  className?: string;
}

/**
 * `text-2xl` tiene una caja de línea de 2rem, así que el skeleton del valor va
 * en `h-8`: el mosaico mide exactamente lo mismo cargando que con dato y la
 * rejilla de KPIs no reflowea al llegar la query.
 */
const VALUE_SKELETON = "h-8 w-28";

/**
 * Mosaico de KPI: etiqueta arriba, número grande, pista opcional abajo.
 *
 * Orden fijo **etiqueta → valor → pista**: la etiqueta se lee primero tanto
 * visualmente como en el orden del DOM, así el número nunca llega sin contexto
 * a un lector de pantalla.
 *
 * El valor NO es un encabezado: son datos, no estructura de la página. Si
 * necesitas agrupar varios mosaicos, envuélvelos en una `Section` con título.
 *
 * Resuelve los estados de query igual que `DataTable`: **error > cargando >
 * dato**. La etiqueta se ve en los tres, y el skeleton mide lo mismo que el
 * valor, así que la rejilla no salta al cargar.
 *
 * @example
 * <div className="grid gap-4 sm:grid-cols-3">
 *   <StatTile label="Cobrado hoy" value={<Money value={stats.captured} />}
 *     tone="success" icon={<TrendingUp className="h-4 w-4" />}
 *     hint="12 sesiones"
 *     isLoading={q.isLoading} isError={q.isError} onRetry={() => void q.refetch()} />
 *   <StatTile label="Pendientes" value={stats.pending} tone="warning" />
 *   <StatTile label="Ticket promedio" value={<Money value={stats.avg} />} />
 * </div>
 */
export const StatTile = React.forwardRef<HTMLDivElement, StatTileProps>(
  (
    {
      className,
      label,
      value,
      hint,
      icon,
      tone = "neutral",
      size = "default",
      isLoading = false,
      isError = false,
      onRetry,
      ...props
    },
    ref,
  ) => {
    // La etiqueta se rinde en los tres estados: el mosaico nunca pierde su
    // identidad, ni cargando ni con error.
    const compact = size === "compact";
    const pad = compact ? "p-3" : "p-4";
    const iconBox = compact ? "h-7 w-7" : "h-8 w-8";
    const valueSkeleton = compact ? "h-7 w-20" : VALUE_SKELETON;
    const labelNode = (
      <p className={cn("text-muted-foreground", compact ? "text-[11px] leading-4" : "text-xs")}>
        {label}
      </p>
    );

    // --- error ---
    // Precede a `isLoading`: si un refetch falla no queremos volver a mostrar
    // un skeleton, que se leería como "sigue cargando".
    if (isError) {
      return (
        <Card ref={ref} role="alert" className={cn(pad, className)} {...props}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              {labelNode}
              <p className="text-sm font-medium text-destructive-subtle-foreground">
                No se pudo cargar
              </p>
              {onRetry ? (
                <Button variant="outline" size="sm" className="mt-1" onClick={onRetry}>
                  <RotateCw aria-hidden className="h-3.5 w-3.5" />
                  Reintentar
                </Button>
              ) : null}
            </div>
            <span
              aria-hidden
              className={cn(
                "flex shrink-0 items-center justify-center rounded-lg bg-destructive-subtle text-destructive-subtle-foreground",
                iconBox,
              )}
            >
              <AlertCircle className="h-4 w-4" />
            </span>
          </div>
        </Card>
      );
    }

    // --- cargando ---
    if (isLoading) {
      return (
        <Card
          ref={ref}
          role="status"
          aria-live="polite"
          aria-busy
          className={cn(pad, className)}
          {...props}
        >
          <span className="sr-only">Cargando…</span>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              {labelNode}
              <Skeleton className={valueSkeleton} />
              {hint && !compact ? <Skeleton className="h-4 w-20" /> : null}
            </div>
            {icon ? <Skeleton className={cn("rounded-lg", iconBox)} /> : null}
          </div>
        </Card>
      );
    }

    // --- dato ---
    // Un KPI no tiene estado "vacío": cero es un dato. Lo que cambia en ese
    // caso es la pista, y eso lo decide el llamador.
    return (
      <Card
        ref={ref}
        className={cn(pad, className)}
        title={compact && typeof hint === "string" ? hint : undefined}
        {...props}
      >
        <div className="flex items-start justify-between gap-3">
          <div className={cn("min-w-0", compact ? "space-y-0.5" : "space-y-1")}>
            {labelNode}
            <p
              className={cn(
                "font-semibold tabular-nums tracking-tight",
                compact ? "text-lg leading-6" : "text-2xl",
                VALUE_TONE[tone],
              )}
            >
              {value}
            </p>
            {hint && !compact ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
          </div>
          {icon ? (
            <span
              aria-hidden
              className={cn(
                "flex shrink-0 items-center justify-center rounded-lg",
                iconBox,
                ICON_TONE[tone],
              )}
            >
              {icon}
            </span>
          ) : null}
        </div>
      </Card>
    );
  },
);
StatTile.displayName = "StatTile";
