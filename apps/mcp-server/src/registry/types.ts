/**
 * DSL declarativo para describir una ruta HTTP de commerce-api como una
 * herramienta MCP. Un `RouteDef` por endpoint; `buildTool()` (ver tools.ts)
 * lo convierte en un `ZodRawShape` de entrada y en el handler que arma la
 * petición HTTP real. Mantener esto declarativo (en vez de una función a
 * mano por endpoint) es lo que hace manejable cubrir ~90 rutas: cada
 * definición son unas líneas de datos, no código repetido.
 */

export type Field =
  | { type: "string"; required?: boolean; description?: string; enum?: readonly string[] }
  | { type: "number"; required?: boolean; description?: string }
  | { type: "boolean"; required?: boolean; description?: string }
  | { type: "array"; required?: boolean; description?: string; items: Field }
  | { type: "object"; required?: boolean; description?: string; fields: Record<string, Field> }
  // Escape hatch: JSON libre (p. ej. filas crudas de un CSV, `Record<string,string>[]`)
  // donde el propio backend valida forma y contenido fila a fila.
  | { type: "any"; required?: boolean; description?: string };

export interface RouteDef {
  /** Nombre de la herramienta MCP, snake_case, único. */
  name: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Ruta con placeholders `:param`, relativa a `COMMERCE_API_BASE_URL` (sin incluir /api/v1). */
  path: string;
  description: string;
  /** Scope(s) de commerce-api que exige el endpoint; solo informativo (el servidor real hace el 403 si falta). */
  scopes: string[];
  pathParams?: Record<string, Field>;
  query?: Record<string, Field>;
  body?: Record<string, Field>;
  /**
   * Sobrescribe el `destructiveHint` que `tools.ts` deriva por default del
   * método HTTP (`DELETE` → true, el resto → false). Márcalo `true` a mano
   * en un POST/PATCH que tenga un efecto real difícil de deshacer: cobra
   * dinero, cancela/desactiva algo, o manda un mensaje real a un cliente.
   * Clientes MCP que respetan las `ToolAnnotations` (Claude Desktop, Claude
   * Code) usan esto para decidir si piden confirmación antes de llamar la
   * tool — es la señal, no una barrera dura: el servidor no bloquea nada
   * por su cuenta, eso lo sigue haciendo commerce-api con scopes.
   */
  destructiveHint?: boolean;
}
