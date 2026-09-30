/**
 * JSONPath mínimo, sin dependencias: `a.b[0].c`, `$.items[*].sku`, `data.list`.
 *
 * Soporta:
 *  - `$` o cadena vacía = raíz;
 *  - segmentos por punto (`a.b`), con índice `[n]` (negativo = desde el final)
 *    y comodín `[*]` (aplana un nivel);
 *  - claves con puntos o corchetes entre comillas: `["Precio.Base"]`.
 *
 * No soporta filtros (`?()`), descendientes (`..`) ni scripts: para el mapeo
 * de catálogo no hacen falta y así no se trae jsonpath-plus.
 */

type Segment =
  | { kind: "key"; key: string }
  | { kind: "index"; index: number }
  | { kind: "wildcard" };

const cache = new Map<string, Segment[]>();

/** Parsea una ruta a segmentos. Lanza `Error` con mensaje legible si es inválida. */
export function parseJsonPath(path: string): Segment[] {
  const cached = cache.get(path);
  if (cached) return cached;

  const segments: Segment[] = [];
  let input = path.trim();
  if (input.startsWith("$")) input = input.slice(1);
  if (input.startsWith(".")) input = input.slice(1);

  let i = 0;
  let key = "";
  const flushKey = () => {
    if (key.length > 0) {
      segments.push({ kind: "key", key });
      key = "";
    }
  };
  while (i < input.length) {
    const ch = input[i];
    if (ch === ".") {
      flushKey();
      i += 1;
      continue;
    }
    if (ch === "[") {
      flushKey();
      const close = input.indexOf("]", i);
      if (close === -1) throw new Error(`Ruta inválida "${path}": falta "]"`);
      const inner = input.slice(i + 1, close).trim();
      if (inner === "*") {
        segments.push({ kind: "wildcard" });
      } else if (/^-?\d+$/.test(inner)) {
        segments.push({ kind: "index", index: Number(inner) });
      } else if (/^(['"]).*\1$/.test(inner)) {
        segments.push({ kind: "key", key: inner.slice(1, -1) });
      } else {
        throw new Error(`Ruta inválida "${path}": segmento "[${inner}]" no reconocido`);
      }
      i = close + 1;
      continue;
    }
    key += ch;
    i += 1;
  }
  flushKey();
  cache.set(path, segments);
  return segments;
}

function step(value: unknown, segment: Segment): unknown {
  if (value === null || value === undefined) return undefined;
  switch (segment.kind) {
    case "key":
      if (typeof value !== "object" || Array.isArray(value)) return undefined;
      return (value as Record<string, unknown>)[segment.key];
    case "index": {
      if (!Array.isArray(value)) return undefined;
      const idx = segment.index < 0 ? value.length + segment.index : segment.index;
      return value[idx];
    }
    case "wildcard":
      return Array.isArray(value) ? value : undefined;
  }
}

/**
 * Evalúa la ruta sobre `root`. Un comodín `[*]` aplica el resto de la ruta a
 * cada elemento y devuelve el arreglo resultante (sin `undefined`).
 */
export function getJsonPath(root: unknown, path: string): unknown {
  const segments = parseJsonPath(path);
  return walk(root, segments, 0);
}

function walk(value: unknown, segments: Segment[], from: number): unknown {
  let current = value;
  for (let i = from; i < segments.length; i += 1) {
    const segment = segments[i]!;
    if (segment.kind === "wildcard") {
      if (!Array.isArray(current)) return undefined;
      const rest = segments.slice(i + 1);
      if (rest.length === 0) return current;
      const nestedWildcard = rest.some((s) => s.kind === "wildcard");
      const out: unknown[] = [];
      for (const item of current) {
        const v = walk(item, segments, i + 1);
        if (v === undefined) continue;
        if (nestedWildcard && Array.isArray(v)) out.push(...v);
        else out.push(v);
      }
      return out;
    }
    current = step(current, segment);
    if (current === undefined) return undefined;
  }
  return current;
}

/** true si la ruta parsea. Útil para validar el mapeo al guardar. */
export function isValidJsonPath(path: string): boolean {
  try {
    parseJsonPath(path);
    return true;
  } catch {
    return false;
  }
}
