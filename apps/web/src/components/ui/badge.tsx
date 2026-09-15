import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Etiqueta genérica. Para estados de dominio usa `StatusBadge`, que además
 * resuelve tono y traducción; `Badge` es para todo lo demás (conteos, tags,
 * marcas tipo "livemode=false").
 *
 * Los tonos semánticos (success/warning/info/neutral/destructive) salen de los
 * mismos tokens que `StatusBadge`, así que no hay dos verdes en la app.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-pill border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      // Idénticos a `statusBadgeVariants` para que un chip y una insignia de
      // estado en la misma fila queden a la misma altura.
      size: {
        sm: "px-2 py-0 text-[11px]",
        default: "px-2.5 py-0.5 text-xs",
      },
      variant: {
        // Nivel fuerte del acento: lleva texto encima, así que el ornamento
        // (`bg-primary`, pensado para objeto gráfico) no alcanza — hace falta
        // `bg-primary-strong` (texto/relleno, ver globals.css).
        default: "border-transparent bg-primary-strong text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        success: "border-transparent bg-success-subtle text-success-foreground",
        warning: "border-transparent bg-warning-subtle text-warning-foreground",
        info: "border-transparent bg-info-subtle text-info-foreground",
        neutral: "border-transparent bg-neutral-subtle text-neutral-foreground",
        /** Alias histórico de `neutral`; se conserva por los call sites vigentes. */
        muted: "border-transparent bg-neutral-subtle text-neutral-foreground",
        destructive:
          "border-transparent bg-destructive-subtle text-destructive-subtle-foreground",
        /** Relleno sólido, solo para avisos de destrucción inminente. */
        "destructive-solid": "border-transparent bg-destructive text-destructive-foreground",
        /**
         * Acento de resalte (magenta): "nuevo", "recomendado", categoría
         * destacada. Nunca para comunicar estado — para eso los tonos de
         * arriba (success/warning/…). Relleno sólido, ya viene con tinta
         * blanca legible (`--highlight-strong` es lo bastante oscuro).
         */
        highlight: "border-transparent bg-highlight-strong text-highlight-foreground",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/**
 * @example <Badge variant="info">3 variantes</Badge>
 * @example <Badge variant="neutral" size="sm">WHATSAPP</Badge>
 */
function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { Badge, badgeVariants };
