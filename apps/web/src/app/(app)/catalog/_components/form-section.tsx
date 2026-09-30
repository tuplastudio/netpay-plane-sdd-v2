"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bloque de un formulario largo: `<fieldset>` con título (legend), ícono
 * decorativo y descripción, separado del anterior por una hairline. Con
 * `collapsible` el cuerpo se pliega (para secciones opcionales como
 * "Origen") sin sacar los campos del formulario: siguen registrados en RHF y
 * un error dentro (`hasError`) lo vuelve a abrir.
 *
 * La hairline va en un `div` envolvente y no en el `fieldset`: el `legend`
 * se dibuja encima del borde del fieldset y partiría la línea.
 */
export function FormSection({
  title,
  description,
  icon,
  collapsible = false,
  defaultOpen = true,
  hasError = false,
  className,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Fuerza abierto (p. ej. cuando un campo de dentro tiene error). */
  hasError?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const bodyId = React.useId();
  const [open, setOpen] = React.useState(defaultOpen);
  const expanded = !collapsible || open || hasError;

  const heading = (
    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
      {icon ? (
        <span aria-hidden className="shrink-0 text-muted-foreground">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{title}</span>
    </span>
  );

  return (
    <div className={cn("border-t pt-4 first:border-t-0 first:pt-0", className)}>
      <fieldset className="min-w-0">
        <legend className="w-full">
          {collapsible ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={bodyId}
              onClick={() => setOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {heading}
              <ChevronDown
                aria-hidden
                className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
              />
            </button>
          ) : (
            heading
          )}
        </legend>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        {expanded ? (
          <div id={bodyId} className="mt-3 space-y-4">
            {children}
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
