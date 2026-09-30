/**
 * Normalización de rutas para la bitácora de uso: se guarda la forma de la
 * ruta, no la petición concreta, para poder agrupar (`/api/v1/orders/:id`)
 * sin que cada pedido sea una fila distinta y sin persistir tokens que
 * viajen en la URL.
 */

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT = /^\d+$/;
/** Prefijos públicos de nuestras keys y tokens: nunca deben quedar en la bitácora. */
const TOKEN_PREFIX = /^(npk|tok|inv)_/i;
/** Segmento opaco largo (token, hash, base64url) con al menos un dígito. */
const OPAQUE_SEGMENT = /^(?=.*\d)[A-Za-z0-9_-]{20,}$/;

export const MAX_PATH_LENGTH = 200;
export const MAX_USER_AGENT_LENGTH = 256;

/**
 * `/api/v1/orders/8f3c…-…/items?x=1` → `/api/v1/orders/:id/items`.
 * Sin query string, sin barra final, recortada a `MAX_PATH_LENGTH`.
 */
export function normalizeApiPath(rawUrl: string): string {
  const withoutQuery = rawUrl.split(/[?#]/, 1)[0] ?? "";
  const segments = withoutQuery.split("/").filter((s) => s.length > 0);
  const normalized = segments.map((segment) => {
    const decoded = safeDecode(segment);
    if (
      UUID_SEGMENT.test(decoded) ||
      NUMERIC_SEGMENT.test(decoded) ||
      TOKEN_PREFIX.test(decoded) ||
      OPAQUE_SEGMENT.test(decoded)
    ) {
      return ":id";
    }
    return decoded;
  });
  const path = `/${normalized.join("/")}`;
  return path.length > MAX_PATH_LENGTH ? path.slice(0, MAX_PATH_LENGTH) : path;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function truncateUserAgent(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length > MAX_USER_AGENT_LENGTH ? value.slice(0, MAX_USER_AGENT_LENGTH) : value;
}

/**
 * Mismo mapa status → código que `HttpExceptionFilter.codeFor`, para que la
 * bitácora hable el mismo idioma que el sobre de error. `null` en 2xx/3xx.
 */
export function errorCodeForStatus(status: number): string | null {
  if (status < 400) return null;
  if (status === 400) return "VALIDATION_FAILED";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 422) return "RULE_VIOLATION";
  if (status === 429) return "RATE_LIMITED";
  if (status === 503) return "DEPENDENCY_UNAVAILABLE";
  if (status >= 500) return "INTERNAL_ERROR";
  return "REQUEST_FAILED";
}
