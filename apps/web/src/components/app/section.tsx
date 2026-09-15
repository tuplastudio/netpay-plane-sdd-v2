import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export interface SectionProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  /** Título de la sección. Se rinde como `<h2>` para no romper el orden de encabezados. */
  title?: React.ReactNode;
  /**
   * Ícono de lucide junto al título. Se rinde como HERMANO del encabezado y
   * `aria-hidden`, no dentro del `<h2>`: el nombre accesible de la sección debe
   * ser el texto del título, sin markup decorativo mezclado.
   *
   * No metas el ícono dentro de `title`.
   */
  headerIcon?: React.ReactNode;
  description?: React.ReactNode;
  /** Botones o filtros alineados a la derecha del título. */
  actions?: React.ReactNode;
  /** Pie de la sección, separado por una línea. */
  footer?: React.ReactNode;
  /**
   * `false` quita el padding del cuerpo. Úsalo cuando el hijo es una tabla o un
   * `DataTable`, que ya traen su propio padding por celda y deben pegarse al
   * borde de la tarjeta.
   */
  padded?: boolean;
  /**
   * Densidad del padding interno.
   * - `default`: `p-4 sm:p-6`, para el cuerpo principal de una pantalla.
   * - `compact`: `p-3`, para columnas estrechas y barras laterales (~20rem),
   *   donde `sm:p-6` se come el ancho útil.
   *
   * Usa esto en vez de pisar el padding con `contentClassName`.
   */
  density?: "default" | "compact";
  /** Nivel del encabezado, por si la sección vive anidada. */
  as?: "h2" | "h3" | "h4";
  className?: string;
  contentClassName?: string;
}

/**
 * Bloque estándar de una pantalla: tarjeta con encabezado, cuerpo y pie con
 * espaciado consistente. Sustituye a los `<div className="rounded-card border
 * bg-card p-4">` sueltos que hoy se repiten en las páginas de detalle.
 *
 * @example
 * <Section title="Totales" description="Incluye IVA.">
 *   <DescriptionList>
 *     <FieldRow label="Subtotal"><Money value={order.subtotal} /></FieldRow>
 *   </DescriptionList>
 * </Section>
 *
 * @example
 * // Ícono como hermano del <h2>, no dentro de él.
 * <Section title="Canales" headerIcon={<MessageCircle className="h-4 w-4" />}>…</Section>
 *
 * @example
 * // Con tabla: sin padding en el cuerpo.
 * <Section title="Pagos" padded={false} actions={<Button size="sm">Cobrar</Button>}>
 *   <DataTable columns={cols} rows={order.payments} empty={{ title: "Sin pagos" }} />
 * </Section>
 */
export const Section = React.forwardRef<HTMLElement, SectionProps>(
  (
    {
      className,
      contentClassName,
      title,
      headerIcon,
      description,
      actions,
      footer,
      padded = true,
      density = "default",
      as: Heading = "h2",
      children,
      ...props
    },
    ref,
  ) => {
    const hasHeader = Boolean(title || description || actions || headerIcon);
    const compact = density === "compact";
    const headerPad = compact ? "p-3 pb-2" : "p-4 sm:p-6 sm:pb-4";
    const bodyPad = compact ? "p-3" : "p-4 sm:p-6";
    const bodyPadTop = compact ? "pt-0" : "pt-0 sm:pt-0";
    const footerPad = compact ? "p-3" : "p-4 sm:px-6";
    return (
      <Card asChild>
        <section ref={ref} className={cn("overflow-hidden", className)} {...props}>
          {hasHeader ? (
            <div
              className={cn(
                "flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
                headerPad,
              )}
            >
              <div className="min-w-0 space-y-1">
                {title || headerIcon ? (
                  <div className="flex items-center gap-2">
                    {headerIcon ? (
                      <span aria-hidden className="shrink-0 text-muted-foreground">
                        {headerIcon}
                      </span>
                    ) : null}
                    {title ? (
                      <Heading className="font-display text-base font-semibold leading-none tracking-tight">
                        {title}
                      </Heading>
                    ) : null}
                  </div>
                ) : null}
                {description ? (
                  <p className="text-sm text-muted-foreground">{description}</p>
                ) : null}
              </div>
              {actions ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
              ) : null}
            </div>
          ) : null}

          <div
            className={cn(
              padded ? bodyPad : "",
              hasHeader && padded ? bodyPadTop : "",
              contentClassName,
            )}
          >
            {children}
          </div>

          {footer ? (
            <div className={cn("flex flex-wrap items-center gap-2 border-t", footerPad)}>{footer}</div>
          ) : null}
        </section>
      </Card>
    );
  },
);
Section.displayName = "Section";
