"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Tabs mínimos con teclado y ARIA. Sin @radix-ui/react-tabs: la única
 * necesidad aquí es alternar paneles, y agregar una dependencia por eso
 * obliga a reconstruir node_modules en la imagen.
 */

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
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
  className,
  children,
}: {
  defaultValue: string;
  value?: string;
  onValueChange?: (value: string) => void;
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
  return (
    <TabsContext.Provider value={{ value, setValue, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);

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
        "inline-flex items-center gap-1 rounded-pill bg-muted p-1 text-sm",
        className,
      )}
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
        "rounded-pill px-3 py-1.5 font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
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
