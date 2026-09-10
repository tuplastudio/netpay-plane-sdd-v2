import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Campo de texto. Mismo alto (h-10), radio y foco que `Select`.
 * Para marcar error pasa `aria-invalid` — el borde rojo sale solo.
 *
 * `border-input` (#8a8a8a) es el nivel "límite de control": el campo es blanco
 * sobre página blanca, así que el borde es lo único que lo delimita y tiene que
 * pasar 3:1 (WCAG 1.4.11). No lo cambies por `border-border`, que es el token
 * de separador estructural y vive en 1.35:1. Ver globals.css.
 *
 * @example
 * <Input aria-invalid={!!errors.sku} {...register("sku")} />
 */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground",
        // muted-foreground (no muted-soft): 5.33:1 sobre blanco, pasa AA.
        "placeholder:text-muted-foreground",
        "focus-visible:border-2 focus-visible:border-foreground focus-visible:outline-none",
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
