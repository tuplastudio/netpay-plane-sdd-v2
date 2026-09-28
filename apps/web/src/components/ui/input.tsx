import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Campo de texto: lienzo (`bg-background`) con borde de control
 * (`border-input`, ≥3:1 en ambos modos), radio md (8px). 44px de alto en
 * móvil, 40px desde `sm`. Mismo alto, radio y foco que `Select`.
 * Foco = borde + anillo de 1px en menta (`ring`). Para marcar error pasa
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
        "flex h-11 w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-base text-foreground sm:h-10 sm:text-sm",
        "placeholder:text-muted-foreground",
        "transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive",
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
