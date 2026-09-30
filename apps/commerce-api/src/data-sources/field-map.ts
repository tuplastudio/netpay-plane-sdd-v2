/**
 * Mapeo de un ítem crudo (lo que devuelve la API/tool) a un producto
 * normalizado listo para el upsert del catálogo.
 *
 * Cada valor del `fieldMap` es una ruta JSONPath (ver json-path.ts) o un
 * literal con prefijo `=` (`"=MXN"`), útil cuando la fuente no trae el dato.
 */

import { getJsonPath } from "./json-path.js";

export interface FieldMap {
  sku: string;
  name: string;
  price: string;
  description?: string;
  currency?: string;
  stock?: string;
  /** Ruta a una URL o a un arreglo de URLs (o de objetos `{ url }`). */
  imageUrl?: string;
  category?: string;
  active?: string;
  /** Id del sistema origen. Sin esto se usa el SKU. */
  externalId?: string;
}

export const FIELD_MAP_KEYS: ReadonlyArray<keyof FieldMap> = [
  "sku",
  "name",
  "price",
  "description",
  "currency",
  "stock",
  "imageUrl",
  "category",
  "active",
  "externalId",
];

export const REQUIRED_FIELD_MAP_KEYS: ReadonlyArray<keyof FieldMap> = ["sku", "name", "price"];

/** Producto ya normalizado: tipos y formatos que espera el catálogo. */
export interface NormalizedItem {
  sku: string;
  externalId: string;
  name: string;
  description: string | null;
  /** Decimal con 2 decimales como string (Prisma Decimal). */
  price: string;
  currency: string;
  /** Decimal con 3 decimales como string, o null = sin control de inventario. */
  stock: string | null;
  imageUrls: string[];
  category: string | null;
  active: boolean;
}

export type MapResult = { ok: true; item: NormalizedItem } | { ok: false; error: string };

/** Resuelve una entrada del fieldMap: literal (`=X`) o ruta. */
export function resolveField(raw: unknown, spec: string | undefined): unknown {
  if (spec === undefined || spec === "") return undefined;
  if (spec.startsWith("=")) return spec.slice(1);
  return getJsonPath(raw, spec);
}

function asTrimmedString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** "1,234.50", " 12 ", 12, "$12" → número, o null si no es interpretable. */
export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;
  // Coma y punto juntos: la coma separa miles. Solo coma: es decimal.
  const normalized =
    cleaned.includes(",") && cleaned.includes(".")
      ? cleaned.replace(/,/g, "")
      : cleaned.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const FALSY = new Set(["false", "0", "no", "inactive", "inactivo", "disabled", "archived", "off"]);

/** Interpreta banderas de activo. Ausente = activo. */
export function parseActive(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return !FALSY.has(String(value).trim().toLowerCase());
}

function parseImageUrls(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const entry of list) {
    const candidate =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object"
          ? ((entry as { url?: unknown }).url ?? (entry as { src?: unknown }).src)
          : null;
    if (typeof candidate !== "string") continue;
    const url = candidate.trim();
    if (/^https?:\/\//i.test(url)) out.push(url);
  }
  return out;
}

/** Aplica el fieldMap a un ítem crudo. Nunca lanza: devuelve el error. */
export function mapItem(raw: unknown, fieldMap: FieldMap): MapResult {
  const sku = asTrimmedString(resolveField(raw, fieldMap.sku));
  if (!sku) return { ok: false, error: `sku vacío (ruta "${fieldMap.sku}")` };
  if (sku.length > 120) return { ok: false, error: `sku demasiado largo (${sku.length} > 120)` };

  const name = asTrimmedString(resolveField(raw, fieldMap.name));
  if (!name) return { ok: false, error: `name vacío para sku ${sku} (ruta "${fieldMap.name}")` };

  const price = parseNumber(resolveField(raw, fieldMap.price));
  if (price === null || price < 0) {
    return { ok: false, error: `price inválido para sku ${sku} (ruta "${fieldMap.price}")` };
  }

  const currencyRaw = asTrimmedString(resolveField(raw, fieldMap.currency));
  const currency = (currencyRaw || "MXN").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: `currency inválida "${currencyRaw}" para sku ${sku}` };
  }

  let stock: string | null = null;
  if (fieldMap.stock) {
    const stockValue = resolveField(raw, fieldMap.stock);
    if (stockValue !== undefined && stockValue !== null && stockValue !== "") {
      const n = parseNumber(stockValue);
      if (n === null) return { ok: false, error: `stock inválido para sku ${sku}` };
      stock = Math.max(0, n).toFixed(3);
    }
  }

  const description = asTrimmedString(resolveField(raw, fieldMap.description));
  const category = asTrimmedString(resolveField(raw, fieldMap.category));
  const externalId = asTrimmedString(resolveField(raw, fieldMap.externalId)) || sku;

  return {
    ok: true,
    item: {
      sku,
      externalId: externalId.slice(0, 200),
      name: name.slice(0, 200),
      description: description ? description.slice(0, 4000) : null,
      price: price.toFixed(2),
      currency,
      stock,
      imageUrls: fieldMap.imageUrl ? parseImageUrls(resolveField(raw, fieldMap.imageUrl)) : [],
      category: category ? category.slice(0, 60).toLowerCase() : null,
      active: parseActive(resolveField(raw, fieldMap.active)),
    },
  };
}

/** Extrae la lista de ítems de una respuesta con `itemsJsonPath`. */
export function extractItems(payload: unknown, itemsJsonPath: string): unknown[] {
  const value = itemsJsonPath.trim() === "" ? payload : getJsonPath(payload, itemsJsonPath);
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  // Un objeto suelto = un solo ítem (APIs que devuelven un producto por llamada).
  return typeof value === "object" ? [value] : [];
}
