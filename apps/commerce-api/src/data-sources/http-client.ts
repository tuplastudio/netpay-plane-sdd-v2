/**
 * Capa HTTP común a los clientes REST y MCP: autenticación, timeout,
 * reintentos con backoff y guardia anti-SSRF (reusa integrations/url-guard).
 *
 * `fetchImpl` y `sleep` se inyectan para poder probar sin red.
 */

import { assertPublicHttpUrl } from "../integrations/url-guard.js";

export type DataSourceAuthType = "NONE" | "BEARER" | "API_KEY_HEADER" | "BASIC";

export interface ConnectionAuth {
  authType: DataSourceAuthType;
  /** Token / API key / "usuario:contraseña" ya descifrado. */
  credential: string | null;
  /** Solo API_KEY_HEADER. */
  authHeaderName: string | null;
  /** Headers extra fijos. */
  headers: Record<string, string> | null;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HttpOptions {
  fetchImpl?: FetchLike;
  /** Por petición. */
  timeoutMs?: number;
  /** Reintentos adicionales ante red/5xx/429 (default 2). */
  retries?: number;
  /** Base del backoff exponencial (default 400 ms). */
  retryBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Validación de URL antes de cada petición (default: url-guard con DNS). */
  guard?: (url: string) => Promise<unknown>;
  /** Tope del cuerpo de respuesta (default 20 MB). */
  maxBodyBytes?: number;
}

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_BODY_BYTES = 20 * 1024 * 1024;

export class DataSourceHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "DataSourceHttpError";
  }
}

/** Headers de autenticación + extras. Los extras nunca pisan Authorization. */
export function buildAuthHeaders(auth: ConnectionAuth): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(auth.headers ?? {})) {
    if (k.toLowerCase() === "authorization") continue;
    headers[k] = v;
  }
  const cred = auth.credential ?? "";
  switch (auth.authType) {
    case "BEARER":
      if (cred) headers.authorization = `Bearer ${cred}`;
      break;
    case "API_KEY_HEADER":
      if (cred) headers[auth.authHeaderName?.trim() || "x-api-key"] = cred;
      break;
    case "BASIC":
      if (cred) headers.authorization = `Basic ${Buffer.from(cred, "utf8").toString("base64")}`;
      break;
    case "NONE":
    default:
      break;
  }
  return headers;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Lee el cuerpo como texto respetando el tope de bytes. */
export async function readBodyText(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    throw new DataSourceHttpError(`Respuesta demasiado grande (${declared} bytes)`, res.status);
  }
  const text = await res.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new DataSourceHttpError("Respuesta demasiado grande", res.status);
  }
  return text;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  text: string;
}

/**
 * Petición con guard, timeout y reintentos. Devuelve la respuesta cruda
 * (texto) para que cada cliente decida cómo decodificarla (JSON o SSE).
 * Lanza `DataSourceHttpError` para 4xx (sin reintento) y tras agotar
 * reintentos en 5xx/429/red.
 */
export async function httpRequest(
  url: string,
  init: RequestInit,
  options: HttpOptions = {},
): Promise<HttpResponse> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
  const retries = options.retries ?? 2;
  const baseMs = options.retryBaseMs ?? 400;
  const sleep = options.sleep ?? defaultSleep;
  const guard = options.guard ?? assertPublicHttpUrl;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  let lastError: DataSourceHttpError | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    // Se vuelve a validar antes de CADA intento (DNS rebinding).
    await guard(url);
    try {
      const res = await fetchImpl(url, {
        ...init,
        // Nunca seguir redirecciones: un 30x podría llevar a una IP interna.
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new DataSourceHttpError(`HTTP ${res.status}`, res.status, true);
      } else if (res.status >= 300) {
        throw new DataSourceHttpError(`HTTP ${res.status}`, res.status, false);
      } else {
        const text = await readBodyText(res, maxBody);
        return { status: res.status, headers: res.headers, text };
      }
    } catch (err) {
      if (err instanceof DataSourceHttpError) {
        if (!err.retryable) throw err;
        lastError = err;
      } else {
        const message = err instanceof Error ? err.message : String(err);
        const timedOut = err instanceof Error && err.name === "TimeoutError";
        lastError = new DataSourceHttpError(
          timedOut ? `Tiempo de espera agotado (${timeoutMs} ms)` : `Error de red: ${message}`,
          undefined,
          true,
        );
      }
    }
    if (attempt < retries) await sleep(baseMs * 2 ** attempt);
  }
  throw lastError ?? new DataSourceHttpError("Error desconocido");
}

/** Decodifica JSON con un error legible. */
export function parseJsonText(text: string, context: string): unknown {
  try {
    return text.trim() === "" ? null : (JSON.parse(text) as unknown);
  } catch {
    throw new DataSourceHttpError(`${context}: la respuesta no es JSON válido`);
  }
}
