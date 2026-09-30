"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Tabs mínimos con teclado y ARIA. Sin @radix-ui/react-tabs: la única
 * necesidad aquí es alternar paneles, y agregar una dependencia por eso
 * obliga a reconstruir node_modules en la imagen.
 *
 * Dos presentaciones (prop `variant` de `Tabs`):
 * - `underline` (por defecto): inactivo `muted-foreground`, activo `foreground`
 *   con subrayado de 2px en ink. Lista con hairline inferior.
 * - `pill`: lista en píldora sobre surface-1; activo sube a surface-2.
 */

export type TabsVariant = "underline" | "pill";

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
  variant: TabsVariant;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs(component: string): TabsContextValue {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error(`${component} debe usarse dentro de <Tabs>`);
  return ctx;
}

export function Tabs({
  defaultValue,
  value: controlled,
  onValueChange,
  variant = "underline",
  className,
  children,
}: {
  defaultValue: string;
  value?: string;
  onValueChange?: (value: string) => void;
  /** Presentación de la lista. Por defecto `underline`. */
  variant?: TabsVariant;
  className?: string;
  children: React.ReactNode;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const baseId = React.useId();
  const value = controlled ?? uncontrolled;
  const setValue = React.useCallback(
    (next: string) => {
      if (controlled === undefined) setUncontrolled(next);
      onValueChange?.(next);
    },
    [controlled, onValueChange],
  );
  const ctx = React.useMemo(
    () => ({ value, setValue, baseId, variant }),
    [value, setValue, baseId, variant],
  );
  return (
    <TabsContext.Provider value={ctx}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
  children: React.ReactNode;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const { variant } = useTabs("TabsList");

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const tabs = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const index = tabs.findIndex((t) => t === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    tabs[(index + delta + tabs.length) % tabs.length]?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn(
        "flex max-w-full items-center overflow-x-auto text-body-sm",
        variant === "pill"
          ? "inline-flex gap-1 rounded-full bg-card p-1"
          : "gap-4 border-b border-hairline",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ctx = useTabs("TabsTrigger");
  const active = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${ctx.baseId}-tab-${value}`}
      aria-selected={active}
      aria-controls={`${ctx.baseId}-panel-${value}`}
      tabIndex={active ? 0 : -1}
      onClick={() => ctx.setValue(value)}
      onFocus={() => ctx.setValue(value)}
      className={cn(
        // Alto táctil 44px en móvil, 36px desde `sm`.
        "min-h-11 shrink-0 whitespace-nowrap font-medium transition-colors focus-visible:outline-none sm:min-h-9",
        ctx.variant === "pill"
          ? cn(
              "rounded-full px-4 py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:py-1.5",
              // Seleccionado = subir de superficie (surface-2), no color.
              active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
            )
          : cn(
              // Subrayado de 2px; el inactivo lleva borde transparente para no saltar.
              "-mb-px border-b-2 px-1 py-2.5 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:border-hairline-strong hover:text-foreground",
            ),
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ctx = useTabs("TabsContent");
  if (ctx.value !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-panel-${value}`}
      aria-labelledby={`${ctx.baseId}-tab-${value}`}
      className={className}
    >
      {children}
    </div>
  );
}
