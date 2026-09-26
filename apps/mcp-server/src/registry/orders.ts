import type { RouteDef } from "./types.js";

const orderLineFields = {
  variantId: { type: "string" as const, required: true, description: "id de la variante de catálogo (UUID)." },
  quantity: { type: "string" as const, required: true, description: "Decimal de hasta 3 posiciones, p. ej. \"2\" o \"2.000\"." },
  discountPct: { type: "number" as const, description: "0 a 100." },
};

export const orderRoutes: RouteDef[] = [
  {
    name: "orders_list",
    method: "GET",
    path: "/orders",
    description: "Lista pedidos del tenant, opcionalmente filtrados por status.",
    scopes: ["orders.read"],
    query: { status: { type: "string" } },
  },
  {
    name: "orders_get",
    method: "GET",
    path: "/orders/:id",
    description: "Detalle de un pedido: líneas, totales, estado, revisiones.",
    scopes: ["orders.read"],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "orders_create",
    method: "POST",
    path: "/orders",
    description: "Crea un pedido directo (sin cotización previa) para un cliente existente.",
    scopes: ["orders.write"],
    body: {
      customerId: { type: "string", required: true },
      lines: { type: "array", required: true, description: "1 a 200 líneas.", items: { type: "object", fields: orderLineFields } },
      notes: { type: "string" },
    },
  },
  {
    name: "orders_quick_charge",
    method: "POST",
    path: "/orders/quick-charge",
    description:
      "Cobro rápido: crea un pedido con un solo concepto libre (sin ir por catálogo) y abre su checkout. " +
      "idempotencyKey evita duplicar el cargo si se reintenta la misma llamada.",
    scopes: ["orders.write"],
    destructiveHint: true,
    body: {
      customerId: { type: "string", description: "Opcional: sin cliente, el pedido queda sin ligar a uno." },
      description: { type: "string", required: true, description: "Concepto del cobro." },
      amountTotal: { type: "string", required: true, description: "Monto total, p. ej. \"350.00\"." },
      idempotencyKey: { type: "string", description: "Identificador opaco de 8-128 caracteres para evitar cobros duplicados en reintentos." },
    },
  },
  {
    name: "orders_from_quote",
    method: "POST",
    path: "/orders/from-quote/:quoteId",
    description: "Crea un pedido a partir de una cotización aceptada. Sin sesión de usuario detrás, no notifica al cliente (evita duplicar el aviso que ya le dio el agente de chat).",
    scopes: ["orders.write"],
    pathParams: { quoteId: { type: "string" } },
  },
  {
    name: "orders_start_checkout",
    method: "POST",
    path: "/orders/:id/checkout",
    description: "Abre el checkout de un pedido con las líneas y modo de entrega dados, y emite un token de pago público.",
    scopes: ["orders.write"],
    pathParams: { id: { type: "string" } },
    body: {
      lines: { type: "array", required: true, items: { type: "object", fields: orderLineFields } },
      deliveryMode: { type: "string", required: true, enum: ["PICKUP", "LOCAL_DELIVERY"] },
      addressId: { type: "string", description: "Requerida si deliveryMode es LOCAL_DELIVERY." },
    },
  },
  {
    name: "orders_resume_checkout",
    method: "POST",
    path: "/orders/:id/checkout/resume",
    description: "Reemite el link de pago de un pedido cuyo checkout ya está abierto, sin recalcular líneas ni total.",
    scopes: ["orders.write"],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "orders_request_invoice",
    method: "PATCH",
    path: "/orders/:id/invoice-request",
    description: "Registra los datos fiscales (RFC, razón social, CP, uso de CFDI) para facturar el pedido.",
    scopes: ["orders.write"],
    pathParams: { id: { type: "string" } },
    body: {
      rfc: { type: "string", required: true },
      legalName: { type: "string", required: true },
      postalCode: { type: "string", required: true, description: "5 dígitos." },
      cfdiUse: { type: "string", required: true, description: "p. ej. G03, P01." },
      constanciaUrl: { type: "string" },
      notes: { type: "string" },
    },
  },
  {
    name: "orders_cancel",
    method: "PATCH",
    path: "/orders/:id/cancel",
    description:
      "Cancela un pedido. Requiere orders.cancel_own; sin orders.cancel_any además, la API key solo puede " +
      "cancelar pedidos que ella misma originó (el backend lo exige, no esta tool).",
    scopes: ["orders.cancel_own"],
    destructiveHint: true,
    pathParams: { id: { type: "string" } },
    body: { reason: { type: "string", description: "Máx. 500 caracteres, libre." } },
  },
  {
    name: "orders_fulfill",
    method: "POST",
    path: "/orders/:id/fulfill",
    description: "Marca un pedido pagado como entregado/completado y le genera (si no existe) su link de seguimiento.",
    scopes: ["orders.write"],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "orders_tracking_link",
    method: "GET",
    path: "/orders/:id/tracking-link",
    description: "Devuelve (generándolo si hace falta) el link público de seguimiento del pedido.",
    scopes: ["orders.read"],
    pathParams: { id: { type: "string" } },
  },
];
