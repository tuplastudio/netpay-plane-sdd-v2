import type { RouteDef } from "./types.js";

/**
 * Respuestas predeterminadas (`/tenants/me/canned-responses`): atajos de
 * texto que los agentes humanos pueden insertar con un shortcut. Es la
 * configuración operativa principal de cualquier equipo de WhatsApp.
 *
 * El backend declara `chat.read` para listar y `chat.write` para el resto
 * (mismo criterio que conversaciones: leer no requiere scope de escritura).
 */
export const cannedResponseRoutes: RouteDef[] = [
  {
    name: "canned_responses_list",
    method: "GET",
    path: "/tenants/me/canned-responses",
    description:
      "Lista las respuestas predeterminadas del tenant (atajos de texto con shortcut). " +
      "Máximo 200. Filtra por texto con q.",
    scopes: ["chat.read"],
    query: { q: { type: "string" } },
  },
  {
    name: "canned_responses_create",
    method: "POST",
    path: "/tenants/me/canned-responses",
    description: "Crea una respuesta predeterminada nueva con shortcut, título y cuerpo.",
    scopes: ["chat.write"],
    body: {
      shortcut: { type: "string", required: true, description: "Atajo, p. ej. \"/hola\" o \"/pedido\"." },
      title: { type: "string", required: true },
      body: { type: "string", required: true, description: "Texto que se inserta al usar el shortcut." },
    },
  },
  {
    name: "canned_responses_update",
    method: "PATCH",
    path: "/tenants/me/canned-responses/:id",
    description: "Actualiza una respuesta predeterminada (todos los campos opcionales — solo se actualiza lo enviado).",
    scopes: ["chat.write"],
    pathParams: { id: { type: "string" } },
    body: {
      shortcut: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
    },
  },
  {
    name: "canned_responses_delete",
    method: "DELETE",
    path: "/tenants/me/canned-responses/:id",
    description: "Borra una respuesta predeterminada.",
    scopes: ["chat.write"],
    destructiveHint: true,
    pathParams: { id: { type: "string" } },
  },
];