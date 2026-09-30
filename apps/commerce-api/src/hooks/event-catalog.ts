/**
 * Catálogo de eventos que un hook saliente puede suscribir.
 *
 * Es la única lista: la usa el DTO (para rechazar nombres desconocidos), el
 * panel (`GET /hooks/events`, con descripción y ejemplo de `data`) y la
 * documentación. Agregar un evento = agregar una entrada aquí + emitirlo
 * desde el servicio que cierra la acción (ver `event-data.ts`).
 *
 * Los ejemplos son tenant-neutrales y sin datos reales.
 */

export interface HookEventDefinition {
  name: string;
  /** Área funcional para agrupar en el panel. */
  group: "Pedidos" | "Cotizaciones" | "Pagos" | "Clientes" | "Conversaciones" | "Catálogo" | "Sistema";
  description: string;
  /** Ejemplo de `data` del sobre. */
  example: Record<string, unknown>;
}

const ORDER_EXAMPLE = {
  orderId: "5f0c2a1e-7d3b-4e9a-9c1d-2b8e6f4a1c33",
  status: "DRAFT",
  source: "QUOTE",
  quoteId: "0b1d9f3a-2c4e-4a6b-8d0f-1e2a3b4c5d6e",
  customerId: "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d",
  subtotal: "1000.00",
  discount: "0.00",
  tax: "160.00",
  shipping: "0.00",
  total: "1160.00",
  currency: "MXN",
  createdAt: "2026-01-15T17:05:00.000Z",
};

export const HOOK_EVENTS: ReadonlyArray<HookEventDefinition> = [
  {
    name: "order.created",
    group: "Pedidos",
    description:
      "Se creó un pedido (directo, cobro rápido o a partir de una cotización aceptada).",
    example: ORDER_EXAMPLE,
  },
  {
    name: "order.paid",
    group: "Pedidos",
    description: "El pedido quedó pagado: la pasarela confirmó el cobro y el pedido pasó a PAID.",
    example: { ...ORDER_EXAMPLE, status: "PAID", paidAt: "2026-01-15T17:20:00.000Z" },
  },
  {
    name: "quote.issued",
    group: "Cotizaciones",
    description: "Una cotización pasó de borrador a emitida (ISSUED) y ya puede compartirse.",
    example: {
      quoteId: "0b1d9f3a-2c4e-4a6b-8d0f-1e2a3b4c5d6e",
      status: "ISSUED",
      customerId: "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d",
      subtotal: "1000.00",
      tax: "160.00",
      total: "1160.00",
      currency: "MXN",
      issuedAt: "2026-01-15T16:00:00.000Z",
      expiresAt: "2026-01-22T16:00:00.000Z",
    },
  },
  {
    name: "quote.accepted",
    group: "Cotizaciones",
    description: "El cliente (o un vendedor) aceptó la cotización; normalmente sigue order.created.",
    example: {
      quoteId: "0b1d9f3a-2c4e-4a6b-8d0f-1e2a3b4c5d6e",
      status: "ACCEPTED",
      customerId: "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d",
      total: "1160.00",
      currency: "MXN",
      acceptedAt: "2026-01-15T17:00:00.000Z",
    },
  },
  {
    name: "payment.succeeded",
    group: "Pagos",
    description: "La pasarela capturó un cobro. `orderPaid` indica si el pedido pasó a PAID.",
    example: {
      sessionId: "3c2b1a0f-9e8d-4c7b-a6f5-4e3d2c1b0a99",
      orderId: "5f0c2a1e-7d3b-4e9a-9c1d-2b8e6f4a1c33",
      amount: "1160.00",
      currency: "MXN",
      status: "CAPTURED",
      paymentMethod: "card",
      orderPaid: true,
      capturedAt: "2026-01-15T17:20:00.000Z",
    },
  },
  {
    name: "payment.failed",
    group: "Pagos",
    description: "Un intento de cobro falló o fue rechazado por la pasarela.",
    example: {
      sessionId: "3c2b1a0f-9e8d-4c7b-a6f5-4e3d2c1b0a99",
      orderId: "5f0c2a1e-7d3b-4e9a-9c1d-2b8e6f4a1c33",
      amount: "1160.00",
      currency: "MXN",
      status: "FAILED",
      paymentMethod: "card",
      failedAt: "2026-01-15T17:20:00.000Z",
    },
  },
  {
    name: "customer.created",
    group: "Clientes",
    description:
      "Se dio de alta un cliente (desde el panel, el API o al escribir por primera vez por WhatsApp).",
    example: {
      customerId: "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d",
      fullName: "Nombre del cliente",
      email: "cliente@ejemplo.com",
      phone: "5215512345678",
      source: "panel",
      createdAt: "2026-01-15T15:00:00.000Z",
    },
  },
  {
    name: "conversation.handoff",
    group: "Conversaciones",
    description:
      "Una conversación pasó a atención humana: el agente escaló (`source: agent`) o una persona la tomó/asignó (`source: human`).",
    example: {
      conversationId: "7e6d5c4b-3a29-4f18-b07c-6d5e4f3a2b1c",
      customerId: "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d",
      assignedUserId: null,
      source: "agent",
      handoffAt: "2026-01-15T18:30:00.000Z",
    },
  },
  {
    name: "product.updated",
    group: "Catálogo",
    description: "Se editó un producto o una de sus variantes (título, precio, existencias, estado).",
    example: {
      productId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      variantId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
      sku: "SKU-001",
      title: "Producto de ejemplo",
      status: "ACTIVE",
      version: 4,
      updatedAt: "2026-01-15T12:00:00.000Z",
    },
  },
  {
    name: "ping",
    group: "Sistema",
    description: "Evento de prueba que manda el botón «Probar» del panel. No se puede suscribir.",
    example: { message: "pong", hookId: "c0ffee00-0000-4000-8000-000000000000" },
  },
];

/** Nombre del evento de prueba: se manda a demanda, nunca por suscripción. */
export const PING_EVENT = "ping";

/** Eventos suscribibles (todo el catálogo menos `ping`). */
export const SUBSCRIBABLE_EVENTS: ReadonlyArray<string> = HOOK_EVENTS.filter(
  (e) => e.name !== PING_EVENT,
).map((e) => e.name);

export function isSubscribableEvent(name: unknown): name is string {
  return typeof name === "string" && SUBSCRIBABLE_EVENTS.includes(name);
}
