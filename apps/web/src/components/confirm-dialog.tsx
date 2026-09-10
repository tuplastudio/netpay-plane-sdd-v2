"use client";

import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  pending?: boolean;
  onConfirm: () => void;
  /**
   * Si viene, el botón de confirmar queda deshabilitado hasta que el usuario
   * escriba **exactamente** este texto (case-insensitive). Pensado para
   * acciones destructivas sobre entidades con nombre: pegar el slug / nombre
   * delinea la acción y atrapa los clics por error.
   *
   * `requireTextPlaceholder` opcional lo muestra a la izquierda del input
   * como ejemplo (no es interactivo, es solo visual).
   */
  requireText?: string;
  requireTextPlaceholder?: string;
  /** Deshabilita el botón de confirmar además de (o en vez de) `requireText`. */
  confirmDisabled?: boolean;
  /** Contenido extra entre la descripción y el pie: un campo, una lista, etc. */
  children?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "destructive",
  pending = false,
  onConfirm,
  requireText,
  requireTextPlaceholder,
  confirmDisabled = false,
  children,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState("");
  // Reset al cerrar: si reabres para la misma entidad quieres tipear de nuevo,
  // y si reabres para otra distinta el "typed" anterior no debería colar.
  React.useEffect(() => {
    if (!open) setTyped("");
  }, [open]);
  const matches = !requireText || typed.trim().toLowerCase() === requireText.toLowerCase();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {requireText ? (
          <div className="space-y-2">
            <Label htmlFor="confirm-require-text" className="text-sm">
              Para confirmar, escribe{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {requireTextPlaceholder ?? requireText}
              </code>
            </Label>
            <Input
              id="confirm-require-text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              disabled={pending}
              aria-describedby="confirm-require-text-hint"
            />
            <p
              id="confirm-require-text-hint"
              className="text-xs text-muted-foreground"
              aria-live="polite"
            >
              {matches
                ? "Listo, puedes confirmar."
                : "El texto no coincide todavía."}
            </p>
          </div>
        ) : null}
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          {/* La etiqueta NO cambia mientras se envía: relabelar un control
              ocupado hace que el lector de pantalla lo relea como si fuera otro
              botón. `loading` pone Spinner + aria-busy + disabled, y ese
              disabled es lo que corta el segundo clic de un doble clic. */}
          <AlertDialogAction
            variant={variant}
            loading={pending}
            disabled={!matches || confirmDisabled}
            onClick={() => onConfirm()}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
