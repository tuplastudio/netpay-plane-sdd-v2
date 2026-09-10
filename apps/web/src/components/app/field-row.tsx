import * as React from "react";
import { cn } from "@/lib/utils";

export interface DescriptionListProps extends React.HTMLAttributes<HTMLDListElement> {
  /**
   * `divided` separa cada par con una hairline: mejor para bloques largos
   * (línea de tiempo, ficha de cliente). Por defecto va sin líneas.
   */
  divided?: boolean;
}

/**
 * Contenedor `<dl>` para pantallas de detalle. Sus hijos deben ser `FieldRow`.
 *
 * @example
 * <DescriptionList divided>
 *   <FieldRow label="Cliente">{order.customer.fullName}</FieldRow>
 *   <FieldRow label="Total" numeric><Money value={order.total} emphasis /></FieldRow>
 * </DescriptionList>
 */
export const DescriptionList = React.forwardRef<HTMLDListElement, DescriptionListProps>(
  ({ className, divided = false, ...props }, ref) => (
    <dl
      ref={ref}
      className={cn(
        "text-sm",
        divided ? "divide-y divide-hairline-soft" : "space-y-2 sm:space-y-1",
        className,
      )}
      {...props}
    />
  ),
);
DescriptionList.displayName = "DescriptionList";

export interface FieldRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  label: React.ReactNode;
  /** Valor. Si es `null`/`undefined`/`""` se pinta un em dash. */
  children?: React.ReactNode;
  /** Fuente monoespaciada: ids, SKUs, tokens. */
  mono?: boolean;
  /** Alinea el valor a la derecha con cifras tabulares. */
  numeric?: boolean;
  /** Destaca el valor (renglón de total). */
  emphasis?: boolean;
  /** Nota bajo el valor: unidades, aclaraciones. */
  hint?: React.ReactNode;
}

function isEmpty(v: React.ReactNode): boolean {
  return v === null || v === undefined || v === "" || v === false;
}

/**
 * Par etiqueta/valor. Apilado en móvil, dos columnas desde `sm`
 * (etiqueta fija, valor flexible). Sustituye a los `<div className="flex
 * justify-between"><dt/><dd/></div>` ad-hoc de las páginas de detalle.
 *
 * @example
 * <FieldRow label="ID" mono>{order.id}</FieldRow>
 * <FieldRow label="Pagado"><DateTime value={order.paidAt} /></FieldRow>
 * <FieldRow label="Total" numeric emphasis><Money value={order.total} /></FieldRow>
 */
export const FieldRow = React.forwardRef<HTMLDivElement, FieldRowProps>(
  ({ className, label, children, mono = false, numeric = false, emphasis = false, hint, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col gap-0.5 py-1.5 sm:grid sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:items-baseline sm:gap-4",
        className,
      )}
      {...props}
    >
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd
        className={cn(
          "min-w-0 break-words text-foreground",
          mono && "font-mono text-xs sm:text-[13px]",
          numeric && "tabular-nums sm:text-right",
          emphasis && "font-semibold",
        )}
      >
        {isEmpty(children) ? (
          <>
            <span aria-hidden className="text-muted-foreground">
              —
            </span>
            <span className="sr-only">Sin dato</span>
          </>
        ) : (
          children
        )}
        {hint ? <span className="ml-2 text-xs text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  ),
);
FieldRow.displayName = "FieldRow";
