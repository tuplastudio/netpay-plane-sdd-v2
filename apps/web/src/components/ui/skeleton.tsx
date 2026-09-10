import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Bloque de carga. Siempre decorativo: el anuncio accesible lo pone el
 * contenedor (`SkeletonText` / `SkeletonTable` ya lo traen).
 *
 * @example
 * <Skeleton className="h-10 w-40" />
 */
export const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  ),
);
Skeleton.displayName = "Skeleton";

/**
 * Región viva que envuelve un grupo de skeletons y anuncia el estado de carga
 * UNA vez. Es la pieza que habla: `SkeletonText` y `SkeletonTable` son mudos por
 * defecto.
 *
 * Regla: **una sola región viva por pantalla**. Si tres bloques cargan a la vez
 * y cada uno anuncia, el lector de pantalla dice "Cargando" tres veces y no se
 * entiende qué está cargando. Envuelve el área que carga, no cada bloque.
 *
 * @example
 * <SkeletonRegion label="Cargando el cobro…">
 *   <SkeletonText lines={2} />
 *   <SkeletonTable rows={3} cols={3} />
 * </SkeletonRegion>
 */
export const SkeletonRegion = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { label?: string }
>(({ className, children, label = "Cargando…", ...props }, ref) => (
  <div ref={ref} role="status" aria-live="polite" className={cn(className)} {...props}>
    <span className="sr-only">{label}</span>
    {children}
  </div>
));
SkeletonRegion.displayName = "SkeletonRegion";

/**
 * Envuelve en `SkeletonRegion` solo si el llamador lo pidió; si no, un div mudo.
 * Así varios skeletons en pantalla no se pisan anunciando a coro.
 */
const SkeletonShell = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { announce: boolean; label?: string }
>(({ announce, label, ...props }, ref) =>
  announce ? (
    <SkeletonRegion ref={ref} label={label} {...props} />
  ) : (
    <div ref={ref} aria-hidden {...props} />
  ),
);
SkeletonShell.displayName = "SkeletonShell";

export interface SkeletonTextProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Número de líneas. Por defecto 3. */
  lines?: number;
  /**
   * Anuncia la carga a lectores de pantalla (`role="status"`).
   * **Por defecto `false`**: el bloque es puramente visual. Actívalo solo si
   * este skeleton es el único de la pantalla; si hay varios, envuélvelos todos
   * en un único `SkeletonRegion` en vez de encender esto en cada uno.
   */
  announce?: boolean;
  /** Texto anunciado cuando `announce`. */
  label?: string;
}

/**
 * n líneas de texto fantasma; la última sale más corta para no parecer un bloque.
 *
 * @example
 * <SkeletonText lines={2} />
 * <SkeletonText lines={2} announce label="Cargando el resumen…" />
 */
export const SkeletonText = React.forwardRef<HTMLDivElement, SkeletonTextProps>(
  ({ className, lines = 3, announce = false, label, ...props }, ref) => (
    <SkeletonShell
      ref={ref}
      announce={announce}
      label={label}
      className={cn("space-y-2", className)}
      {...props}
    >
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn("h-4", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </SkeletonShell>
  ),
);
SkeletonText.displayName = "SkeletonText";

export interface SkeletonTableProps extends React.HTMLAttributes<HTMLDivElement> {
  rows?: number;
  cols?: number;
  /** Dibuja también una fila de encabezado fantasma. */
  header?: boolean;
  /** Ver `SkeletonTextProps.announce`. Por defecto `false`. */
  announce?: boolean;
  label?: string;
}

/**
 * Rejilla rows × cols que imita una tabla mientras llega la query.
 * `DataTable` la usa internamente; úsala suelta solo si armas una lista a mano.
 *
 * @example
 * <SkeletonTable rows={5} cols={4} />
 */
export const SkeletonTable = React.forwardRef<HTMLDivElement, SkeletonTableProps>(
  ({ className, rows = 5, cols = 4, header = true, announce = false, label, ...props }, ref) => (
    <SkeletonShell
      ref={ref}
      announce={announce}
      label={label}
      className={cn("w-full space-y-2", className)}
      {...props}
    >
      {header ? (
        <div
          className="grid gap-3 border-b pb-3"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className="h-3 w-20" />
          ))}
        </div>
      ) : null}
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="grid gap-3 py-1"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 ? "w-24" : "w-full")} />
          ))}
        </div>
      ))}
    </SkeletonShell>
  ),
);
SkeletonTable.displayName = "SkeletonTable";
