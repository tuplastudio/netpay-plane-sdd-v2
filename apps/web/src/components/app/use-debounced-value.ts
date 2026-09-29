"use client";

import { useEffect, useState } from "react";

/** Valor con retraso: para no pegarle al backend en cada tecla de un buscador. */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
