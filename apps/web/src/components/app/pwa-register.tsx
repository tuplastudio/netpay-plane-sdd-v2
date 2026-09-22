"use client";

import * as React from "react";

/**
 * Registra el service worker solo en producción: en `next dev` el HMR ya
 * invalida chunks a mano y un SW cacheando `/_next/static` viejo confunde
 * más de lo que ayuda. `navigator.serviceWorker` tampoco existe en HTTP
 * plano (salvo localhost), así que el chequeo de soporte es obligatorio.
 */
export function PwaRegister() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Sin service worker el portal sigue funcionando igual, solo sin
      // instalabilidad offline — no hay nada que reportar al usuario.
    });
  }, []);
  return null;
}
