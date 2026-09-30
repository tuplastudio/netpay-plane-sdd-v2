/**
 * Plantilla de argumentos para hooks MCP.
 *
 * El tenant describe los argumentos de la herramienta como JSON con
 * placeholders `{{ruta}}` que se resuelven contra el evento:
 *
 *   { "orderId": "{{event.data.orderId}}", "note": "Pedido {{event.data.orderId}} pagado" }
 *
 * Raíz de resolución: `{ event: <sobre>, data: <sobre.data> }`, así que
 * `{{event.data.total}}` y `{{data.total}}` son equivalentes.
 *
 * Reglas:
 *  - Una cadena que es EXACTAMENTE un placeholder conserva el tipo del valor
 *    (número, objeto, arreglo, null).
 *  - Una cadena con texto alrededor interpola como texto; los objetos se
 *    serializan en JSON.
 *  - Una ruta que no existe resuelve a `null` (exacto) o a "" (interpolado).
 *  - Objetos y arreglos se recorren recursivamente.
 */

import type { DomainEvent } from "./domain-event-bus.js";

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.[\]-]+)\s*\}\}/g;
const EXACT_PLACEHOLDER = /^\{\{\s*([A-Za-z0-9_.[\]-]+)\s*\}\}$/;

/** Lee `a.b[0].c` sobre un valor arbitrario. `undefined` si no existe. */
export function readPath(root: unknown, path: string): unknown {
  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((s) => s.length > 0);
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** Resuelve una plantilla (cualquier JSON) contra el evento. */
export function renderArgsTemplate(template: unknown, event: DomainEvent): unknown {
  const root = { event, data: event.data };
  const render = (node: unknown): unknown => {
    if (typeof node === "string") {
      const exact = node.match(EXACT_PLACEHOLDER);
      if (exact) {
        const value = readPath(root, exact[1]!);
        return value === undefined ? null : value;
      }
      return node.replace(PLACEHOLDER, (_m, path: string) => asText(readPath(root, path)));
    }
    if (Array.isArray(node)) return node.map(render);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        out[key] = render(value);
      }
      return out;
    }
    return node;
  };
  return render(template);
}

/**
 * Argumentos finales de `tools/call`: la plantilla resuelta, o `{ event }`
 * cuando el hook no define ninguna. Siempre un objeto (JSON-RPC lo exige).
 */
export function buildToolArguments(template: unknown, event: DomainEvent): Record<string, unknown> {
  if (template === null || template === undefined) return { event };
  const rendered = renderArgsTemplate(template, event);
  if (rendered && typeof rendered === "object" && !Array.isArray(rendered)) {
    return rendered as Record<string, unknown>;
  }
  return { value: rendered, event };
}
