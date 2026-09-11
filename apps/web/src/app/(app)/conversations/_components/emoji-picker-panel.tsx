"use client";
import { useEffect, useRef } from "react";

/**
 * Envuelve el web component `<emoji-picker>` de `emoji-picker-element`
 * (framework-agnostic, sin dependencia de la versión de React: el paquete
 * `emoji-mart`/`@emoji-mart/react` solo declara peer de React 16-18 y este
 * portal ya corre en React 19).
 *
 * Se crea con `document.createElement` en vez de JSX porque el elemento no
 * está en `JSX.IntrinsicElements` y no vale la pena declarar el tipo global
 * para un solo uso. El paquete trae sus propios datos de emoji (no depende
 * de red en runtime más allá de lo que el propio navegador cachea).
 */
export function EmojiPickerPanel({ onPick }: { onPick: (emoji: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    let cancelled = false;
    let picker: HTMLElement | null = null;

    function handleClick(e: Event) {
      const detail = (e as CustomEvent).detail as { unicode?: string } | undefined;
      if (detail?.unicode) onPickRef.current(detail.unicode);
    }

    void import("emoji-picker-element").then(() => {
      if (cancelled || !hostRef.current) return;
      picker = document.createElement("emoji-picker");
      picker.style.width = "18rem";
      picker.style.height = "20rem";
      picker.style.maxWidth = "100%";
      picker.addEventListener("emoji-click", handleClick);
      hostRef.current.appendChild(picker);
    });

    return () => {
      cancelled = true;
      picker?.removeEventListener("emoji-click", handleClick);
      picker?.remove();
    };
  }, []);

  return <div ref={hostRef} aria-label="Selector de emoji" />;
}
