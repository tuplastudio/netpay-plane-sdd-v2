"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * `true` en dispositivos de puntero grueso (táctil). Arranca en `false` para
 * que servidor y cliente hidraten igual y se corrige tras montar.
 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return coarse;
}

/**
 * En táctil no hay hover ni foco de teclado: el tooltip abría al tocar el
 * botón y se quedaba pegado (QA lo vio dentro del drawer móvil). Ahí se
 * fuerza cerrado; el nombre accesible del trigger (`aria-label`) sigue
 * disponible, así que no se pierde información.
 */
function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const coarse = useCoarsePointer();
  return <TooltipPrimitive.Root {...props} open={coarse ? false : props.open} />;
}

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md border border-hairline bg-popover px-2.5 py-1 text-caption text-popover-foreground shadow-2",
        "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0",
        "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1",
        "data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
