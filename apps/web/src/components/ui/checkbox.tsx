import * as React from "react";
import { cn } from "@/lib/utils";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {}

/**
 * `<input type="checkbox">` nativo estilizado con `accent-color`, para que el
 * check use la menta profunda (`primary`) sin recrear el control (y sin
 * perder el comportamiento nativo: barra espaciadora, indeterminate,
 * formularios).
 *
 * Contraste: el relleno marcado es objeto gráfico (1.4.11, ≥3:1): #0a6b54 da
 * 6.5:1 sobre blanco y #2fe0b4 11.5:1 sobre el lienzo oscuro; la palomita la
 * pone el navegador en el color que contraste. El borde en reposo es límite
 * de control y usa `border-input` (≥3.3:1 en ambos modos). Caja de 20px en
 * móvil (blanco táctil con su etiqueta), 16px desde `sm`.
 *
 * Siempre con nombre accesible: `<Label htmlFor>` o `aria-label`.
 *
 * @example
 * <div className="flex items-center gap-2">
 *   <Checkbox id="emitir" checked={issue} onChange={(e) => setIssue(e.target.checked)} />
 *   <Label htmlFor="emitir">Emitir al guardar</Label>
 * </div>
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "h-5 w-5 shrink-0 cursor-pointer rounded-sm border border-input accent-primary sm:h-4 sm:w-4",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "aria-invalid:border-destructive",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Checkbox.displayName = "Checkbox";
