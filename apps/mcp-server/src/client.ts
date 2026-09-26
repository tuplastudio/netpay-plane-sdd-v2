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
  return raw.replace(/\/+$/, "");
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
 * Ejecuta la petición. Nunca lanza por un error HTTP del backend (4xx/5xx):
 * ese error es información útil para el agente (falta un scope, un recurso
 * no existe, una validación falló), así que se devuelve como dato normal
 * con `ok:false`, no como excepción — el handler de la tool lo traduce a
 * `isError` de MCP sin perder el detalle del body.
 */
export async function apiRequest(
  method: string,
  path: string,
  opts: { query?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<ApiResult> {
  const url = new URL(baseUrl() + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
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

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

export interface DownloadResult {
  ok: boolean;
  status: number;
  base64?: string;
  mimeType?: string;
  error?: unknown;
}

/** Descarga binaria (PDF de cotización): la respuesta no es JSON, así que se devuelve en base64. */
export async function apiDownload(path: string): Promise<DownloadResult> {
  const url = new URL(baseUrl() + path);
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers: authHeaders(), signal: AbortSignal.timeout(timeoutMs()) });
  } catch (err) {
    return { ok: false, status: 0, error: { message: (err as Error).message, url: url.toString() } };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let error: unknown = text;
    try {
      error = text ? JSON.parse(text) : null;
    } catch {
      // deja el texto crudo
    }
    return { ok: false, status: res.status, error };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    ok: true,
    status: res.status,
    base64: buf.toString("base64"),
    mimeType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

/**
 * Subida multipart (fotos de catálogo): las dos únicas rutas del registro
 * que no son JSON puro, así que no encajan en `apiRequest` / el DSL
 * declarativo de `registry/types.ts`. El agente manda la imagen en base64;
 * aquí se decodifica y se arma el `multipart/form-data` que espera
 * `ProductImageUploadInterceptor` (campo `file`).
 */
export async function apiUpload(
  path: string,
  file: { base64: string; filename: string; mimeType: string },
): Promise<ApiResult> {
  const url = new URL(baseUrl() + path);
  const bytes = Buffer.from(file.base64, "base64");
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

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * Detecta, al arrancar, si la key configurada es GLOBAL (T-IAM-09b) —
 * probando un endpoint que solo `SuperAdminGuard` deja pasar. Nunca lanza:
 * "unknown" si no se pudo determinar (red caída, key inválida — eso ya lo
 * va a reportar la primera tool que se use). Solo informativo, para el aviso
 * de arranque en `main.ts`; ninguna tool depende de este resultado.
 */
export async function probeKeyKind(): Promise<"global" | "tenant" | "unknown"> {
  try {
    const res = await fetch(new URL(baseUrl() + "/super-admin/overview"), {
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
