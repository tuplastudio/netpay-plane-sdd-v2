import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Breadcrumb {
  label: string;
  /** Sin `href` = migaja actual (no navegable, marcada `aria-current`). */
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  /** Botones de la pantalla, alineados a la derecha. */
  actions?: React.ReactNode;
  /** Ruta jerárquica. La última migaja se marca como actual. */
  breadcrumbs?: Breadcrumb[];
  /** Flecha "volver" a la izquierda del título. */
  backHref?: string;
  /**
   * Nombre accesible del enlace de volver.
   *
   * Si no lo pasas se deriva de `breadcrumbs`: con
   * `[{ label: "Pedidos", href: "/orders" }, { label: "Detalle" }]` la flecha se
   * anuncia como **"Volver a Pedidos"** en vez del genérico "Volver". Un enlace
   * cuyo nombre no dice a dónde lleva falla WCAG 2.4.4 en cuanto hay más de un
   * "Volver" en la vista, y aquí el destino ya está declarado: no hace falta
   * repetirlo en cada pantalla.
   */
  backLabel?: string;
  /** Fila extra bajo el encabezado: estado, metadatos, filtros. */
  meta?: React.ReactNode;
  className?: string;
}

/**
 * Encabezado de pantalla. Va siempre como primer hijo de la página, seguido del
 * contenido en un contenedor `space-y-6`.
 *
 * @example
 * <PageHeader
 *   title="Pedidos"
 *   description="Checkout público, pasarela de pruebas y ledger simulado."
 *   actions={<Button>Nuevo pedido</Button>}
 * />
 *
 * @example
 * <PageHeader
 *   title={`Venta ${order.id.slice(0, 8)}…`}
 *   backHref="/orders"
 *   breadcrumbs={[{ label: "Pedidos", href: "/orders" }, { label: "Detalle" }]}
 *   meta={<StatusBadge status={order.status} domain="order" />}
 * />
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  backHref,
  backLabel,
  meta,
  className,
}: PageHeaderProps) {
  // La última migaja es la página actual; el destino de "volver" es la migaja
  // navegable más cercana por encima de ella.
  const parentCrumb = breadcrumbs
    ?.slice(0, -1)
    .filter((crumb) => !!crumb.href)
    .at(-1);
  const resolvedBackLabel = backLabel ?? (parentCrumb ? `Volver a ${parentCrumb.label}` : "Volver");

  return (
    <header className={cn("mb-6 space-y-3", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Ruta">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {breadcrumbs.map((crumb, i) => {
              const isLast = i === breadcrumbs.length - 1;
              return (
                <li key={`${crumb.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 ? <ChevronRight aria-hidden className="h-3 w-3 shrink-0" /> : null}
                  {crumb.href && !isLast ? (
                    <Link
                      href={crumb.href}
                      className="rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current={isLast ? "page" : undefined} className="text-foreground">
                      {crumb.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          {backHref ? (
            <Link
              href={backHref}
              aria-label={resolvedBackLabel}
              className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
            >
              <ChevronLeft aria-hidden className="h-4 w-4" />
            </Link>
          ) : null}
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      {meta ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{meta}</div>
      ) : null}
    </header>
  );
}
