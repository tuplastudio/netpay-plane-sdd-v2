"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Radix enlaza `aria-describedby` del Content a un id generado SIEMPRE, exista
 * o no una Description. Sin Description ese id no apunta a nada: referencia
 * colgada, y Radix además avisa en consola. `AlertDialogDescription` se
 * registra aquí al montarse para que el Content sepa si debe dejar el enlace o
 * anularlo.
 */
const DescriptionRegistry = React.createContext<(() => void) | null>(null);

const AlertDialog = DialogPrimitive.Root;
const AlertDialogTrigger = DialogPrimitive.Trigger;
const AlertDialogPortal = DialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
AlertDialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>((
  { className, children, onEscapeKeyDown, onPointerDownOutside, onInteractOutside, ...props },
  ref,
) => {
  const [hasDescription, setHasDescription] = React.useState(false);
  const register = React.useCallback(() => setHasDescription(true), []);

  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        // Escape SÍ cierra: bloquearlo dejaba "Cancelar" como única salida, que
        // es un keyboard trap (WCAG 2.1.2). Cerrar por Escape pasa por
        // `onOpenChange(false)`, o sea cancelar — nunca confirmar.
        onEscapeKeyDown={onEscapeKeyDown}
        // El clic fuera sigue bloqueado a propósito: este diálogo confirma
        // acciones destructivas (reembolsos, cancelaciones, archivar) y un
        // clic perdido no debe descartarlo.
        onPointerDownOutside={(event) => {
          onPointerDownOutside?.(event);
          event.preventDefault();
        }}
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          event.preventDefault();
        }}
        // Sin Description, anulamos el enlace que Radix genera por defecto.
        {...(hasDescription ? {} : { "aria-describedby": undefined })}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2",
          "space-y-4 rounded-card border bg-background p-6 shadow-airbnb-lg",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      >
        <DescriptionRegistry.Provider value={register}>{children}</DescriptionRegistry.Provider>
      </DialogPrimitive.Content>
    </AlertDialogPortal>
  );
});
AlertDialogContent.displayName = DialogPrimitive.Content.displayName;

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-left", className)} {...props} />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
);
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
));
AlertDialogTitle.displayName = DialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, children, ...props }, ref) => {
  // Avisa al Content de que sí hay descripción, para que conserve el
  // `aria-describedby` que genera Radix.
  const register = React.useContext(DescriptionRegistry);
  React.useEffect(() => {
    register?.();
  }, [register]);

  return (
    // asChild + <div>: Radix's Description defaults to <p>, which breaks as
    // soon as callers need block content (forms, lists) in the description.
    <DialogPrimitive.Description asChild {...props}>
      <div ref={ref} className={cn("text-sm text-muted-foreground", className)}>
        {children}
      </div>
    </DialogPrimitive.Description>
  );
});
AlertDialogDescription.displayName = DialogPrimitive.Description.displayName;

export interface AlertDialogActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive";
  /**
   * Misma semántica que `Button.loading`: muestra el spinner, marca
   * `aria-busy`, deshabilita el botón y **no cambia la etiqueta** (cambiarla
   * hace que el lector de pantalla la relea como si fuera otro control).
   */
  loading?: boolean;
}

/**
 * Acción confirmatoria del diálogo. Es un `Button` de verdad, así que hereda
 * `loading`, foco y estados sin que el consumidor inline un spinner a mano.
 *
 * @example
 * <AlertDialogAction loading={mutation.isPending} onClick={onConfirm}>
 *   Archivar
 * </AlertDialogAction>
 */
const AlertDialogAction = React.forwardRef<HTMLButtonElement, AlertDialogActionProps>(
  ({ className, variant = "destructive", loading = false, ...props }, ref) => (
    <Button ref={ref} variant={variant} size="default" loading={loading} className={className} {...props} />
  ),
);
AlertDialogAction.displayName = "AlertDialogAction";

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Close
    ref={ref}
    className={cn(buttonVariants({ variant: "outline", size: "default" }), className)}
    {...props}
  />
));
AlertDialogCancel.displayName = "AlertDialogCancel";

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
