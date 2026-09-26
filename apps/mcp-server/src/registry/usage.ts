import type { RouteDef } from "./types.js";

/**
 * `usage.controller.ts` también expone `GET /super-admin/usage` y
 * `GET /super-admin/usage/detail`, pero viven bajo `SuperAdminGuard`
 * (cross-tenant, requiere sesión de super-admin): una API key de tenant no
 * puede pasar ese guard nunca, así que no se incluyen aquí.
 */
export const usageRoutes: RouteDef[] = [
  {
    name: "usage_record_event",
    method: "POST",
    path: "/usage/events",
    description: "Reporta un consumo de tokens/costo (uso interno de agentes; no exige scope, solo tenant autenticado).",
    scopes: [],
    body: {
      model: { type: "string", required: true },
      inputTokens: { type: "number", required: true },
      outputTokens: { type: "number", required: true },
      costUsd: { type: "string", required: true, description: "Decimal, hasta 6 posiciones." },
    },
  },
  {
    name: "usage_summary",
    method: "GET",
    path: "/usage/summary",
    description: "Resumen de consumo/costo del tenant en un rango de fechas. Requiere tenant.admin (solo OWNER).",
    scopes: ["tenant.admin"],
    query: {
      from: { type: "string", description: "Fecha ISO." },
      to: { type: "string", description: "Fecha ISO." },
    },
  },
];
