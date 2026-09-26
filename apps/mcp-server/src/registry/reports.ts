import type { RouteDef } from "./types.js";

export const reportRoutes: RouteDef[] = [
  {
    name: "reports_summary",
    method: "GET",
    path: "/reports/summary",
    description: "Resumen de ventas/cobros del tenant. Requiere payments.read (mismo scope que /payments/sessions).",
    scopes: ["payments.read"],
  },
  {
    name: "reports_dashboard",
    method: "GET",
    path: "/reports/dashboard",
    description:
      "Dashboard operativo: KPIs unificados, actividad reciente (pedidos, conversaciones, bitácora) y serie de " +
      "ventas de 7 días. Requiere payments.read.",
    scopes: ["payments.read"],
  },
];
