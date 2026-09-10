"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { SheetHeader } from "@/components/ui/sheet";

/**
 * Esqueleto de panel con pie fijo: encabezado, cuerpo que hace scroll y pie
 * siempre visible con las acciones. Se compone sobre `SheetContent` pasando
 * `className={SHEET_FRAME_CLASS}` (columna flex sin padding propio: el
 * padding lo pone cada pieza).
 *
 * @example
 * <SheetContent className={SHEET_FRAME_CLASS}>
 *   <SheetFrameHeader><SheetTitle>Nuevo producto</SheetTitle></SheetFrameHeader>
 *   <SheetBody>…campos…</SheetBody>
 *   <SheetFooterBar><Button variant="outline">Cancelar</Button><Button>Guardar</Button></SheetFooterBar>
 * </SheetContent>
 */
export const SHEET_FRAME_CLASS = "flex w-full flex-col p-0 sm:max-w-lg";

export function SheetFrameHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // pr-12 deja libre la esquina donde vive el botón "Cerrar" del panel.
  return <SheetHeader className={cn("shrink-0 px-6 pb-4 pr-12 pt-6", className)} {...props} />;
}

export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-2", className)} {...props} />;
}

export function SheetFooterBar({
  className,
  start,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /** Acción secundaria alineada a la izquierda (p. ej. Archivar). */
  start?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t bg-background px-6 py-4 sm:flex-row sm:items-center sm:justify-end",
        className,
      )}
      {...props}
    >
      {start ? <div className="flex sm:mr-auto">{start}</div> : null}
      {children}
    </div>
  );
}
