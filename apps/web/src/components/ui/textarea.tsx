import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldClassName } from "./input";

/**
 * Área de texto. Mismo fondo, borde, radio, texto, placeholder, foco, error y
 * deshabilitado que `Input` (`fieldClassName`); solo cambia el alto mínimo.
 *
 * @example
 * <Textarea rows={4} aria-invalid={!!errors.description}
 *   placeholder="Ej. Incluye instalación y garantía de 1 año" {...register("description")} />
 */
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    className={cn(fieldClassName, "flex min-h-[88px] px-3.5 py-2.5", className)}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = "Textarea";
