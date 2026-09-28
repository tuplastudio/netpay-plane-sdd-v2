import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ON_HERO_MUTED } from "@/lib/hero";

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
        <main className="flex flex-1 items-start justify-center px-4 pb-8 pt-12 sm:items-center sm:px-10 sm:py-8">
          <div className="w-full max-w-sm">{children}</div>
        </main>
        {footer ? (
          <footer className="px-6 py-4 text-center text-xs text-muted-foreground sm:px-10">
            {footer}
          </footer>
        ) : null}
      </div>

      {/* Mitad derecha: banda `hero-dark` (teal → menta) montada sobre el
          lienzo — el degradado es una TARJETA, nunca el fondo de la sección. */}
      <div className="hidden bg-background p-4 lg:block">
        <div className="hero-dark h-full">
          <BrandBackdrop />
          <div className="relative z-10 flex h-full flex-col justify-between p-10 xl:p-14">
            <div className="flex w-fit items-center gap-2 rounded-pill bg-on-hero px-3 py-1.5 text-caption font-medium text-on-hero-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              Portal operativo
            </div>
            <div className="max-w-xl space-y-5">
              <p className="font-display text-display-lg">
                Cotiza, conversa y cobra desde un mismo chat.
              </p>
              <p className={cn("max-w-md text-subhead", ON_HERO_MUTED)}>
                El cliente escribe por WhatsApp, el agente responde y tú cierras
                la venta.
              </p>
            </div>
            <p className={cn("text-caption", ON_HERO_MUTED)}>Modo de pruebas · sin dinero real · v2</p>
          </div>
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
      className="flex w-fit items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <SellLogo className="h-8 w-8" />
      <span className="flex flex-col leading-tight">
        <span className="font-display text-sm font-semibold text-foreground">Atiende ya</span>
        <span className="text-micro-uppercase uppercase text-muted-foreground">
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
      <rect width="36" height="36" rx="10" fill="currentColor" className="text-primary-strong" />
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
 * Anillos finos sobre el degradado: textura, no ilustración. Blanco
 * translúcido (decorativo, `aria-hidden`) sobre la banda `hero-dark`.
 */
function BrandBackdrop() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 600 600"
      className="pointer-events-none absolute -bottom-40 -right-40 h-[680px] w-[680px] text-on-hero opacity-[0.14]"
      fill="none"
    >
      {[280, 220, 160, 100].map((r) => (
        <circle key={r} cx="300" cy="300" r={r} stroke="currentColor" strokeWidth="1" />
      ))}
    </svg>
  );
}
