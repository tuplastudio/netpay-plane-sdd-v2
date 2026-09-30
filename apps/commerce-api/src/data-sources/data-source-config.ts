/**
 * Config del mapeo de una fuente de datos. Se guarda como JSON en
 * `DataSource.config`; aquí vive el tipado y la validación (la forma del
 * documento cambia con `kind`, así que class-validator no aplica bien).
 * Formato documentado en docs/integrations/data-sources.md.
 */

import { BadRequestException } from "@nestjs/common";
import { FIELD_MAP_KEYS, FieldMap, REQUIRED_FIELD_MAP_KEYS } from "./field-map.js";
import { isValidJsonPath } from "./json-path.js";

export type RestPagination =
  | { type: "none" }
  | {
      type: "page";
      /** Query param de la página (p.ej. "page"). */
      pageParam: string;
      /** Query param del tamaño de página, opcional. */
      sizeParam?: string;
      pageSize?: number;
      /** Primera página: 1 por defecto (algunas APIs usan 0). */
      startPage?: number;
      maxPages?: number;
    }
  | {
      type: "cursor";
      /** Query param donde se manda el cursor. */
      cursorParam: string;
      /** Ruta al siguiente cursor en la respuesta. Vacío/null = fin. */
      nextCursorPath: string;
      maxPages?: number;
    };

export interface RestConfig {
  /** Ruta relativa a la URL base ("/products") o URL absoluta. */
  listPath: string;
  method: "GET" | "POST";
  /** Query params fijos. */
  query?: Record<string, string>;
  /** Cuerpo JSON para POST. */
  body?: Record<string, unknown>;
  pagination: RestPagination;
  itemsJsonPath: string;
  fieldMap: FieldMap;
  /** Tope de ítems por sincronización (default DEFAULT_MAX_ITEMS). */
  maxItems?: number;
}

export interface McpConfig {
  toolName: string;
  toolArgs?: Record<string, unknown>;
  /** Ruta dentro del resultado ya decodificado (structuredContent o JSON del texto). */
  itemsJsonPath: string;
  fieldMap: FieldMap;
  maxItems?: number;
}

export type DataSourceKind = "REST" | "MCP";
export type DataSourceConfig = RestConfig | McpConfig;

export const DEFAULT_MAX_ITEMS = 5000;
export const MAX_PAGES_HARD_LIMIT = 500;

function fail(message: string): never {
  throw new BadRequestException({ code: "VALIDATION_ERROR", message: `config: ${message}` });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFieldMap(raw: unknown): FieldMap {
  if (!isRecord(raw)) fail("fieldMap debe ser un objeto");
  const out: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    if (!(FIELD_MAP_KEYS as ReadonlyArray<string>).includes(key)) {
      fail(`fieldMap.${key} no es un campo conocido (${FIELD_MAP_KEYS.join(", ")})`);
    }
    const value = raw[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") fail(`fieldMap.${key} debe ser una ruta (string)`);
    if (!value.startsWith("=") && !isValidJsonPath(value)) {
      fail(`fieldMap.${key}: ruta inválida "${value}"`);
    }
    out[key] = value;
  }
  for (const key of REQUIRED_FIELD_MAP_KEYS) {
    if (!out[key]) fail(`fieldMap.${key} es obligatorio`);
  }
  return out as unknown as FieldMap;
}

function parseItemsPath(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") fail("itemsJsonPath debe ser string");
  if (!isValidJsonPath(raw)) fail(`itemsJsonPath inválido "${raw}"`);
  return raw.trim();
}

function parsePositiveInt(value: unknown, name: string, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    fail(`${name} debe ser un entero entre 1 y ${max}`);
  }
  return value;
}

function parsePagination(raw: unknown): RestPagination {
  if (raw === undefined || raw === null) return { type: "none" };
  if (!isRecord(raw)) fail("pagination debe ser un objeto");
  const type = raw.type;
  if (type === "none" || type === undefined) return { type: "none" };
  if (type === "page") {
    if (typeof raw.pageParam !== "string" || !raw.pageParam.trim()) {
      fail("pagination.pageParam es obligatorio");
    }
    const startPage = raw.startPage;
    if (
      startPage !== undefined &&
      startPage !== null &&
      (typeof startPage !== "number" || !Number.isInteger(startPage) || startPage < 0)
    ) {
      fail("pagination.startPage debe ser un entero >= 0");
    }
    if (raw.sizeParam !== undefined && raw.sizeParam !== null && typeof raw.sizeParam !== "string") {
      fail("pagination.sizeParam debe ser string");
    }
    const sizeParam = typeof raw.sizeParam === "string" ? raw.sizeParam.trim() : "";
    return {
      type: "page",
      pageParam: raw.pageParam.trim(),
      sizeParam: sizeParam || undefined,
      pageSize: parsePositiveInt(raw.pageSize, "pagination.pageSize", 1000),
      startPage: typeof startPage === "number" ? startPage : undefined,
      maxPages: parsePositiveInt(raw.maxPages, "pagination.maxPages", MAX_PAGES_HARD_LIMIT),
    };
  }
  if (type === "cursor") {
    if (typeof raw.cursorParam !== "string" || !raw.cursorParam.trim()) {
      fail("pagination.cursorParam es obligatorio");
    }
    if (typeof raw.nextCursorPath !== "string" || !isValidJsonPath(raw.nextCursorPath)) {
      fail("pagination.nextCursorPath debe ser una ruta válida");
    }
    return {
      type: "cursor",
      cursorParam: raw.cursorParam.trim(),
      nextCursorPath: raw.nextCursorPath.trim(),
      maxPages: parsePositiveInt(raw.maxPages, "pagination.maxPages", MAX_PAGES_HARD_LIMIT),
    };
  }
  return fail(`pagination.type "${String(type)}" no reconocido (none | page | cursor)`);
}

function parseStringRecord(raw: unknown, name: string): Record<string, string> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) fail(`${name} debe ser un objeto de strings`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
      fail(`${name}.${k} debe ser string`);
    }
    out[k] = String(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseRestConfig(raw: unknown): RestConfig {
  if (!isRecord(raw)) fail("debe ser un objeto");
  if (typeof raw.listPath !== "string" || !raw.listPath.trim()) fail("listPath es obligatorio");
  const method = raw.method === undefined || raw.method === null ? "GET" : raw.method;
  if (method !== "GET" && method !== "POST") fail("method debe ser GET o POST");
  if (raw.body !== undefined && raw.body !== null && !isRecord(raw.body)) {
    fail("body debe ser un objeto JSON");
  }
  return {
    listPath: raw.listPath.trim(),
    method,
    query: parseStringRecord(raw.query, "query"),
    body: isRecord(raw.body) ? raw.body : undefined,
    pagination: parsePagination(raw.pagination),
    itemsJsonPath: parseItemsPath(raw.itemsJsonPath),
    fieldMap: parseFieldMap(raw.fieldMap),
    maxItems: parsePositiveInt(raw.maxItems, "maxItems", 50_000),
  };
}

export function parseMcpConfig(raw: unknown): McpConfig {
  if (!isRecord(raw)) fail("debe ser un objeto");
  if (typeof raw.toolName !== "string" || !raw.toolName.trim()) fail("toolName es obligatorio");
  if (raw.toolArgs !== undefined && raw.toolArgs !== null && !isRecord(raw.toolArgs)) {
    fail("toolArgs debe ser un objeto");
  }
  return {
    toolName: raw.toolName.trim(),
    toolArgs: isRecord(raw.toolArgs) ? raw.toolArgs : undefined,
    itemsJsonPath: parseItemsPath(raw.itemsJsonPath),
    fieldMap: parseFieldMap(raw.fieldMap),
    maxItems: parsePositiveInt(raw.maxItems, "maxItems", 50_000),
  };
}

/** Valida y tipa la config según el tipo de fuente. Lanza 400 con detalle. */
export function parseDataSourceConfig(kind: DataSourceKind, raw: unknown): DataSourceConfig {
  return kind === "REST" ? parseRestConfig(raw) : parseMcpConfig(raw);
}
