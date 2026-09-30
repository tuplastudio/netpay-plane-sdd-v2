import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Etiqueta de campo: body-sm (14px) en peso 500, tinta plena. La ayuda y el
 * error van DEBAJO del control en `text-caption` (13px): ayuda en
 * `muted-foreground`, error en `destructive` y enlazados por
 * `aria-describedby`. Nunca repitas la etiqueta en el placeholder — ahí va un
 * ejemplo ("Ej. …").
 *
 * @example
 * <div className="space-y-1.5">
 *   <Label htmlFor="name">Nombre del producto</Label>
 *   <Input id="name" placeholder="Ej. Playera de algodón unisex" aria-describedby="name-hint" />
 *   <p id="name-hint" className="text-caption text-muted-foreground">Así lo verá el cliente.</p>
 * </div>
 */
export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-body-sm font-medium leading-tight text-foreground peer-disabled:cursor-not-allowed peer-disabled:text-muted-foreground",
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = "Label";