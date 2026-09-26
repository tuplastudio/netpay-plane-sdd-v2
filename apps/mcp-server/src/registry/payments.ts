import type { RouteDef } from "./types.js";

export const paymentRoutes: RouteDef[] = [
  {
    name: "payments_list_sessions",
    method: "GET",
    path: "/payments/sessions",
    description: "Lista las sesiones de pago (checkouts) del tenant.",
    scopes: ["payments.read"],
  },
  {
    name: "payments_get_session",
    method: "GET",
    path: "/payments/sessions/:id",
    description: "Detalle de una sesión de pago: estado, monto, pedido asociado.",
    scopes: ["payments.read"],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "payments_ledger",
    method: "GET",
    path: "/payments/ledger",
    description: "Movimientos del libro de pagos (cargos, reembolsos), opcionalmente filtrados por sesión.",
    scopes: ["payments.read"],
    query: { sessionId: { type: "string" } },
  },
  {
    name: "payments_refund",
    method: "POST",
    path: "/payments/refunds",
    description: "Reembolsa (total o parcialmente) una sesión de pago capturada.",
    scopes: ["payments.refund"],
    destructiveHint: true,
    body: {
      sessionId: { type: "string", required: true },
      amount: { type: "string", required: true, description: "Monto a reembolsar; no puede exceder lo capturado." },
      reason: { type: "string", description: "Máx. 500 caracteres." },
    },
  },
];
