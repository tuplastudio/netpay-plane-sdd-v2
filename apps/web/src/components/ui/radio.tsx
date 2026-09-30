import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Todo este módulo usa `<input type="radio">` nativo a propósito.
 *
 * Un grupo de radios nativos con el mismo `name` ya trae, gratis y correcto:
 * un solo tab stop para el grupo, flechas para moverse entre opciones,
 * `aria-checked` implícito y el envío en formularios. Reimplementar eso con
 * `tabIndex` y `onKeyDown` es la forma clásica de romperlo.
 *
 * Por eso **nunca** pongas `tabIndex` en un `Radio`/`RadioCard`.
 */

export interface RadioGroupProps extends Omit<React.FieldsetHTMLAttributes<HTMLFieldSetElement>, "children"> {
  /** Pregunta que responde el grupo. Se rinde como `<legend>`. */
  legend: React.ReactNode;
  /** Texto de apoyo bajo la leyenda. Se enlaza con `aria-describedby`. */
  description?: React.ReactNode;
  /**
   * `name` compartido por todas las opciones. Es lo que las convierte en un
   * grupo para el navegador; sin él las flechas no funcionan.
   * Si lo pasas aquí, los hijos `Radio`/`RadioCard` lo heredan.
   */
  name?: string;
  /** Oculta la leyenda visualmente pero la deja para lectores de pantalla. */
  hideLegend?: boolean;
  /** Dirección de las opciones. Por defecto vertical. */
  orientation?: "vertical" | "horizontal";
  children?: React.ReactNode;
  className?: string;
  /** Clases del contenedor de opciones. */
  optionsClassName?: string;
}

/** Propaga `name` a los hijos sin que cada callsite lo repita. */
const RadioGroupContext = React.createContext<{ name?: string } | null>(null);

/**
 * Grupo de opciones excluyentes.
 *
 * @example
 * <RadioGroup legend="Estilo de venta" name="sales_style"
 *   description="Define el tono del agente al responder.">
 *   <RadioCard value="consultivo" label="Consultivo"
 *     description="Pregunta antes de recomendar."
 *     checked={v === "consultivo"} onChange={() => set("consultivo")} />
 *   <RadioCard value="directo" label="Directo"
 *     description="Va al grano con una recomendación."
 *     checked={v === "directo"} onChange={() => set("directo")} />
 * </RadioGroup>
 */
export const RadioGroup = React.forwardRef<HTMLFieldSetElement, RadioGroupProps>(
  (
    {
      className,
      optionsClassName,
      legend,
      description,
      name,
      hideLegend = false,
      orientation = "vertical",
      children,
      ...props
    },
    ref,
  ) => {
    const descriptionId = React.useId();
    const ctx = React.useMemo(() => ({ name }), [name]);
    return (
      <RadioGroupContext.Provider value={ctx}>
        <fieldset
          ref={ref}
          aria-describedby={description ? descriptionId : undefined}
          className={cn("min-w-0 space-y-2", className)}
          {...props}
        >
          <legend className={cn("text-body-sm font-medium", hideLegend && "sr-only")}>{legend}</legend>
          {description ? (
            <p id={descriptionId} className="text-caption text-muted-foreground">
              {description}
            </p>
          ) : null}
          <div
            className={cn(
              orientation === "vertical" ? "flex flex-col gap-2" : "flex flex-wrap gap-3",
              optionsClassName,
            )}
          >
            {children}
          </div>
        </fieldset>
      </RadioGroupContext.Provider>
    );
  },
);
RadioGroup.displayName = "RadioGroup";

/**
 * Clases del control en sí, compartidas por `Radio` y `RadioCard`.
 *
 * `accent-primary` = menta profunda: el punto del radio nativo es un objeto
 * gráfico (1.4.11, ≥3:1) y da 6.5:1 en claro / 11.5:1 en oscuro. 20px en
 * móvil, 16px desde `sm`.
 */
const radioInputClass =
  "h-5 w-5 shrink-0 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 sm:h-4 sm:w-4";

export interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Etiqueta visible. Si la omites, pon `aria-label`. */
  label?: React.ReactNode;
}

/**
 * Opción simple: control + etiqueta en una línea. El `<label>` envuelve al
 * input, así que no hace falta casar `id`/`htmlFor`.
 *
 * @example
 * <RadioGroup legend="Entrega" name="delivery">
 *   <Radio value="PICKUP" label="Recolección" defaultChecked />
 *   <Radio value="LOCAL_DELIVERY" label="Envío local" />
 * </RadioGroup>
 */
export const Radio = React.forwardRef<HTMLInputElement, RadioProps>(
  ({ className, label, name, disabled, ...props }, ref) => {
    const ctx = React.useContext(RadioGroupContext);
    return (
      <label
        className={cn(
          "flex min-h-11 cursor-pointer items-center gap-2 text-body-sm sm:min-h-0",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        <input
          ref={ref}
          type="radio"
          name={name ?? ctx?.name}
          disabled={disabled}
          className={radioInputClass}
          {...props}
        />
        {label ? <span className="min-w-0">{label}</span> : null}
      </label>
    );
  },
);
Radio.displayName = "Radio";

export interface RadioCardProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Título de la opción. */
  label: React.ReactNode;
  /** Línea de apoyo bajo el título: qué implica elegir esto. */
  description?: React.ReactNode;
  /** Clases de la tarjeta (el `<label>`), no del input. */
  className?: string;
}

/**
 * Opción con descripción, presentada como tarjeta seleccionable. Es el caso
 * real de "elige uno de tres, cada uno con su explicación".
 *
 * El resalte de la opción activa sale de `has-[:checked]:` en CSS, así que
 * funciona igual controlado o no controlado. En un navegador sin `:has()` se
 * pierde solo el resalte de la tarjeta: el punto del radio nativo sigue
 * marcando la selección, nunca queda ambigua.
 *
 * El anillo de foco va en la tarjeta (`focus-within`) para que se vea el
 * objetivo completo, no un anillo de 16px perdido a la izquierda.
 *
 * @example
 * <RadioCard value="consultivo" label="Consultivo"
 *   description="Hace preguntas antes de recomendar."
 *   checked={style === "consultivo"} onChange={() => set("consultivo")} />
 */
export const RadioCard = React.forwardRef<HTMLInputElement, RadioCardProps>(
  ({ className, label, description, name, disabled, ...props }, ref) => {
    const ctx = React.useContext(RadioGroupContext);
    return (
      <label
        className={cn(
          // Tarjeta plana con hairline; la opción marcada sube el borde a la
          // menta profunda (`primary`, ≥3:1) y tiñe el fondo con `brand-soft`.
          "flex gap-2.5 rounded-lg border border-hairline bg-card p-3 text-left text-body-sm transition-colors",
          "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
          disabled
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer hover:bg-secondary has-[:checked]:border-primary has-[:checked]:bg-brand-soft has-[:checked]:hover:bg-brand-soft",
          className,
        )}
      >
        <input
          ref={ref}
          type="radio"
          name={name ?? ctx?.name}
          disabled={disabled}
          className={cn(radioInputClass, "mt-0.5")}
          {...props}
        />
        <span className="min-w-0">
          <span className="block font-medium">{label}</span>
          {description ? (
            <span className="block text-caption text-muted-foreground">{description}</span>
          ) : null}
        </span>
      </label>
    );
  },
);
RadioCard.displayName = "RadioCard";
