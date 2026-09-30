import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Clases base compartidas por `Input`, `Textarea` y `Select`: un solo
 * contrato de campo para toda la app.
 *
 * - Alto **44px en móvil y tablet, 40px desde `xl`** (`h-11 xl:h-10`),
 *   padding 14px, radio md (8px). El `Textarea` no fija alto pero hereda
 *   padding y texto. Antes compactaba desde `sm` (640px): eso metía tamaño
 *   de mouse a todo iPad, portrait o landscape.
 * - Texto **16px en móvil y tablet** (evita el zoom de iOS al enfocar) y
 *   **body-sm (14px)** desde `xl`. Placeholder en `muted-foreground` (steel: 6.3:1 en
 *   claro, 8.2:1 en oscuro; par "placeholder" del `contrast-audit`).
 * - Borde de control `border-input` (≥3:1). Foco = borde + anillo de 1px en
 *   menta (`ring`): 2px de foco visible en total, ≥3:1 sobre las superficies.
 * - Error: pasa `aria-invalid` y el borde/anillo pasan a rojo.
 * - Deshabilitado: relleno `muted`, texto `muted-foreground` y borde
 *   hairline; sin opacidad (la opacidad dejaba el texto ilegible).
 */
export const fieldClassName = cn(
  "w-full rounded-md border border-input bg-background text-base text-foreground xl:text-body-sm",
  "placeholder:text-muted-foreground",
  "transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive",
  "disabled:cursor-not-allowed disabled:border-hairline-strong disabled:bg-muted disabled:text-muted-foreground disabled:placeholder:text-muted-soft",
);

/**
 * Campo de texto. Ver `fieldClassName` para el contrato de alto, texto,
 * placeholder, foco, error y deshabilitado.
 *
 * @example
 * <Input aria-invalid={!!errors.sku} placeholder="Ej. PLAY-ALG-M" {...register("sku")} />
 */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        fieldClassName,
        "flex h-11 px-3.5 py-2.5 xl:h-10",
        "file:border-0 file:bg-transparent file:text-body-sm file:font-medium",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";
