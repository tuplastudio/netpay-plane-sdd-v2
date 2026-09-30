/**
 * Cliente REST genérico: arma la URL (base + listPath + query), pagina por
 * página o cursor y devuelve los ítems ya extraídos con `itemsJsonPath`.
 */

import { DEFAULT_MAX_ITEMS, MAX_PAGES_HARD_LIMIT, RestConfig } from "./data-source-config.js";
import { extractItems } from "./field-map.js";
import { getJsonPath } from "./json-path.js";
import {
  ConnectionAuth,
  DataSourceHttpError,
  HttpOptions,
  buildAuthHeaders,
  httpRequest,
  parseJsonText,
} from "./http-client.js";

export interface RestConnection {
  baseUrl: string;
  auth: ConnectionAuth;
}

export interface RestFetchOptions extends HttpOptions {
  /** Tope de ítems (corta la paginación al alcanzarlo). */
  maxItems?: number;
  /** Tope de páginas (la prueba de conexión usa 1). */
  maxPages?: number;
}

export interface RestFetchResult {
  items: unknown[];
  pages: number;
  /** Última respuesta decodificada, útil para depurar el mapeo en la prueba. */
  lastPayload: unknown;
}

/** `https://api.x.com/v1/` + `/products` → `https://api.x.com/v1/products`. */
export function joinUrl(baseUrl: string, listPath: string): string {
  if (/^https?:\/\//i.test(listPath)) return listPath;
  return `${baseUrl.replace(/\/+$/, "")}/${listPath.replace(/^\/+/, "")}`;
}

/** URL de una página concreta con query fija + parámetros de paginación. */
export function buildPageUrl(
  conn: RestConnection,
  config: RestConfig,
  page: { pageNumber?: number; cursor?: string | null },
): string {
  const url = new URL(joinUrl(conn.baseUrl, config.listPath));
  for (const [k, v] of Object.entries(config.query ?? {})) url.searchParams.set(k, v);
  const pagination = config.pagination;
  if (pagination.type === "page" && page.pageNumber !== undefined) {
    url.searchParams.set(pagination.pageParam, String(page.pageNumber));
    if (pagination.sizeParam && pagination.pageSize) {
      url.searchParams.set(pagination.sizeParam, String(pagination.pageSize));
    }
  }
  if (pagination.type === "cursor" && page.cursor) {
    url.searchParams.set(pagination.cursorParam, page.cursor);
  }
  return url.toString();
}

/** Trae todas las páginas (hasta los topes) y concatena los ítems. */
export async function fetchRestItems(
  conn: RestConnection,
  config: RestConfig,
  options: RestFetchOptions = {},
): Promise<RestFetchResult> {
  const maxItems = options.maxItems ?? config.maxItems ?? DEFAULT_MAX_ITEMS;
  const pagination = config.pagination;
  const configuredMaxPages = pagination.type === "none" ? 1 : (pagination.maxPages ?? MAX_PAGES_HARD_LIMIT);
  const maxPages = Math.min(options.maxPages ?? configuredMaxPages, MAX_PAGES_HARD_LIMIT);

  const headers: Record<string, string> = {
    accept: "application/json",
    ...buildAuthHeaders(conn.auth),
  };
  const init: RequestInit = { method: config.method, headers };
  if (config.method === "POST") {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(config.body ?? {});
  }

  const items: unknown[] = [];
  let pages = 0;
  let lastPayload: unknown = null;
  let pageNumber = pagination.type === "page" ? (pagination.startPage ?? 1) : undefined;
  let cursor: string | null = null;

  while (pages < maxPages) {
    const url = buildPageUrl(conn, config, { pageNumber, cursor });
    const res = await httpRequest(url, init, options);
    const payload = parseJsonText(res.text, `Página ${pages + 1}`);
    lastPayload = payload;
    pages += 1;

    const pageItems = extractItems(payload, config.itemsJsonPath);
    if (pages === 1 && pageItems.length === 0 && payload !== null && !Array.isArray(payload)) {
      const found = config.itemsJsonPath ? getJsonPath(payload, config.itemsJsonPath) : payload;
      if (found === undefined) {
        throw new DataSourceHttpError(
          `itemsJsonPath "${config.itemsJsonPath}" no existe en la respuesta`,
        );
      }
    }
    for (const item of pageItems) {
      if (items.length >= maxItems) break;
      items.push(item);
    }
    if (items.length >= maxItems || pageItems.length === 0) break;

    if (pagination.type === "none") break;
    if (pagination.type === "page") {
      // Página incompleta = última página (cuando conocemos el tamaño).
      if (pagination.pageSize && pageItems.length < pagination.pageSize) break;
      pageNumber = (pageNumber ?? 1) + 1;
      continue;
    }
    const next = getJsonPath(payload, pagination.nextCursorPath);
    if (next === undefined || next === null || next === "" || next === false) break;
    const nextCursor = String(next);
    if (nextCursor === cursor) break; // el servidor repite el cursor: evita el bucle
    cursor = nextCursor;
  }

  return { items, pages, lastPayload };
}
