import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Campo de texto: surface-1 con borde fino, radio md (10px). Mismo alto,
 * radio y foco que `Select`. Foco = anillo azul. Para marcar error pasa
 * `aria-invalid` — el borde rojo sale solo.
 *
 * @example
 * <Input aria-invalid={!!errors.sku} {...register("sku")} />
 */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full sm:h-10 rounded-md border border-input bg-card px-3.5 py-2.5 text-sm text-foreground",
        "placeholder:text-muted-foreground",
        // Foco nivel 3: mismo borde, anillo azul translúcido (no engrosar).
        "transition-shadow focus-visible:border-primary focus-visible:shadow-selected focus-visible:outline-none",
        "aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";
