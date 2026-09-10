import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Ícono de lucide-react ya renderizado. Decorativo: se marca aria-hidden. */
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** Acción primaria (normalmente un `<Button>`). */
  action?: React.ReactNode;
}

/**
 * Estado vacío sobrio: sin ilustración, sin dependencias. Se usa cuando la
 * consulta trajo cero filas (no para errores — ahí va `Alert`).
 *
 * @example
 * <EmptyState
 *   icon={<PackageOpen className="h-6 w-6" />}
 *   title="Sin pedidos"
 *   description="Cuando entre la primera venta la verás aquí."
 *   action={<Button onClick={onNew}>Nuevo pedido</Button>}
 * />
 */
export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, icon, title, description, action, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-14 text-center",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden
          className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          {icon}
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="text-base font-semibold">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  ),
);
EmptyState.displayName = "EmptyState";
