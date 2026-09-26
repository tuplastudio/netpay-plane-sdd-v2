import type { RouteDef } from "./types.js";

export const quoteLineFields = {
  variantId: { type: "string" as const, required: true, description: "id de la variante de catálogo (UUID)." },
  quantity: { type: "string" as const, required: true, description: "Formato NN.NNN (3 decimales), p. ej. \"2.000\"." },
  discountPct: { type: "number" as const, description: "0 a 100." },
};

export const quoteRoutes: RouteDef[] = [
  {
    name: "quotes_list",
    method: "GET",
    path: "/quotes",
    description: "Lista cotizaciones del tenant, opcionalmente filtradas por status.",
    scopes: ["quotes.read"],
    query: {
      status: { type: "string", enum: ["DRAFT", "ISSUED", "ACCEPTED", "CANCELLED", "EXPIRED"] },
    },
  },
  {
    name: "quotes_get",
    method: "GET",
    path: "/quotes/:id",
    description: "Detalle de una cotización: líneas, totales, cliente, estado.",
    scopes: ["quotes.read"],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "quotes_create",
    method: "POST",
    path: "/quotes",
    description: "Crea una cotización en DRAFT (o directo ISSUED si issue:true) para un cliente existente.",
    scopes: ["quotes.write"],
    body: {
      customerId: { type: "string", required: true, description: "id del cliente (UUID)." },
      lines: { type: "array", required: true, description: "Al menos una línea.", items: { type: "object", fields: quoteLineFields } },
      notes: { type: "string", description: "Máx. 1000 caracteres." },
      issue: { type: "boolean", description: "true = emitirla de una vez (equivalente a create + issue)." },
    },
  },
  {
    name: "quotes_update",
    method: "PATCH",
    path: "/quotes/:id",
    description: "Reemplaza las líneas y/o notas de una cotización (solo mientras sigue en DRAFT).",
    scopes: ["quotes.write"],
    pathParams: { id: { type: "string" } },
    body: {
      lines: { type: "array", items: { type: "object", fields: quoteLineFields } },
      notes: { type: "string" },
    },
  },
  {
    name: "quotes_issue",
    method: "PATCH",
    path: "/quotes/:id/issue",
    description: "Emite una cotización DRAFT: fija precios y le pone fecha de vencimiento.",
    scopes: ["quotes.write"],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "quotes_cancel",
    method: "PATCH",
    path: "/quotes/:id/cancel",
    description: "Cancela una cotización; ya no se puede aceptar ni pagar.",
    scopes: ["quotes.write"],
    destructiveHint: true,
    pathParams: { id: { type: "string" } },
  },
  {
    name: "quotes_share",
    method: "POST",
    path: "/quotes/:id/share",
    description:
      "Genera (o renueva) el link público de la cotización (/quotes/public/:token). " +
      "notify:false si el enlace ya se lo mandaste tú al cliente por otro medio, para que el dispatcher no lo duplique.",
    scopes: ["quotes.write"],
    pathParams: { id: { type: "string" } },
    body: {
      notify: { type: "boolean", description: "Default true: encola notificación WhatsApp/email al cliente." },
    },
  },
];
