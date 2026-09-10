import * as React from "react";
import { cn } from "@/lib/utils";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {}

/**
 * `<input type="checkbox">` nativo estilizado con `accent-color`, para que el
 * check use el acento Rausch sin recrear el control (y sin perder el
 * comportamiento nativo: barra espaciadora, indeterminate, formularios).
 *
 * Contraste: la palomita es objeto gráfico, no texto, así que la regla es
 * 1.4.11 (3:1). El relleno #ff3859 del nivel ornamento da 3.52:1 contra el
 * blanco de la página y la palomita blanca 3.52:1 contra el relleno: pasa sin
 * tener que oscurecer el acento aquí. El borde en reposo sí es límite de
 * control y usa `border-input` (#8a8a8a, 3.45:1).
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
        "h-4 w-4 shrink-0 cursor-pointer rounded-sm border border-input accent-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2",
        "aria-invalid:border-destructive",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Checkbox.displayName = "Checkbox";
