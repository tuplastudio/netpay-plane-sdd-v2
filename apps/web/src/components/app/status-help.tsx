"use client";

import { Info } from "lucide-react";
import { StatusBadge, statusLabel, type StatusDomain } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Qué significa cada estado, en una frase, para pedidos, pagos y cotizaciones.
 * Es lo que se muestra en el tooltip de `StatusBadgeHelp` y en el texto de
 * apoyo de la página pública de seguimiento. La etiqueta corta sigue viviendo
 * en `status-badge.tsx`; aquí solo va la explicación.
 */
export const STATUS_HELP: Partial<Record<StatusDomain, Record<string, string>>> = {
  order: {
    DRAFT: "Pedido creado, todavía sin checkout: no se ha reservado stock ni se puede pagar.",
    CHECKOUT_OPEN: "Checkout abierto con stock reservado. El cliente ya puede abrir el link de pago.",
    AWAITING_PAYMENT: "El cliente abrió el pago en la pasarela; se espera la confirmación del cobro.",
    PAID: "Cobro confirmado por la pasarela. Falta preparar y entregar el pedido.",
    FULFILLED: "Pedido pagado y entregado al cliente.",
    CANCELLED: "Cancelado antes de cobrarse; la reserva de stock se liberó.",
    EXPIRED: "El checkout venció sin pago; la reserva de stock se liberó.",
    REFUNDED: "El cobro se devolvió por completo al cliente.",
  },
  payment: {
    PENDING: "Sesión de cobro abierta en la pasarela; el cliente aún no paga.",
    AUTHORIZED: "Fondos autorizados por el banco, pendientes de captura.",
    CAPTURED: "Dinero cobrado. Es el estado normal de un pago exitoso.",
    FAILED: "La pasarela rechazó el pago. El cliente puede intentarlo de nuevo.",
    REFUNDED: "Se devolvió el importe completo de esta sesión.",
    PARTIALLY_REFUNDED: "Se devolvió una parte; el resto sigue cobrado.",
    CANCELLED: "Sesión reemplazada por otro intento de pago; no dice nada del resultado.",
    UNKNOWN: "La pasarela no reportó un estado reconocible.",
  },
  quote: {
    DRAFT: "Se puede editar; el cliente todavía no la ve.",
    ISSUED: "Emitida y compartible; el cliente puede aceptarla y pagarla hasta la fecha de vigencia.",
    ACCEPTED: "Aceptada: ya generó un pedido con estas líneas y precios.",
    EXPIRED: "Venció sin aceptarse; los precios ya no están garantizados.",
    CANCELLED: "Cancelada por el negocio; no se puede aceptar ni pagar.",
  },
};

export function statusHelp(status: string, domain: StatusDomain): string | null {
  return STATUS_HELP[domain]?.[status] ?? null;
}

/**
 * `StatusBadge` con tooltip que explica el estado. En pantallas táctiles el
 * tooltip va cerrado (ver `tooltip.tsx`), por eso la explicación también
 * viaja en `aria-label` y como `title`: nunca se pierde.
 */
export function StatusBadgeHelp({
  status,
  domain,
  withDot = true,
  size,
}: {
  status: string;
  domain: StatusDomain;
  withDot?: boolean;
  size?: "sm" | "default";
}) {
  const help = statusHelp(status, domain);
  if (!help) return <StatusBadge status={status} domain={domain} withDot={withDot} size={size} />;
  const label = statusLabel(status, domain);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`${label}: ${help}`}
            title={help}
            className="inline-flex items-center gap-1 rounded-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <StatusBadge status={status} domain={domain} withDot={withDot} size={size} />
            <Info aria-hidden className="h-3 w-3 text-muted-foreground" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          {help}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
