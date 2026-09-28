import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Área de texto. Mismo fondo, borde, radio, placeholder y foco que `Input`.
 *
 * @example
 * <Textarea rows={4} aria-invalid={!!errors.description} {...register("description")} />
 */
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "flex min-h-[88px] w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-base text-foreground sm:text-sm",
      "placeholder:text-muted-foreground",
      "transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      "aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = "Textarea";
