"use client";
import { Keyboard } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Botón "?" que muestra los atajos de teclado disponibles en la pantalla
 * actual, mismo patrón que `InfoTip` en `agent-settings-form.tsx` (un
 * `Tooltip` de Radix, no un modal completo: alcanza para una lista corta).
 */
export function ShortcutsHelp({
  items,
  label = "Atajos de teclado",
}: {
  items: Array<{ keys: string; label: string }>;
  label?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
        >
          <Keyboard aria-hidden className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[18rem] text-pretty">
        <ul className="space-y-1.5">
          {items.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-3 text-xs">
              <kbd className="rounded border border-background/30 bg-background/10 px-1.5 py-0.5 font-mono text-[10px]">
                {s.keys}
              </kbd>
              <span className="text-right">{s.label}</span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
