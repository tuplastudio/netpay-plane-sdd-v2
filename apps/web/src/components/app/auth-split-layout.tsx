import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Lienzo de dos mitades para login y recuperación:
 *
 *  - Izquierda (~40 % en desktop): canvas del sitio, formulario.
 *  - Derecha  (~60 % en desktop, oculta en móvil): panel visual de la marca,
 *    superficie oscura lisa con un sello geométrico sutil.
 *
 * Las páginas públicas lo usan porque comparten look-and-feel: misma marca,
 * mismo ritmo vertical, mismos puntos de apoyo. Se llama `<AuthSplitLayout>`
 * y recibe sólo tres cosas: el logo, el bloque central (título + formulario) y
 * un footer opcional (enlaces legales, demo, etc.).
 *
 * En móvil (`md:` y abajo) se oculta la mitad visual para que el formulario
 * quede en una columna centrada — mismo alto mínimo, sin doble scroll.
 */
export function AuthSplitLayout({
  children,
  footer,
  className,
}: {
  children: React.ReactNode;
  /** Texto pequeño centrado debajo del formulario. */
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid min-h-svh w-full lg:grid-cols-2", className)}>
      {/* Mitad izquierda: formulario. */}
      <div className="flex min-h-svh flex-col bg-background">
        <header className="flex h-16 shrink-0 items-center px-6 sm:px-10">
          <Brand />
        </header>
        <main className="flex flex-1 items-center justify-center px-6 py-8 sm:px-10">
          <div className="w-full max-w-sm">{children}</div>
        </main>
        {footer ? (
          <footer className="px-6 py-4 text-center text-xs text-muted-foreground sm:px-10">
            {footer}
          </footer>
        ) : null}
      </div>

      {/* Mitad derecha: panel visual de marca. */}
      <div className="relative hidden overflow-hidden bg-card lg:block">
        <BrandBackdrop />
        <div className="relative z-10 flex h-full flex-col justify-between p-12 text-foreground">
          <div className="flex items-center gap-2 text-sm font-medium opacity-80">
            <span className="h-2 w-2 rounded-full bg-cta" />
            Portal operativo
          </div>
          <div className="max-w-md space-y-4">
            <p className="font-display text-3xl font-semibold leading-tight">
              Cotiza, conversa y cobra — todo desde un mismo chat.
            </p>
            <p className="text-sm text-foreground/70">
              Atiende ya es el portal operativo de tu tienda: el cliente escribe
              por WhatsApp, el agente responde y tú cierras la venta.
            </p>
          </div>
          <p className="text-xs text-foreground/40">
            Modo de pruebas · sin dinero real · v2
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Logo de la marca, alineado a la izquierda en la mitad del formulario. Mismo
 * SVG que el resto del portal para que sea una sola identidad, no dos
 * diferentes en login y en el shell.
 */
function Brand() {
  return (
    <Link
      href="/login"
      aria-label="Atiende ya — ir a iniciar sesión"
      className="flex w-fit items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <SellLogo className="h-8 w-8" />
      <span className="flex flex-col leading-tight">
        <span className="font-display text-sm font-semibold text-foreground">Atiende ya</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Portal operativo
        </span>
      </span>
    </Link>
  );
}

function SellLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect width="36" height="36" rx="10" fill="currentColor" className="text-primary" />
      <path
        d="M9 12h2.5l2.3 9.5h11l2-6H13l-.5-2H10l-.5-2H9z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        className="text-primary-foreground"
        fill="none"
      />
      <circle cx="16" cy="26.5" r="1.5" stroke="currentColor" strokeWidth="1.5" className="text-primary-foreground" fill="none" />
      <circle cx="24" cy="26.5" r="1.5" stroke="currentColor" strokeWidth="1.5" className="text-primary-foreground" fill="none" />
      <path d="M18 9a4 4 0 0 1 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-primary-foreground" fill="none" />
    </svg>
  );
}

/**
 * Sello geométrico sutil que viste el panel de marca sin distraer del
 * formulario. Todo el color sale de tokens (`primary`, `cta`, `border`):
 * nada de hex crudo, regla 0.1 del sistema.
 */
function BrandBackdrop() {
  return (
    <>
      {/* Sello geométrico: tres círculos concéntricos con corte radial. Las
          líneas usan --border (ya pensado para vivir tenue sobre superficies
          oscuras); los dos círculos rellenos son el acorde indigo + verde. */}
      <svg
        aria-hidden
        viewBox="0 0 600 600"
        className="absolute -right-32 -bottom-32 h-[640px] w-[640px] opacity-30"
        fill="none"
      >
        <circle cx="300" cy="300" r="280" stroke="currentColor" strokeWidth="1" className="text-border" />
        <circle cx="300" cy="300" r="220" stroke="currentColor" strokeWidth="1" className="text-border" />
        <circle cx="300" cy="300" r="160" stroke="currentColor" strokeWidth="1" className="text-border" />
        <circle cx="300" cy="300" r="100" stroke="currentColor" strokeWidth="1" className="text-border" />
        <line x1="0" y1="300" x2="600" y2="300" stroke="currentColor" strokeWidth="1" className="text-border" />
        <line x1="300" y1="0" x2="300" y2="600" stroke="currentColor" strokeWidth="1" className="text-border" />
        <line x1="0" y1="0" x2="600" y2="600" stroke="currentColor" strokeWidth="1" className="text-border" />
        <line x1="600" y1="0" x2="0" y2="600" stroke="currentColor" strokeWidth="1" className="text-border" />
        <circle cx="300" cy="300" r="48" fill="currentColor" className="text-primary" />
        <circle cx="300" cy="300" r="32" fill="currentColor" className="text-cta" />
      </svg>
    </>
  );
}
