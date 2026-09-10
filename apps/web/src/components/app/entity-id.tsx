"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface EntityIdProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Identificador completo (UUID, token, folio). */
  value: string;
  /** Caracteres visibles antes del elipsis. */
  length?: number;
  /** Muestra el botón de copiar. */
  copyable?: boolean;
  /** Nombre accesible del botón. */
  copyLabel?: string;
  /** Texto del toast de éxito. */
  toastLabel?: string;
  className?: string;
}

/**
 * Copia al portapapeles con degradación limpia: en contexto no seguro (http)
 * o en navegadores sin la API, `navigator.clipboard` no existe. En vez de
 * reventar, mostramos el valor en un toast para que se pueda seleccionar a mano.
 */
async function copyValue(value: string, toastLabel: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      toast.success(`${toastLabel} copiado`);
      return true;
    }
  } catch {
    // permiso denegado o documento sin foco: caemos al toast informativo
  }
  toast.message(toastLabel, { description: value });
  return false;
}

/**
 * Identificador truncado en monoespaciada, con el valor completo en `title` y
 * un botón de copiar. Sustituye al patrón repetido
 * `<span className="font-mono text-xs">{id.slice(0, 8)}…</span>`.
 *
 * El valor completo también va en un `sr-only`: un lector de pantalla anuncia
 * el id entero, no "abc123 puntos suspensivos".
 *
 * @example
 * <EntityId value={order.id} />
 * <EntityId value={session.id} length={12} copyable={false} />
 * <TableCell><EntityId value={payment.id} toastLabel="ID de pago" /></TableCell>
 */
export const EntityId = React.forwardRef<HTMLSpanElement, EntityIdProps>(
  (
    {
      className,
      value,
      length = 8,
      copyable = true,
      copyLabel = "Copiar id",
      toastLabel = "ID",
      ...props
    },
    ref,
  ) => {
    const [copied, setCopied] = React.useState(false);
    const timeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(
      () => () => {
        if (timeout.current) clearTimeout(timeout.current);
      },
      [],
    );

    const truncated = value.length > length ? `${value.slice(0, length)}…` : value;

    async function onCopy(event: React.MouseEvent) {
      // Dentro de una fila navegable de DataTable, copiar no debe navegar.
      event.stopPropagation();
      await copyValue(value, toastLabel);
      setCopied(true);
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setCopied(false), 1500);
    }

    return (
      <span ref={ref} className={cn("inline-flex items-center gap-1", className)} {...props}>
        <span title={value} className="font-mono text-xs">
          <span aria-hidden>{truncated}</span>
          <span className="sr-only">{value}</span>
        </span>
        {copyable ? (
          <button
            type="button"
            onClick={onCopy}
            aria-label={copyLabel}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
          >
            {copied ? (
              <Check aria-hidden className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy aria-hidden className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
      </span>
    );
  },
);
EntityId.displayName = "EntityId";
