import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { apiRequest } from "./client.js";
import type { Field, RouteDef } from "./registry/types.js";

function fieldToZod(field: Field): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  switch (field.type) {
    case "string":
      schema = field.enum ? z.enum(field.enum as [string, ...string[]]) : z.string();
      break;
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "array":
      // El elemento de un array nunca es "opcional": `required` en `field.items`
      // no tiene sentido ahí (no es una propiedad con nombre) y, sin forzarlo,
      // `fieldToZod` lo envolvía en `.optional()` por default y zod-to-json-schema
      // lo convertía en `anyOf:[{not:{}},{...}]` — cualquier tool con un array
      // (tags, variantes, líneas) quedaba con un schema roto.
      schema = z.array(fieldToZod({ ...field.items, required: true }));
      break;
    case "object":
      schema = z.object(objectFieldsToZodShape(field.fields));
      break;
    case "any":
      schema = z.any();
      break;
  }
  if (field.description) schema = schema.describe(field.description);
  return field.required ? schema : schema.optional();
}

function objectFieldsToZodShape(fields: Record<string, Field>): z.ZodRawShape {
  const shape: z.ZodRawShape = {};
  for (const [key, field] of Object.entries(fields)) shape[key] = fieldToZod(field);
  return shape;
}

/** `ZodRawShape` de entrada de la tool: path params (siempre requeridos), query y body, todo al mismo nivel. */
export function routeInputShape(route: RouteDef): z.ZodRawShape {
  const shape: z.ZodRawShape = {};
  for (const [key, field] of Object.entries(route.pathParams ?? {})) {
    shape[key] = fieldToZod({ ...field, required: true });
  }
  for (const [key, field] of Object.entries(route.query ?? {})) {
    shape[key] = fieldToZod(field);
  }
  for (const [key, field] of Object.entries(route.body ?? {})) {
    // Un nombre presente tanto en query como en body (no pasa en este registro,
    // pero si pasara) pisaría la entrada anterior: se documenta aquí para que
    // quien añada una ruta nueva lo note en la revisión, no en producción.
    shape[key] = fieldToZod(field);
  }
  return shape;
}

function buildPath(route: RouteDef, args: Record<string, unknown>): string {
  let path = route.path;
  for (const key of Object.keys(route.pathParams ?? {})) {
    path = path.replace(`:${key}`, encodeURIComponent(String(args[key])));
  }
  return path;
}

function buildQuery(route: RouteDef, args: Record<string, unknown>): Record<string, string> {
  const query: Record<string, string> = {};
  for (const key of Object.keys(route.query ?? {})) {
    const value = args[key];
    if (value !== undefined) query[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return query;
}

function buildBody(route: RouteDef, args: Record<string, unknown>): unknown {
  if (!route.body) return undefined;
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(route.body)) {
    if (args[key] !== undefined) body[key] = args[key];
  }
  return body;
}

function toCallToolResult(status: number, ok: boolean, data: unknown): CallToolResult {
  return {
    isError: !ok,
    content: [
      {
        type: "text",
        text: JSON.stringify({ status, data }, null, 2),
      },
    ],
  };
}

/**
 * Pistas para el cliente MCP (Claude Desktop, Claude Code, cualquier otro):
 * un cliente que respeta `ToolAnnotations` puede pedir confirmación antes de
 * llamar una tool destructiva, o mostrarla distinto de una de solo lectura.
 * El servidor NUNCA bloquea nada con esto — es información, no un permiso;
 * el único candado real sigue siendo el scope de la API key en commerce-api.
 *
 *  - readOnlyHint: GET nunca escribe nada.
 *  - destructiveHint: DELETE siempre (borra o revoca); el resto solo si
 *    `route.destructiveHint` lo marca a mano (cobra dinero, cancela,
 *    desactiva, o manda un mensaje real que no se puede des-enviar).
 *  - openWorldHint: true siempre — esto habla con un sistema externo real
 *    (commerce-api en producción), nunca un sandbox.
 */
function routeAnnotations(route: RouteDef): {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
} {
  const readOnlyHint = route.method === "GET";
  const destructiveHint = readOnlyHint ? false : (route.destructiveHint ?? route.method === "DELETE");
  return {
    readOnlyHint,
    destructiveHint,
    idempotentHint: route.method === "DELETE" || route.method === "PATCH",
    openWorldHint: true,
  };
}

export function registerRoute(server: McpServer, route: RouteDef): void {
  const scopeNote = route.scopes.length > 0 ? ` Requiere scope(s): ${route.scopes.join(", ")}.` : "";
  server.registerTool(
    route.name,
    {
      description: `${route.description}${scopeNote}`,
      inputSchema: routeInputShape(route),
      annotations: routeAnnotations(route),
    },
    async (args: Record<string, unknown>) => {
      const path = buildPath(route, args);
      const query = buildQuery(route, args);
      const body = buildBody(route, args);
      const result = await apiRequest(route.method, path, { query, body });
      return toCallToolResult(result.status, result.ok, result.data);
    },
  );
}

export function registerRoutes(server: McpServer, routes: RouteDef[]): void {
  const seen = new Set<string>();
  for (const route of routes) {
    if (seen.has(route.name)) {
      throw new Error(`Nombre de tool duplicado en el registro: ${route.name}`);
    }
    seen.add(route.name);
    registerRoute(server, route);
  }
}
