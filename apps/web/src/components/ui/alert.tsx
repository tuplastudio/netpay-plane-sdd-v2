import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const alertVariants = cva(
  "relative w-full rounded-card border p-4 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:h-4 [&>svg]:w-4 [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        success: "border-transparent bg-success-subtle text-success-foreground",
        warning: "border-transparent bg-warning-subtle text-warning-foreground",
        info: "border-transparent bg-info-subtle text-info-foreground",
        destructive:
          "border-transparent bg-destructive-subtle text-destructive-subtle-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

/**
 * Mensaje en bloque. Las variantes distintas de `default` se anuncian
 * (`role="alert"`) porque aparecen como consecuencia de una acción; la variante
 * `default` es informativa estática y usa `role="note"`.
 *
 * Pasa el ícono de lucide como primer hijo: el layout ya le reserva el hueco.
 *
 * @example
 * <Alert variant="destructive">
 *   <AlertCircle />
 *   <AlertTitle>No se pudo cargar</AlertTitle>
 *   <AlertDescription>Revisa tu conexión e inténtalo de nuevo.</AlertDescription>
 * </Alert>
 */
export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, role, ...props }, ref) => (
    <div
      ref={ref}
      role={role ?? (variant && variant !== "default" ? "alert" : "note")}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  ),
);
Alert.displayName = "Alert";

export const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("mb-1 font-semibold leading-none tracking-tight", className)} {...props} />
));
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";
