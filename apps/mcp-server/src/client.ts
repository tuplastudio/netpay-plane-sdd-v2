/**
 * Cliente HTTP hacia commerce-api. Autenticación por API key
 * (`Authorization: Bearer npk_...`), la misma que expone el panel en
 * Empresa → API keys — nunca sesión de usuario. `COMMERCE_API_KEY` es la
 * única credencial que este proceso necesita; determina qué tenant y qué
 * scopes puede usar (ver apps/commerce-api/src/auth/principal.guard.ts).
 *
 * `COMMERCE_TENANT_ID` es opcional y solo tiene efecto con una key GLOBAL
 * (sin tenant propio, T-IAM-09b): manda `X-Tenant-Id` en cada request para
 * decirle a commerce-api sobre qué empresa operar. Con una key de tenant
 * normal no hace falta — el tenant ya viene fijo en la key — y el header,
 * si se manda de todos modos, se ignora (PrincipalGuard solo lo lee cuando
 * la key resolvió como global).
 */
import { SUPER_ADMIN_OVERVIEW_PATH } from "./registry/super-admin.js";

const DEFAULT_BASE_URL = "https://api-easysell.tupla.dev/api/v1";

/**
 * Tope duro por request: sin esto, una conexión colgada a commerce-api deja
 * la tool esperando indefinidamente y con ella el cliente MCP entero (stdio
 * es un solo canal secuencial). 30s es generoso para cualquier endpoint real
 * de este API; configurable por si un despliegue propio lo necesita más largo.
 */
function timeoutMs(): number {
  const raw = process.env.COMMERCE_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
}

function baseUrl(): string {
  const raw = process.env.COMMERCE_API_BASE_URL ?? DEFAULT_BASE_URL;
  // CRÍTICO: validar scheme. Sin esto, un `.mcp.json` o config compartida
  // puede apuntar el MCP a `http://evil.com` y exfiltrar la API key en cada
  // request vía el header `Authorization: Bearer npk_...`. Permitimos
  // `http://` SOLO para hosts locales (loopback) — útil para dev contra
  // un commerce-api local sin TLS — y exigimos `https://` para todo lo
  // demás, sin excepciones.
  let parsed: URL;
  try {
    parsed = new URL(raw.replace(/\/+$/, ""));
  } catch {
    throw new Error(
      `COMMERCE_API_BASE_URL inválida: ${JSON.stringify(raw)}. Debe ser una URL absoluta (ej. https://api.example.com/api/v1).`,
    );
  }
  const isLoopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]" ||
    parsed.hostname === "::1";
  if (parsed.protocol === "http:" && !isLoopback) {
    throw new Error(
      `COMMERCE_API_BASE_URL insegura: ${parsed.protocol}//${parsed.host} no es loopback. ` +
        "Solo se permite http:// hacia localhost/127.0.0.1/[::1] (dev). En cualquier otro caso usa https://.",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `COMMERCE_API_BASE_URL insegura: scheme ${JSON.stringify(parsed.protocol)} no soportado. Usa https:// (o http://localhost en dev).`,
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}

function apiKey(): string {
  const key = process.env.COMMERCE_API_KEY;
  if (!key) {
    throw new Error(
      "COMMERCE_API_KEY no configurada. Crea una API key en el panel (Empresa → API keys) " +
        "y pásala como variable de entorno al arrancar este servidor MCP.",
    );
  }
  return key;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${apiKey()}` };
  const tenantId = process.env.COMMERCE_TENANT_ID;
  if (tenantId) headers["x-tenant-id"] = tenantId;
  return headers;
}

export interface ApiResult {
  ok: boolean;
  status: number;
  data: unknown;
}

/**
 * Lee el body de una Response con tope de tamaño. Intenta parsear JSON; si
 * falla, devuelve el texto crudo (cubre text/html de proxies, mensajes 502
 * vacíos, etc.). Devuelve `null` si el body está vacío. Si excede
 * `RESPONSE_MAX_BYTES`, devuelve `{ error: "RESPONSE_TOO_LARGE" }` sin
 * retener el contenido (cliente MCP recibe error accionable, no se Buffea
 * un payload de GBs en RAM).
 */
const RESPONSE_MAX_BYTES = 16 * 1024 * 1024; // 16 MiB

async function readBody(res: Response): Promise<unknown> {
  // Early check vía Content-Length (cuando el backend lo manda). Si declara
  // más del tope, ni siquiera intentamos leer.
  const cl = res.headers.get("content-length");
  if (cl !== null) {
    const declared = Number(cl);
    if (Number.isFinite(declared) && declared > RESPONSE_MAX_BYTES) {
      return {
        error: "RESPONSE_TOO_LARGE",
        message: `El backend anunció ${declared} bytes; el tope local es ${RESPONSE_MAX_BYTES}.`,
        maxBytes: RESPONSE_MAX_BYTES,
      };
    }
  }
  // Lectura streaming con cap real (cubre chunked sin Content-Length).
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > RESPONSE_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return {
        error: "RESPONSE_TOO_LARGE",
        message: `La respuesta excedió ${RESPONSE_MAX_BYTES} bytes durante la lectura.`,
        maxBytes: RESPONSE_MAX_BYTES,
      };
    }
    chunks.push(value);
  }
  if (chunks.length === 0) return null;
  // Concatenación robusta (no depende de Buffer.concat con Uint8Array[]):
  // un solo Uint8Array del tamaño exacto + TextDecoder.
  const merged = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    merged.set(c, pos);
    pos += c.byteLength;
  }
  const text = new TextDecoder().decode(merged);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Ejecuta la petición. Nunca lanza por un error HTTP del backend (4xx/5xx):
 * ese error es información útil para el agente (falta un scope, un recurso
 * no existe, una validación falló), así que se devuelve como dato normal
 * con `ok:false`, no como excepción — el handler de la tool lo traduce a
 * `isError` de MCP sin perder el detalle del body. Tampoco lanza por
 * configuración inválida (URL malformada, scheme no permitido) — eso sería
 * una falla de arranque, no de tool, y debe llegar al cliente como un
 * mensaje accionable, no como un stack trace.
 */
export async function apiRequest(
  method: string,
  path: string,
  opts: { query?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<ApiResult> {
  let url: URL;
  try {
    url = new URL(baseUrl() + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  } catch (err) {
    return { ok: false, status: 0, data: { error: "CONFIG_ERROR", message: (err as Error).message } };
  }

  const hasBody = opts.body !== undefined;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...authHeaders(),
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (err) {
    return { ok: false, status: 0, data: { error: "NETWORK_ERROR", message: (err as Error).message, url: url.toString() } };
  }

  return { ok: res.ok, status: res.status, data: await readBody(res) };
}

export interface DownloadResult {
  ok: boolean;
  status: number;
  base64?: string;
  mimeType?: string;
  error?: unknown;
}

/**
 * Tope para descargas binarias. PDFs de cotización reales son < 5 MB;
 * CSVs de notificaciones con cientos de miles de filas pueden ser más
 * grandes pero rara vez > 32 MB. 32 MB decoded = ~43 MB de base64 — un
 * cliente MCP que guarda el base64 en su transcript se queda sin disco
 * rápido si pasamos de ahí. El backend controla el origen del archivo;
 * este cap es defensa en profundidad contra respuestas corruptas/gigantes.
 */
const DOWNLOAD_MAX_BYTES = 32 * 1024 * 1024;

/** Descarga binaria (PDF de cotización, CSV de notificaciones): la respuesta no es JSON, se devuelve en base64 con tope. */
export async function apiDownload(path: string): Promise<DownloadResult> {
  let url: URL;
  try {
    url = new URL(baseUrl() + path);
  } catch (err) {
    return { ok: false, status: 0, error: { error: "CONFIG_ERROR", message: (err as Error).message } };
  }
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers: authHeaders(), signal: AbortSignal.timeout(timeoutMs()) });
  } catch (err) {
    return { ok: false, status: 0, error: { message: (err as Error).message, url: url.toString() } };
  }
  if (!res.ok) {
    // Errores del backend: pasar por readBody para tener JSON parseado (o
    // texto crudo) sin riesgo de OOM por respuestas de error gigantes.
    const data = await readBody(res);
    return { ok: false, status: res.status, error: data ?? null };
  }
  // Early check vía Content-Length: si declara > tope, no leemos.
  const cl = res.headers.get("content-length");
  if (cl !== null) {
    const declared = Number(cl);
    if (Number.isFinite(declared) && declared > DOWNLOAD_MAX_BYTES) {
      return {
        ok: false,
        status: res.status,
        error: {
          error: "DOWNLOAD_TOO_LARGE",
          message: `El backend anunció ${declared} bytes; el tope local es ${DOWNLOAD_MAX_BYTES}.`,
          maxBytes: DOWNLOAD_MAX_BYTES,
        },
      };
    }
  }
  // Streaming con cap (cubre chunked sin Content-Length).
  const reader = res.body?.getReader();
  if (!reader) {
    return { ok: false, status: res.status, error: { message: "response body vacío" } };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > DOWNLOAD_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return {
        ok: false,
        status: res.status,
        error: {
          error: "DOWNLOAD_TOO_LARGE",
          message: `El binario excedió ${DOWNLOAD_MAX_BYTES} bytes durante la lectura.`,
          maxBytes: DOWNLOAD_MAX_BYTES,
        },
      };
    }
    chunks.push(value);
  }
  if (chunks.length === 0) {
    return {
      ok: true,
      status: res.status,
      base64: "",
      mimeType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }
  const merged = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    merged.set(c, pos);
    pos += c.byteLength;
  }
  return {
    ok: true,
    status: res.status,
    base64: Buffer.from(merged).toString("base64"),
    mimeType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

/**
 * Tope local ANTES de salir a la red. El backend (`ProductImageUploadInterceptor`)
 * ya tope a 5 MB, pero este es un segundo piso de defensa: rechaza payloads
 * obviamente sobredimensionados (5 MB decoded + overhead de multipart) sin
 * pagar el costo de decodificar el base64 gigante, armar FormData y mandar la
 * request. 8 MiB decoded = ~10.7 MiB de base64 = aprox el peor caso real
 * (imagen PNG 6000x6000 + cabecera + FormData boundary).
 */
const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Caracteres máximos del string base64 ANTES del decode. Base64 son 4
 * chars por cada 3 bytes; redondeamos hacia arriba con un margen para
 * padding/espacios. Sin este check, un payload malicioso de 1 GB de base64
 * se decodifica a ~750 MB en RAM (`Buffer.from(b64, 'base64')` no es
 * lazy) y mata el proceso antes de poder validar el tamaño post-decode.
 */
const UPLOAD_MAX_B64_CHARS = Math.ceil((UPLOAD_MAX_BYTES * 4) / 3) + 64;

/**
 * Subida multipart (fotos de catálogo): las dos únicas rutas del registro
 * que no son JSON puro, así que no encajan en `apiRequest` / el DSL
 * declarativo de `registry/types.ts`. El agente manda la imagen en base64;
 * aquí se valida el tamaño ANTES del decode y se arma el
 * `multipart/form-data` que espera `ProductImageUploadInterceptor` (campo
 * `file`).
 */
export async function apiUpload(
  path: string,
  file: { base64: string; filename: string; mimeType: string },
): Promise<ApiResult> {
  let url: URL;
  try {
    url = new URL(baseUrl() + path);
  } catch (err) {
    return { ok: false, status: 0, data: { error: "CONFIG_ERROR", message: (err as Error).message } };
  }
  // Primer piso: cap por longitud del string base64 antes del decode.
  // Más barato que decodificar y validar después, y evita memory-bomb.
  if (file.base64.length > UPLOAD_MAX_B64_CHARS) {
    return {
      ok: false,
      status: 0,
      data: {
        error: "PAYLOAD_TOO_LARGE",
        message: `El base64 mide ${file.base64.length} caracteres; el tope es ~${UPLOAD_MAX_B64_CHARS} (~${UPLOAD_MAX_BYTES} bytes decoded).`,
        maxBytes: UPLOAD_MAX_BYTES,
      },
    };
  }
  const bytes = Buffer.from(file.base64, "base64");
  // Segundo piso (defensa en profundidad): por si el base64 traía padding
  // excesivo que infló la longitud sin representar tantos bytes.
  if (bytes.byteLength > UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      status: 0,
      data: {
        error: "PAYLOAD_TOO_LARGE",
        message: `El archivo decodificado pesa ${bytes.byteLength} bytes; el tope es ${UPLOAD_MAX_BYTES}.`,
        maxBytes: UPLOAD_MAX_BYTES,
      },
    };
  }
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: file.mimeType }), file.filename);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders(),
      body: form,
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (err) {
    return { ok: false, status: 0, data: { error: "NETWORK_ERROR", message: (err as Error).message, url: url.toString() } };
  }

  return { ok: res.ok, status: res.status, data: await readBody(res) };
}

/**
 * Detecta, al arrancar, si la key configurada es GLOBAL (T-IAM-09b) —
 * probando un endpoint que solo `SuperAdminGuard` deja pasar. Nunca lanza:
 * "unknown" si no se pudo determinar (red caída, key inválida — eso ya lo
 * va a reportar la primera tool que se use). Solo informativo, para el aviso
 * de arranque en `main.ts`; ninguna tool depende de este resultado.
 *
 * El path del probe viene del registry (`SUPER_ADMIN_OVERVIEW_PATH`) para
 * que un rename de la ruta no rompa silenciosamente el aviso de "key global".
 */
export async function probeKeyKind(): Promise<"global" | "tenant" | "unknown"> {
  try {
    const res = await fetch(new URL(baseUrl() + SUPER_ADMIN_OVERVIEW_PATH), {
      method: "GET",
      headers: authHeaders(),
      signal: AbortSignal.timeout(timeoutMs()),
    });
    if (res.status === 200) return "global";
    if (res.status === 403 || res.status === 401) return "tenant";
    return "unknown";
  } catch {
    return "unknown";
  }
}
