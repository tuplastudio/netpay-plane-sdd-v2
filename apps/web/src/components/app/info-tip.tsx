"use client";

import * as React from "react";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Side = "top" | "right" | "bottom" | "left";

/**
 * Ícono de ayuda junto a una etiqueta, cabecera de columna o ajuste no obvio.
 *
 * - Es un `<button>` real: recibe foco de teclado y Radix abre el tooltip al
 *   enfocar, no solo al pasar el cursor.
 * - Va como **hermano** del `<label>`, nunca dentro: un clic en el ícono no
 *   debe enfocar el control ni alternar un checkbox.
 * - En táctil el tooltip va cerrado (ver `tooltip.tsx`), por eso el texto
 *   también viaja en `aria-label` y `title`: nunca se pierde.
 *
 * Requiere el `TooltipProvider` del `AppShell` (o uno propio en pantallas
 * públicas).
 *
 * ```tsx
 * <div className="flex items-center gap-1.5">
 *   <Label htmlFor="rfc">RFC</Label>
 *   <InfoTip label="RFC" text="Se usa para facturar. 12 o 13 caracteres." />
 * </div>
 * ```
 */
export function InfoTip({
  text,
  label,
  side = "top",
  className,
}: {
  /** Explicación que se muestra en el tooltip. */
  text: string;
  /** Nombre del campo/ajuste; forma el nombre accesible «Qué hace "X"». */
  label?: string;
  side?: Side;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label ? `Qué hace «${label}»: ${text}` : text}
          title={text}
          className={cn(
            "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground",
            "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            className,
          )}
        >
          <CircleHelp aria-hidden className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-[18rem] text-pretty">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Envuelve un control que ya tiene nombre accesible (botón de solo ícono con
 * `aria-label`, insignia, chip) y le agrega el tooltip con ese mismo texto
 * para ratón y teclado. El hijo debe aceptar `ref` y props (un `Button`, un
 * `Link`, un `<button>`).
 *
 * ```tsx
 * <Tip label="Editar dirección">
 *   <Button variant="ghost" size="icon" aria-label="Editar dirección"><Pencil /></Button>
 * </Tip>
 * ```
 */
export function Tip({
  label,
  side = "top",
  children,
  className,
}: {
  label: React.ReactNode;
  side?: Side;
  children: React.ReactElement;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className={cn("max-w-[18rem] text-pretty", className)}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
