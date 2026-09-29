import type { RouteDef } from "./types.js";

export const shippingRoutes: RouteDef[] = [
  {
    name: "shipping_list_zones",
    method: "GET",
    path: "/tenants/me/delivery-zones",
    description: "Lista las zonas de envío a domicilio configuradas por el tenant.",
    scopes: ["catalog.read"],
    query: { activeOnly: { type: "string", enum: ["true", "false"] } },
  },
  {
    name: "shipping_create_zone",
    method: "POST",
    path: "/tenants/me/delivery-zones",
    description:
      "Crea una zona de envío (por polígono en el mapa, CPs, patrón de ciudad o estado). Sin ninguno de los " +
      "criterios queda como zona catch-all (solo puede haber una por tenant). Requiere tenant.admin: solo lo " +
      "tiene el rol OWNER, así que una API key solo puede usar esto si la emitió un OWNER.",
    scopes: ["tenant.admin"],
    body: {
      name: { type: "string", required: true },
      postalCodes: { type: "array", items: { type: "string" }, description: "1 a 500 códigos postales de 4-5 dígitos." },
      cityPattern: { type: "string" },
      state: { type: "string" },
      polygon: {
        type: "any",
        description:
          "GeoJSON Polygon o MultiPolygon con coordenadas [lng, lat], anillos cerrados, máximo 2000 vértices. " +
          "Se evalúa antes que el CP cuando el cliente comparte lat/lng.",
      },
      color: { type: "string", description: "Color de la zona en el mapa del panel, formato #rrggbb." },
      price: { type: "number", required: true, description: "0 a 999999.99, hasta 2 decimales." },
      minOrder: { type: "number", description: "Pedido mínimo para esta zona." },
      sortOrder: { type: "number" },
      active: { type: "boolean", description: "Default true." },
      notes: { type: "string" },
    },
  },
  {
    name: "shipping_update_zone",
    method: "PATCH",
    path: "/tenants/me/delivery-zones/:id",
    description: "Actualiza una zona de envío existente. Requiere tenant.admin (solo OWNER).",
    scopes: ["tenant.admin"],
    pathParams: { id: { type: "string" } },
    body: {
      name: { type: "string" },
      postalCodes: { type: "array", items: { type: "string" } },
      cityPattern: { type: "string" },
      state: { type: "string" },
      polygon: {
        type: "any",
        description: "GeoJSON Polygon/MultiPolygon [lng, lat]. Manda null para quitar el polígono.",
      },
      color: { type: "string", description: "#rrggbb. Manda null para quitar el color." },
      price: { type: "number" },
      minOrder: { type: "number" },
      sortOrder: { type: "number" },
      active: { type: "boolean" },
      notes: { type: "string" },
    },
  },
  {
    name: "shipping_delete_zone",
    method: "DELETE",
    path: "/tenants/me/delivery-zones/:id",
    description: "Borra una zona de envío. Requiere tenant.admin (solo OWNER).",
    scopes: ["tenant.admin"],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "shipping_lookup",
    method: "GET",
    path: "/shipping/lookup",
    description:
      "Dado un CP/ciudad/estado y/o lat/lng, resuelve qué zona de envío aplica y su precio (o la tarifa plana si " +
      "no hay match). Orden: polígono que contenga lat/lng > CP > estado+ciudad > catch-all > tarifa plana. " +
      "La respuesta trae `matchedBy` (polygon | postalCode | city | catchAll | fallback).",
    scopes: ["catalog.read"],
    query: {
      postalCode: { type: "string", description: "4 o 5 dígitos." },
      city: { type: "string" },
      state: { type: "string" },
      lat: { type: "number", description: "Latitud WGS84 (-90..90). Va junto con lng." },
      lng: { type: "number", description: "Longitud WGS84 (-180..180). Va junto con lat." },
    },
  },
];
