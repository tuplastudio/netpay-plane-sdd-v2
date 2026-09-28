import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

export const buttonVariants = cva(
  // Todo CTA es píldora. "Presionado" = encoger (scale), no oscurecer. Foco =
  // anillo azul (único uso del acento junto con enlaces y selección).
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill text-sm font-medium tracking-[-0.01em] transition-[color,background-color,transform,box-shadow] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** Píldora blanca (tinta oscura). La acción principal de la pantalla. */
        default:
          "bg-primary-strong text-primary-foreground hover:bg-primary-strong-hover active:bg-primary-strong-active",
        /** Píldora carbón: acciones secundarias. */
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent active:bg-accent",
        /**
         * Antes era un botón fantasma con borde. El sistema no usa botones con
         * borde: se conserva la variante por compatibilidad y rinde igual que
         * `secondary`.
         */
        outline:
          "bg-secondary text-secondary-foreground hover:bg-accent active:bg-accent",
        ghost: "text-foreground hover:bg-secondary active:bg-accent",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive-active",
        warning:
          "border border-warning bg-warning-subtle text-warning-foreground hover:bg-warning/15 active:bg-warning/25",
        link: "rounded-none text-legal-link underline-offset-4 hover:underline active:scale-100",
        /** Misma píldora blanca que `default`: un solo lenguaje de CTA. */
        cta: "bg-cta text-cta-foreground hover:bg-cta-hover active:bg-cta-active",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3.5",
        lg: "h-12 px-7 text-[15px]",
        icon: "h-10 w-10 rounded-full",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Estado ocupado: muestra `Spinner`, marca `aria-busy` y deshabilita el botón
   * para evitar el doble submit. El texto del botón NO se reemplaza (cambiarlo
   * hace que el lector de pantalla lo relea como si fuera otro control);
   * si quieres "Guardando…" ponlo tú como children.
   *
   * Ignorado con `asChild`, porque ahí no controlamos el nodo renderizado.
   */
  loading?: boolean;
}

/**
 * @example
 * <Button loading={mutation.isPending}>Guardar</Button>
 * <Button variant="outline" size="sm" asChild><Link href="/orders">Ver pedidos</Link></Button>
 * <Button variant="ghost" size="icon" aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    if (asChild) {
      return (
        <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Comp>
      );
    }
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Spinner size={size === "sm" ? "sm" : "default"} label={null} /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
