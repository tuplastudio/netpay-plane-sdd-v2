import type { RouteDef } from "./types.js";

/**
 * Auto-administración del propio tenant (`/tenants/me/...`):
 * branding, parámetros comerciales, logo, contexto del agente. Es la
 * "configuración del sistema" que el MCP necesita para que el agente
 * sepa qué tenant es, qué税率 aplica, qué plantillas de WhatsApp usar, etc.
 *
 * Fuera de este registro a propósito:
 * - `tenants/me/delivery-zones`: vive en `shipping.ts` (es de catálogo).
 * - `tenants/me/canned-responses`: vive en `canned-responses.ts`.
 */
export const tenantRoutes: RouteDef[] = [
  {
    name: "tenants_me_get",
    method: "GET",
    path: "/tenants/me",
    description: "Detalle del propio tenant (nombre, slug, status, configVersion).",
    scopes: ["tenant.admin"],
  },
  {
    name: "tenants_me_agent_context",
    method: "GET",
    path: "/tenants/me/agent-context",
    description:
      "Contexto mínimo que el agente necesita para responder: nombre, branding, plantillas de " +
      "WhatsApp,税率, link de checkout por defecto. Lectura ligera pensada para cargarse al " +
      "inicio de cada sesión. Requiere catalog.read (no tenant.admin) — pensado para que " +
      "incluso un VENDOR pueda llamar al agente sin permisos administrativos.",
    scopes: ["catalog.read"],
  },
  {
    name: "tenants_me_update_branding",
    method: "PATCH",
    path: "/tenants/me/branding",
    description: "Actualiza el branding visual del tenant (logo URL, colores primario/secundario/acento).",
    scopes: ["tenant.admin"],
    body: {
      logoUrl: { type: "string", description: "URL absoluta del logo (http/https)." },
      primaryColor: { type: "string", description: "Color hex, formato #rrggbb." },
      secondaryColor: { type: "string", description: "Color hex, formato #rrggbb." },
      accentColor: { type: "string", description: "Color hex, formato #rrggbb." },
    },
  },
  {
    name: "tenants_me_update_settings",
    method: "PATCH",
    path: "/tenants/me/settings",
    description:
      "Actualiza parámetros comerciales del tenant (taxRatePct, shippingFlat, validez de cotizaciones " +
      "y checkouts, tope de descuento del vendedor, recordatorios de cotización, plantillas de " +
      "WhatsApp aprobadas por Meta). Cada PATCH incrementa `configVersion`, lo que invalida caches " +
      "del agente. Todos los campos opcionales — solo se aplica lo enviado.",
    scopes: ["tenant.admin"],
    body: {
      taxRatePct: { type: "number", description: "0 a 100, hasta 2 decimales." },
      shippingFlat: { type: "number", description: "Tarifa plana de envío cuando no hay zona, hasta 2 decimales." },
      quoteValidityHours: { type: "number", description: "Validez de cotizaciones en horas (1 a 8760 = 1 año)." },
      quickPayValidityHours: { type: "number", description: "Validez del link de pago rápido en horas (1 a 8760)." },
      checkoutReservationMinutes: { type: "number", description: "Reserva del link de checkout en minutos (5 a 43200 = 30 días)." },
      maxSellerDiscountPct: { type: "number", description: "0 a 100; tope de descuento que un VENDOR puede aplicar." },
      quoteReminderEnabled: { type: "boolean" },
      quoteReminderEveryHours: { type: "number", description: "1 a 720." },
      quoteReminderMaxCount: { type: "number", description: "0 a 10." },
      whatsappTemplates: {
        type: "any",
        description:
          "Mapa de clave interna a plantilla aprobada por Meta: " +
          "{ QUOTE_REMINDER: { name: \"recordatorio_cotizacion\", language: \"es_MX\" } }. " +
          "{} borra todas.",
      },
    },
  },
  {
    name: "tenants_me_remove_logo",
    method: "DELETE",
    path: "/tenants/me/logo",
    description: "Quita el logo del tenant (vuelve al placeholder).",
    scopes: ["tenant.admin"],
    destructiveHint: true,
  },
];