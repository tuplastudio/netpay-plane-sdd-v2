import type { RouteDef } from "./types.js";

export const integrationRoutes: RouteDef[] = [
  {
    name: "integrations_list",
    method: "GET",
    path: "/integrations",
    description: "Lista las integraciones (webhooks salientes/entrantes) configuradas por el tenant.",
    scopes: ["integrations.read"],
  },
  {
    name: "integrations_create",
    method: "POST",
    path: "/integrations",
    description: "Da de alta una integración. Con direction INBOUND o BIDIRECTIONAL, el backend emite webhookUrl y cifra el secreto.",
    scopes: ["integrations.write"],
    body: {
      name: { type: "string", required: true },
      provider: { type: "string", required: true, description: "Letras, números, punto, guion y guion bajo." },
      direction: { type: "string", required: true, enum: ["INBOUND", "OUTBOUND", "BIDIRECTIONAL"] },
      endpoint: { type: "string", description: "URL destino, para OUTBOUND/BIDIRECTIONAL." },
      secret: { type: "string", description: "8 a 256 caracteres; firma HMAC de los eventos." },
    },
  },
  {
    name: "integrations_disable",
    method: "POST",
    path: "/integrations/:id/disable",
    description: "Desactiva una integración.",
    scopes: ["integrations.write"],
    destructiveHint: true,
    pathParams: { id: { type: "string" } },
  },
  {
    name: "integrations_list_events",
    method: "GET",
    path: "/integrations/events",
    description: "Lista eventos de integración (entrantes/salientes), opcionalmente filtrados por status.",
    scopes: ["integrations.read"],
    query: { status: { type: "string" } },
  },
  {
    name: "integrations_reprocess_event",
    method: "POST",
    path: "/integrations/events/:eventId/reprocess",
    description: "Reintenta el procesamiento de un evento de integración fallido.",
    scopes: ["integrations.write"],
    pathParams: { eventId: { type: "string" } },
  },
  {
    name: "integrations_publish",
    method: "POST",
    path: "/integrations/:id/publish",
    description: "Publica un evento saliente hacia el endpoint de una integración OUTBOUND/BIDIRECTIONAL, firmado con su secreto.",
    scopes: ["integrations.write"],
    pathParams: { id: { type: "string" } },
    body: {
      eventName: { type: "string", required: true },
      payload: { type: "any", required: true },
      secret: { type: "string", required: true, description: "Debe coincidir con el secreto de la integración." },
    },
  },
];
