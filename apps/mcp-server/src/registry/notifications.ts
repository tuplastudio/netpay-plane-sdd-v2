import type { RouteDef } from "./types.js";

export const notificationRoutes: RouteDef[] = [
  {
    name: "notifications_list",
    method: "GET",
    path: "/notifications",
    description: "Lista notificaciones (WhatsApp/email/SMS/push) programadas o enviadas por el tenant.",
    scopes: ["notifications.read"],
    query: { status: { type: "string" } },
  },
  {
    name: "notifications_timeline",
    method: "GET",
    path: "/notifications/timeline/:subjectType/:subjectId",
    description: "Línea de tiempo de notificaciones de un sujeto dado (p. ej. un pedido o un cliente).",
    scopes: ["notifications.read"],
    pathParams: {
      subjectType: { type: "string", description: "Tipo del sujeto, p. ej. \"Order\" o \"Customer\"." },
      subjectId: { type: "string" },
    },
  },
  {
    name: "notifications_cohort_report",
    method: "GET",
    path: "/notifications/report/cohort",
    description: "Reporte de entregabilidad/engagement de notificaciones por cohorte.",
    scopes: ["notifications.read"],
  },
  {
    name: "notifications_schedule",
    method: "POST",
    path: "/notifications/schedule",
    description: "Programa una notificación a un cliente o usuario, por una plantilla ya definida en el sistema.",
    scopes: ["notifications.write"],
    body: {
      recipientType: { type: "string", required: true, enum: ["CUSTOMER", "USER"] },
      recipientId: { type: "string", required: true, description: "UUID del cliente o usuario." },
      channel: { type: "string", required: true, enum: ["EMAIL", "WHATSAPP", "SMS", "PUSH"] },
      templateKey: { type: "string", required: true },
      payload: { type: "any", required: true, description: "Objeto con las variables que la plantilla espera." },
      scheduledAt: { type: "string", description: "Fecha ISO; ausente = lo antes posible." },
    },
  },
];
