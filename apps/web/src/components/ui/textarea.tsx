import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Área de texto. Mismo radio, placeholder y foco que `Input`.
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
      "flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground",
      "placeholder:text-muted-foreground",
      "focus-visible:border-2 focus-visible:border-foreground focus-visible:outline-none",
      "aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = "Textarea";
