"use client";
import * as React from "react";

/**
 * Valor retrasado `ms` tras el último cambio. Mismo patrón que la búsqueda
 * global: el input responde al instante, la query se dispara al soltar.
 */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
