import type { RouteDef } from "./types.js";

export const auditRoutes: RouteDef[] = [
  {
    name: "audit_list_events",
    method: "GET",
    path: "/audit/events",
    description: "Lista eventos de auditoría del tenant (cambios sensibles), más recientes primero.",
    scopes: ["audit.read"],
    query: {
      action: { type: "string", description: "p. ej. \"delivery_zone.created\"." },
      targetType: { type: "string", description: "p. ej. \"DeliveryZone\"." },
      limit: { type: "number", description: "Default 50, tope 200." },
    },
  },
  {
    name: "audit_get_event",
    method: "GET",
    path: "/audit/events/:id",
    description: "Detalle de un evento de auditoría por id.",
    scopes: ["audit.read"],
    pathParams: { id: { type: "string" } },
  },
];
