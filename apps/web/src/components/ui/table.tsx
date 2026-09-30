import * as React from "react";
import { cn } from "@/lib/utils";

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /**
   * Fija el `<thead>` al hacer scroll vertical dentro del contenedor.
   * Requiere que el contenedor tenga altura acotada (`containerClassName`).
   */
  stickyHeader?: boolean;
  /** Clases para el div con overflow que envuelve la tabla. */
  containerClassName?: string;
  /**
   * Fija la primera columna al hacer scroll horizontal (móvil): la celda
   * identificadora (folio, SKU, cliente) siempre visible. Las celdas fijas
   * llevan el fondo de la tarjeta para tapar lo que pasa debajo.
   */
  stickyFirstColumn?: boolean;
}

/**
 * Tabla semántica con contenedor de scroll horizontal propio. El contenedor
 * lleva `.scroll-x-shadow` (globals.css): una sombra en el borde indica que
 * hay más columnas y desaparece al llegar al final.
 * `data-ui-table` la excluye de la regla móvil global de globals.css.
 *
 * @example
 * <Table stickyHeader containerClassName="max-h-[60vh]">
 *   <TableHeader>
 *     <TableRow>
 *       <TableHead>SKU</TableHead>
 *       <TableHead numeric>Total</TableHead>
 *     </TableRow>
 *   </TableHeader>
 *   <TableBody>
 *     <TableRow>
 *       <TableCell className="font-mono text-xs">ABC-1</TableCell>
 *       <TableCell numeric>1,240.00</TableCell>
 *     </TableRow>
 *   </TableBody>
 * </Table>
 */
const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, containerClassName, stickyHeader = false, stickyFirstColumn = false, ...props }, ref) => (
    <div className={cn("scroll-x-shadow relative w-full overflow-auto", containerClassName)}>
      <table
        ref={ref}
        data-ui-table=""
        data-sticky-header={stickyHeader ? "" : undefined}
        className={cn(
          // Celdas en body-sm (14px); la cabecera baja a caption (13px) en
          // mayúsculas. Nada dentro de una tabla va por debajo de 13px salvo
          // chips `size="sm"` (micro, 12px).
          "w-full caption-bottom border-collapse text-body-sm",
          stickyFirstColumn &&
            "[&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0 [&_tr>*:first-child]:z-[1] [&_tr>*:first-child]:bg-card",
          className,
        )}
        {...props}
      />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      "[&_tr]:border-b [&_tr]:border-hairline",
      // El sticky se activa desde el <table data-sticky-header>.
      "[[data-sticky-header]_&]:sticky [[data-sticky-header]_&]:top-0 [[data-sticky-header]_&]:z-10 [[data-sticky-header]_&]:bg-card",
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t border-hairline bg-card font-medium [&>tr]:last:border-b-0", className)}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Desactiva el hover cuando la fila no es interactiva ni escaneable. */
  interactive?: boolean;
}

const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, interactive = true, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-hairline-soft transition-colors",
        interactive && "hover:bg-muted data-[state=selected]:bg-secondary",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Columna numérica: alineada a la derecha y con cifras tabulares. */
  numeric?: boolean;
}

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, numeric = false, scope = "col", ...props }, ref) => (
    <th
      ref={ref}
      scope={scope}
      className={cn(
        "h-10 px-3 text-left align-middle text-caption font-medium uppercase tracking-wide text-muted-foreground",
        numeric && "text-right tabular-nums",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /** Celda numérica: alineada a la derecha y con cifras tabulares. */
  numeric?: boolean;
}

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, numeric = false, ...props }, ref) => (
    <td
      ref={ref}
      className={cn("px-3 py-2.5 align-middle", numeric && "text-right tabular-nums", className)}
      {...props}
    />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-3 text-caption text-muted-foreground", className)} {...props} />
));
TableCaption.displayName = "TableCaption";

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
};
