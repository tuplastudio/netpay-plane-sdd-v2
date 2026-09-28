import * as React from "react";
import { cn } from "@/lib/utils";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

/**
 * `<select>` nativo estilizado. Sin Radix a propósito: el select del sistema
 * ya es accesible, teclable y en móvil abre la rueda nativa.
 * Mismas medidas (44px móvil / 40px desde `sm`), fondo, borde, radio y foco
 * que `Input`.
 *
 * Necesita nombre accesible: envuélvelo en `<Label htmlFor>` o pásale
 * `aria-label`.
 *
 * @example
 * <Label htmlFor="estado">Estado</Label>
 * <Select id="estado" value={status} onChange={(e) => setStatus(e.target.value)}>
 *   <option value="">Todos los estados</option>
 *   <option value="ACTIVE">Activo</option>
 * </Select>
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <div className="relative w-full">
      <select
        ref={ref}
        className={cn(
          "flex h-11 w-full appearance-none rounded-md border border-input bg-background py-2 pl-3.5 pr-9 text-base text-foreground sm:h-10 sm:text-sm",
          "transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {/* Chevron propio: `appearance-none` quita el del sistema. */}
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      >
        <path
          d="m5 7.5 5 5 5-5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  ),
);
Select.displayName = "Select";
