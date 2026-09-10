import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Rellenos sólidos, no `bg-primary/90`: el alfa sobre blanco aclara el
        // fondo y hunde el contraste del texto blanco (el hover viejo medía
        // 3.23:1). Los tres pasos son tonos propios, 5.20 → 6.34 → 7.83:1.
        default:
          "bg-primary-strong text-primary-foreground hover:bg-primary-strong-hover active:bg-primary-strong-active",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-hairline-strong/40",
        outline:
          "border border-foreground bg-background text-foreground hover:bg-muted active:bg-secondary",
        ghost: "text-foreground hover:bg-muted active:bg-secondary",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive-active",
        warning:
          "border border-warning bg-warning-subtle text-warning-foreground hover:bg-warning/15 active:bg-warning/25",
        link: "text-primary-strong underline-offset-4 hover:underline active:text-primary-strong-active",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-12 px-8",
        icon: "h-10 w-10",
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
