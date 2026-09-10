"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Patrón compartido de las cinco pantallas de autenticación (login, MFA,
 * recuperar, restablecer, aceptar invitación). Vive aquí para que las cinco
 * compartan lienzo, ancho, tipografía y ritmo vertical sin copiar clases.
 *
 * Es composición de primitivas del DS: no reimplementa `Alert`, `Label`,
 * `Button` ni tokens de color.
 */

/** Marca de la pantalla de acceso: el mismo lockup que `Brand` del sidebar. */
export function AuthBrand({ className }: { className?: string }) {
  return (
    <Link
      href="/login"
      aria-label="Easy Sell — ir a iniciar sesión"
      className={cn(
        "mx-auto flex w-fit items-center gap-2 rounded-lg px-2 py-1",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-muted",
        className,
      )}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Sparkles className="h-4 w-4" aria-hidden />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold">Easy Sell</span>
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Portal operativo
        </span>
      </span>
    </Link>
  );
}

export interface AuthCardProps {
  /** `<h1>` de la pantalla. Uno solo por pantalla. */
  title: string;
  description?: React.ReactNode;
  /** Ícono lucide opcional sobre el título (MFA lo usa). */
  icon?: React.ReactNode;
  /** Contenido bajo la tarjeta: enlaces cruzados, ayuda, credenciales demo. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Tarjeta centrada sobre lienzo neutro. Ancho fijo `max-w-sm` en las cinco
 * pantallas para que el salto entre ellas no mueva la caja.
 */
export function AuthCard({ title, description, icon, footer, children }: AuthCardProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted px-4 py-12">
      <div className="w-full max-w-sm">
        <AuthBrand className="mb-6" />

        <section className="rounded-card border bg-card p-6 shadow-airbnb">
          <header className="mb-6 space-y-1.5">
            {icon ? <div className="mb-3 text-primary">{icon}</div> : null}
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </header>

          {children}
        </section>

        {footer ? (
          <div className="mt-6 space-y-2 text-center text-xs text-muted-foreground">{footer}</div>
        ) : null}
      </div>
    </main>
  );
}

/** Formulario de la tarjeta: mismo ritmo vertical en las cinco pantallas. */
export function AuthForm({
  className,
  ...props
}: React.FormHTMLAttributes<HTMLFormElement>) {
  return <form noValidate className={cn("space-y-5", className)} {...props} />;
}

export interface AuthFieldProps {
  id: string;
  label: string;
  /** Texto de ayuda permanente; se enlaza con `aria-describedby`. */
  hint?: React.ReactNode;
  /** Mensaje de error; se enlaza con `aria-describedby` y activa `aria-invalid`. */
  error?: string;
  /**
   * Render prop: recibe ya resueltos `id`, `aria-invalid` y `aria-describedby`
   * para pegarlos al control. Así no hay forma de olvidar el cableado.
   */
  children: (props: {
    id: string;
    "aria-invalid": true | undefined;
    "aria-describedby": string | undefined;
  }) => React.ReactNode;
}

export function AuthField({ id, label, hint, error, children }: AuthFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Error de API en bloque. `Alert variant="destructive"` ya trae `role="alert"`;
 * se pasa explícito para que no dependa de la variante.
 */
export function AuthError({
  message,
  title = "No se pudo continuar",
}: {
  message?: string | null;
  title?: string;
}) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircle aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/**
 * Traduce un error de axios a un texto legible. Nunca devuelve el objeto de
 * error serializado: si el status no está mapeado, cae al texto de respaldo.
 */
export function authErrorMessage(
  err: unknown,
  fallback: string,
  byStatus: Record<number, string> = {},
): string {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (typeof status === "number" && byStatus[status]) return byStatus[status];
  return fallback;
}

/** Enlace cruzado del pie de la tarjeta (login ↔ recuperar, etc.). */
export function AuthLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        // Enlace de texto: lleva la tinta, así que es nivel TEXTO
        // (primary-strong, 5.20:1) y no el ornamento (primary, 3.52:1).
        "rounded-sm text-primary-strong underline-offset-4 hover:underline",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-muted",
        className,
      )}
    >
      {children}
    </Link>
  );
}
