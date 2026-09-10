import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const sizeMap = {
  sm: "h-3.5 w-3.5",
  default: "h-4 w-4",
  lg: "h-5 w-5",
} as const;

export interface SpinnerProps extends React.SVGAttributes<SVGSVGElement> {
  size?: keyof typeof sizeMap;
  /**
   * Texto anunciado a lectores de pantalla. El spinner en sí es decorativo
   * (`aria-hidden`): quien necesita saber que algo carga lo escucha de este
   * hermano en un live region. Pásalo `null` cuando el contenedor ya tenga su
   * propio `role="status"` (p. ej. dentro de `<Button loading>`, que usa
   * `aria-busy`) para no duplicar el anuncio.
   */
  label?: string | null;
}

/**
 * Spinner en línea para botones y estados de carga cortos.
 *
 * @example
 * <span className="inline-flex items-center gap-2">
 *   <Spinner label={null} /> Guardando…
 * </span>
 */
export const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(
  ({ className, size = "default", label = "Cargando…", ...props }, ref) => (
    <>
      <Loader2
        ref={ref}
        aria-hidden
        className={cn("animate-spin", sizeMap[size], className)}
        {...props}
      />
      {label ? (
        <span role="status" className="sr-only">
          {label}
        </span>
      ) : null}
    </>
  ),
);
Spinner.displayName = "Spinner";
