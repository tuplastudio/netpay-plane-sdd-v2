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
  {
    name: "reports_attention",
    method: "GET",
    path: "/reports/attention",
    description:
      "Reporte operativo de atención al cliente de WhatsApp: volumen de conversaciones, " +
      "tiempos de primera respuesta, carga por agente. Útil para decidir staffing y SLA. " +
      "Requiere chat.read.",
    scopes: ["chat.read"],
    query: {
      from: { type: "string", description: "Fecha ISO, inclusive." },
      to: { type: "string", description: "Fecha ISO, inclusive." },
      agentId: { type: "string", description: "UUID de un agente humano; sin él, agrega a todos." },
      provider: { type: "string", enum: ["META", "EVOLUTION"], description: "Filtra por proveedor de WhatsApp." },
    },
  },
];
