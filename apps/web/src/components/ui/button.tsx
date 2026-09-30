import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

export const buttonVariants = cva(
  // Todo botón de texto es píldora (`rounded-full`). "Presionado" = encoger
  // (scale) + un paso de tono. Foco = anillo menta de 2px con separación.
  // Deshabilitado (`inactive:` = disabled sin `aria-busy`): relleno hairline +
  // texto muted (≥4.5:1), o texto `muted-soft` en las variantes sin relleno;
  // nunca opacidad, que dejaba la menta con texto ilegible. Un botón en
  // `loading` conserva su color: el spinner ya comunica el estado.
  // Móvil primero: 44px de alto; desde `sm` se compacta.
  // Etiqueta siempre body-sm (14px) en peso 500, en todos los tamaños salvo
  // `lg` (body, 16px): un botón nunca cambia de tamaño de letra por su alto.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-body-sm font-medium transition-[color,background-color,border-color,transform,box-shadow] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** Píldora dominante: negra en claro, blanca en oscuro. La acción principal. */
        default:
          "bg-primary-strong text-primary-foreground hover:bg-primary-strong-hover active:bg-primary-strong-active inactive:bg-primary-disabled inactive:text-muted-foreground",
        /** Misma píldora que `default`: un solo lenguaje de CTA. */
        cta: "bg-cta text-cta-foreground hover:bg-cta-hover active:bg-cta-active inactive:bg-primary-disabled inactive:text-muted-foreground",
        /**
         * Menta de marca con tinta ink. Solo para el CTA de MÁXIMA intención
         * (emitir, cobrar, entrar): uno por pantalla. Para todo lo demás,
         * `default`.
         */
        accent: "bg-brand text-brand-foreground hover:bg-brand/90 active:bg-brand/80 inactive:bg-primary-disabled inactive:text-muted-foreground",
        /** Píldora con borde hairline y tinta ink: acciones secundarias. */
        secondary:
          "border border-hairline bg-transparent text-foreground hover:bg-secondary active:bg-accent inactive:text-muted-soft",
        /** Alias histórico de `secondary` (mismo render). */
        outline:
          "border border-hairline bg-transparent text-foreground hover:bg-secondary active:bg-accent inactive:text-muted-soft",
        /** Sin relleno ni borde; radio md (no píldora). */
        ghost: "rounded-md text-foreground hover:bg-secondary active:bg-accent inactive:text-muted-soft",
        /** Píldora con borde y tinta roja: el rojo es señal, no relleno. */
        destructive:
          "border border-hairline bg-transparent text-destructive hover:bg-destructive-subtle active:bg-destructive-subtle inactive:text-muted-soft",
        /** Relleno rojo: solo el botón que confirma algo irreversible. */
        "destructive-solid":
          "bg-destructive text-destructive-foreground hover:bg-destructive-active active:bg-destructive-active inactive:bg-primary-disabled inactive:text-muted-foreground",
        warning:
          "border border-hairline bg-transparent text-warning-foreground hover:bg-warning-subtle active:bg-warning-subtle inactive:text-muted-soft",
        /** Píldora blanca sobre bandas hero (`.hero-dark`), igual en ambos modos. */
        translucent:
          "bg-on-hero text-on-hero-foreground hover:bg-on-hero/90 active:bg-on-hero/80 inactive:bg-on-hero/60",
        link: "rounded-none text-legal-link underline-offset-4 hover:underline active:scale-100 inactive:text-muted-soft",
      },
      size: {
        // Móvil: alto táctil ≥44px; en escritorio se compacta.
        // default 40 = mismo alto que `Input`/`Select`, para que un botón
        // junto a un campo quede alineado. sm 36 = barras de tabla, filtros.
        default: "h-11 px-5 sm:h-10",
        sm: "h-11 px-4 sm:h-9",
        lg: "h-12 px-7 text-body",
        icon: "h-11 w-11 rounded-full sm:h-9 sm:w-9",
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
 * <Button variant="accent">Emitir cotización</Button>
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
