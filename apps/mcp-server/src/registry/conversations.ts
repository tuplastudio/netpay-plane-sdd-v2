import type { RouteDef } from "./types.js";

/**
 * Subset de negocio de whatsapp.controller.ts. Deliberadamente fuera:
 * connect/disconnect/rotate-webhook-secret/webhook-url/health (alta y
 * mantenimiento de la conexión, operativo de panel), evolution/* (onboarding
 * por QR) y webhook/inbound/:tenantSlug (webhook público de Meta/Evolution).
 */
export const conversationRoutes: RouteDef[] = [
  {
    name: "conversations_list_connections",
    method: "GET",
    path: "/whatsapp/connections",
    description: "Lista las conexiones de WhatsApp (Meta/Evolution) del tenant.",
    scopes: ["chat.read"],
  },
  {
    name: "conversations_list",
    method: "GET",
    path: "/whatsapp/conversations",
    description: "Bandeja de conversaciones con filtros; incluye estadísticas globales del tenant (no afectadas por los filtros).",
    scopes: ["chat.read"],
    query: {
      q: { type: "string" },
      status: { type: "string", enum: ["OPEN", "HANDED_OFF", "CLOSED"] },
      handoff: { type: "string", enum: ["agent", "human"] },
      provider: { type: "string", enum: ["META", "EVOLUTION"] },
      from: { type: "string", description: "Fecha ISO." },
      to: { type: "string", description: "Fecha ISO." },
      limit: { type: "number" },
      tag: { type: "string" },
      sort: { type: "string", enum: ["recent", "oldest"] },
      assignee: { type: "string", description: "UUID del dueño del hilo, o \"unassigned\"." },
    },
  },
  {
    name: "conversations_get_messages",
    method: "GET",
    path: "/whatsapp/conversations/:id/messages",
    description: "Mensajes de una conversación.",
    scopes: ["chat.read"],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "conversations_get_context",
    method: "GET",
    path: "/whatsapp/conversations/:id/context",
    description:
      "Contexto CRM completo del hilo en una sola lectura: ficha del cliente, gasto agregado, " +
      "pedidos/cotizaciones/pagos recientes, notas internas y línea de tiempo fusionada.",
    scopes: ["chat.read"],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "conversations_update_status",
    method: "PATCH",
    path: "/whatsapp/conversations/:id/status",
    description: "Cierra o reabre un hilo a mano.",
    scopes: ["chat.write"],
    pathParams: { id: { type: "string" } },
    body: { status: { type: "string", required: true, enum: ["OPEN", "CLOSED"] } },
  },
  {
    name: "conversations_set_priority",
    method: "PATCH",
    path: "/whatsapp/conversations/:id/priority",
    description: "Cambia la prioridad operativa del hilo (LOW/NORMAL/HIGH/URGENT) para la cola de atención.",
    scopes: ["chat.write"],
    pathParams: { id: { type: "string" } },
    body: { priority: { type: "string", required: true, enum: ["LOW", "NORMAL", "HIGH", "URGENT"] } },
  },
  {
    name: "conversations_set_pending",
    method: "PATCH",
    path: "/whatsapp/conversations/:id/pending",
    description:
      "Marca/desmarca el hilo como pendiente de seguimiento humano (no afecta el handoff al bot). " +
      "Útil para colas internas: el agente marca que va a volver a contactar y evita que el hilo se olvide.",
    scopes: ["chat.write"],
    pathParams: { id: { type: "string" } },
    body: { pending: { type: "boolean", required: true } },
  },
  {
    name: "conversations_bulk",
    method: "POST",
    path: "/whatsapp/conversations/bulk",
    description:
      "Aplica una acción masiva a hasta 100 hilos a la vez: cerrar, reabrir, asignar, etiquetar, " +
      "cambiar prioridad o marcar pendiente. action define cuál se aplica y los campos extra " +
      "(userId/tags/priority/...) solo aplican a las acciones que los usen.",
    scopes: ["chat.write"],
    body: {
      ids: { type: "array", required: true, items: { type: "string" }, description: "Hasta 100 UUIDs." },
      action: {
        type: "string",
        required: true,
        enum: ["close", "reopen", "assign", "set_tags", "set_priority", "set_pending", "release"],
      },
      userId: { type: "string", description: "Requerido si action es assign." },
      tags: { type: "array", items: { type: "string" }, description: "Requerido si action es set_tags (reemplaza)." },
      priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"], description: "Requerido si action es set_priority." },
      pending: { type: "boolean", description: "Requerido si action es set_pending." },
    },
  },
  {
    name: "conversations_list_agents",
    method: "GET",
    path: "/whatsapp/agents",
    description: "Personas activas como agente de WhatsApp y cuántos hilos llevan ahora.",
    scopes: ["chat.read"],
  },
  {
    name: "conversations_get_message_notes",
    method: "GET",
    path: "/whatsapp/messages/:id/notes",
    description: "Notas internas puestas sobre un mensaje puntual.",
    scopes: ["chat.read"],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "conversations_add_message_note",
    method: "POST",
    path: "/whatsapp/messages/:id/notes",
    description: "Agrega una nota interna a un mensaje puntual (no la ve el cliente).",
    scopes: ["chat.write"],
    pathParams: { id: { type: "string" } },
    body: { body: { type: "string", required: true } },
  },
  {
    name: "conversations_update_customer",
    method: "PATCH",
    path: "/whatsapp/conversations/:id/customer",
    description: "Vincula el hilo a una ficha de cliente existente.",
    scopes: ["chat.write"],
    pathParams: { id: { type: "string" } },
    body: { customerId: { type: "string", required: true } },
  },
  {
    name: "conversations_update_tags",
    method: "PATCH",
    path: "/whatsapp/conversations/:id/tags",
    description: "Reemplaza las etiquetas de una conversación.",
    scopes: ["chat.write"],
    pathParams: { id: { type: "string" } },
    body: { tags: { type: "array", required: true, items: { type: "string" } } },
  },
  {
    name: "conversations_claim",
    method: "POST",
    path: "/whatsapp/conversations/:id/claim",
    description:
      "Un agente humano toma un hilo de la cola sin asignar. Requiere sesión de usuario del portal " +
      "(el backend rechaza esto sin RequestContext.userId): una API key sola no basta aunque tenga chat.write.",
    scopes: ["chat.write"],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "conversations_send_quote",
    method: "POST",
    path: "/whatsapp/conversations/:id/send-quote",
    description: "Manda un link de cotización (o cualquier texto) al hilo, aunque siga en manos del agente automático.",
    scopes: ["chat.write"],
    destructiveHint: true,
    pathParams: { id: { type: "string" } },
    body: { body: { type: "string", required: true } },
  },
  {
    name: "conversations_send",
    method: "POST",
    path: "/whatsapp/send",
    description: "Manda un mensaje saliente de WhatsApp a un número, sin necesidad de un hilo existente.",
    scopes: ["chat.write"],
    destructiveHint: true,
    body: {
      to: { type: "string", required: true, description: "Número en formato internacional, p. ej. +5216671234567." },
      type: { type: "string", required: true, enum: ["text", "template", "image", "audio"] },
      body: { type: "string", required: true, description: "Texto del mensaje (o caption, según type)." },
      templateName: { type: "string", description: "Requerido si type es \"template\"." },
      mediaUrl: { type: "string", description: "Requerido si type es \"image\" o \"audio\"." },
    },
  },
  {
    name: "conversations_handoff",
    method: "POST",
    path: "/whatsapp/conversations/:id/handoff",
    description: "Transfiere el hilo del agente automático a una persona del equipo.",
    scopes: ["chat.write"],
    pathParams: { id: { type: "string" } },
    body: { userId: { type: "string", required: true, description: "id de la persona que recibe el hilo." } },
  },
  {
    name: "conversations_reply",
    method: "POST",
    path: "/whatsapp/conversations/:id/reply",
    description: "Responde en un hilo ya transferido a una persona (atención humana).",
    scopes: ["chat.write"],
    destructiveHint: true,
    pathParams: { id: { type: "string" } },
    body: { body: { type: "string", required: true } },
  },
  {
    name: "conversations_send_attachment",
    method: "POST",
    path: "/whatsapp/conversations/:id/attachments",
    description: "Manda un archivo adjunto (imagen, audio, documento) al cliente, codificado en base64.",
    scopes: ["chat.write"],
    destructiveHint: true,
    pathParams: { id: { type: "string" } },
    body: {
      filename: { type: "string", required: true },
      mimetype: { type: "string", required: true },
      base64: { type: "string", required: true, description: "Contenido del archivo en base64." },
      caption: { type: "string" },
    },
  },
  {
    name: "conversations_get_notes",
    method: "GET",
    path: "/whatsapp/conversations/:id/notes",
    description: "Notas internas de la conversación completa (no de un mensaje puntual).",
    scopes: ["chat.read"],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "conversations_add_note",
    method: "POST",
    path: "/whatsapp/conversations/:id/notes",
    description: "Agrega una nota interna a la conversación.",
    scopes: ["chat.write"],
    pathParams: { id: { type: "string" } },
    body: { body: { type: "string", required: true } },
  },
  {
    name: "conversations_return_to_agent",
    method: "POST",
    path: "/whatsapp/conversations/:id/return",
    description: "Devuelve al agente automático un hilo que estaba en manos de una persona.",
    scopes: ["chat.write"],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "conversations_release",
    method: "POST",
    path: "/whatsapp/conversations/:id/release",
    description:
      "Libera un hilo a la cola de \"sin asignar\". Complementa `conversations_return_to_agent`: " +
      "este NO devuelve el hilo al bot, solo lo quita del dueño actual para que cualquier " +
      "humano pueda tomarlo con `conversations_claim`.",
    scopes: ["chat.write"],
    pathParams: { id: { type: "string" } },
  },
];
