/**
 * Tipos del API `/data-sources` y helpers puros del asistente: el formulario
 * edita un `Draft` plano (todo strings) y aquí se convierte al cuerpo que
 * espera commerce-api. Sin React: se puede probar sin montar nada.
 */

export type DataSourceKind = "REST" | "MCP";
export type DataSourceAuthType = "NONE" | "BEARER" | "API_KEY_HEADER" | "BASIC";
export type DataSourceStatus = "ACTIVE" | "PAUSED" | "ERROR";
export type RunStatus = "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";

/** `GET /data-sources` (apps/commerce-api/src/data-sources/data-source.service.ts). */
export interface DataSource {
  id: string;
  name: string;
  kind: DataSourceKind;
  status: DataSourceStatus;
  url: string;
  authType: DataSourceAuthType;
  authHeaderName: string | null;
  headers: Record<string, string> | null;
  config: Record<string, unknown>;
  scheduleEveryMinutes: number | null;
  scheduleCron: string | null;
  deactivateMissing: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: RunStatus | null;
  lastError: string | null;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunStats {
  fetched: number;
  mapped: number;
  created: number;
  updated: number;
  skipped: number;
  deactivated: number;
  errors: number;
  images: number;
}

export interface DataSourceRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  stats: RunStats | null;
  errorSample: Array<{ index?: number; sku?: string; message: string }> | null;
  triggeredBy: "MANUAL" | "SCHEDULE";
}

export interface MappedPreview {
  ok: boolean;
  item?: {
    sku: string;
    externalId: string;
    name: string;
    description: string | null;
    price: string;
    currency: string;
    stock: string | null;
    imageUrls: string[];
    category: string | null;
    active: boolean;
  };
  error?: string;
}

export interface McpTool {
  name: string;
  description?: string;
}

export interface TestResult {
  ok: boolean;
  fetched: number;
  rawSample: unknown[];
  preview: MappedPreview[];
  tools?: McpTool[];
}

export const KIND_LABELS: Record<DataSourceKind, string> = { REST: "API REST", MCP: "Servidor MCP" };

export const AUTH_LABELS: Record<DataSourceAuthType, string> = {
  NONE: "Sin autenticación",
  BEARER: "Token Bearer",
  API_KEY_HEADER: "API key en header",
  BASIC: "Usuario y contraseña (Basic)",
};

export const SOURCE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Activa",
  PAUSED: "Pausada",
  ERROR: "Con error",
};

export const RUN_STATUS_LABELS: Record<string, string> = {
  RUNNING: "En curso",
  SUCCEEDED: "Completada",
  PARTIAL: "Con errores",
  FAILED: "Fallida",
};

export const TRIGGER_LABELS: Record<string, string> = { MANUAL: "Manual", SCHEDULE: "Programada" };

export type FieldKey =
  | "sku"
  | "name"
  | "price"
  | "description"
  | "currency"
  | "stock"
  | "imageUrl"
  | "category"
  | "active"
  | "externalId";

export interface FieldDef {
  key: FieldKey;
  label: string;
  required: boolean;
  placeholder: string;
  hint: string;
}

export const FIELD_DEFS: ReadonlyArray<FieldDef> = [
  { key: "sku", label: "SKU", required: true, placeholder: "sku", hint: "Identifica el producto en tu catálogo. Único por empresa." },
  { key: "name", label: "Nombre", required: true, placeholder: "name", hint: "Título que verá el cliente y el agente." },
  { key: "price", label: "Precio", required: true, placeholder: "price.amount", hint: "Número o texto como \"1,250.50\"." },
  { key: "currency", label: "Moneda", required: false, placeholder: "=MXN", hint: "Código ISO de 3 letras. Si no viene, MXN." },
  { key: "stock", label: "Existencias", required: false, placeholder: "inventory.quantity", hint: "Vacío = sin control de inventario." },
  { key: "description", label: "Descripción", required: false, placeholder: "description", hint: "Texto libre; se recorta a 4000 caracteres." },
  { key: "category", label: "Categoría", required: false, placeholder: "category.name", hint: "Se agrega como etiqueta del producto." },
  { key: "active", label: "Activo", required: false, placeholder: "status", hint: "false, 0, no, inactive o archived = inactivo. Vacío = activo." },
  { key: "externalId", label: "Id externo", required: false, placeholder: "id", hint: "Id del sistema origen. Si no viene se usa el SKU." },
  { key: "imageUrl", label: "Imagen (URL)", required: false, placeholder: "images[*].src", hint: "Solo se muestra en la vista previa; las imágenes no se importan todavía." },
];

export type ScheduleMode = "manual" | "interval" | "cron";
export type PaginationType = "none" | "page" | "cursor";

/** Estado plano del asistente. Todo string para ligarlo directo a inputs. */
export interface Draft {
  id: string | null;
  name: string;
  kind: DataSourceKind;
  url: string;
  authType: DataSourceAuthType;
  credential: string;
  authHeaderName: string;
  /** Una línea por header: `Nombre: valor`. */
  headersText: string;
  // REST
  listPath: string;
  method: "GET" | "POST";
  queryText: string;
  bodyText: string;
  paginationType: PaginationType;
  pageParam: string;
  sizeParam: string;
  pageSize: string;
  startPage: string;
  cursorParam: string;
  nextCursorPath: string;
  // MCP
  toolName: string;
  toolArgsText: string;
  // común
  itemsJsonPath: string;
  fieldMap: Record<FieldKey, string>;
  scheduleMode: ScheduleMode;
  everyMinutes: string;
  cron: string;
  deactivateMissing: boolean;
  status: "ACTIVE" | "PAUSED";
}

const EMPTY_FIELD_MAP: Record<FieldKey, string> = {
  sku: "",
  name: "",
  price: "",
  description: "",
  currency: "",
  stock: "",
  imageUrl: "",
  category: "",
  active: "",
  externalId: "",
};

export function emptyDraft(kind: DataSourceKind = "REST"): Draft {
  return {
    id: null,
    name: "",
    kind,
    url: "",
    authType: "NONE",
    credential: "",
    authHeaderName: "X-API-Key",
    headersText: "",
    listPath: "/products",
    method: "GET",
    queryText: "",
    bodyText: "",
    paginationType: "none",
    pageParam: "page",
    sizeParam: "limit",
    pageSize: "100",
    startPage: "1",
    cursorParam: "cursor",
    nextCursorPath: "meta.nextCursor",
    toolName: "",
    toolArgsText: "",
    itemsJsonPath: "",
    fieldMap: { ...EMPTY_FIELD_MAP, sku: "sku", name: "name", price: "price" },
    scheduleMode: "manual",
    everyMinutes: "60",
    cron: "0 3 * * *",
    deactivateMissing: false,
    status: "ACTIVE",
  };
}

function recordToLines(record: Record<string, unknown> | null | undefined): string {
  if (!record) return "";
  return Object.entries(record)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join("\n");
}

function jsonOrEmpty(value: unknown): string {
  if (value === undefined || value === null) return "";
  return JSON.stringify(value, null, 2);
}

/** Rellena el asistente con una fuente guardada (la credencial nunca viene). */
export function draftFromDataSource(source: DataSource): Draft {
  const base = emptyDraft(source.kind);
  const config = source.config;
  const pagination = (config.pagination as Record<string, unknown> | undefined) ?? {};
  const fieldMap = (config.fieldMap as Partial<Record<FieldKey, string>> | undefined) ?? {};
  return {
    ...base,
    id: source.id,
    name: source.name,
    url: source.url,
    authType: source.authType,
    credential: "",
    authHeaderName: source.authHeaderName ?? base.authHeaderName,
    headersText: recordToLines(source.headers),
    listPath: typeof config.listPath === "string" ? config.listPath : base.listPath,
    method: config.method === "POST" ? "POST" : "GET",
    queryText: recordToLines(config.query as Record<string, unknown> | undefined),
    bodyText: jsonOrEmpty(config.body),
    paginationType:
      pagination.type === "page" || pagination.type === "cursor" ? (pagination.type as PaginationType) : "none",
    pageParam: typeof pagination.pageParam === "string" ? pagination.pageParam : base.pageParam,
    sizeParam: typeof pagination.sizeParam === "string" ? pagination.sizeParam : "",
    pageSize: pagination.pageSize !== undefined ? String(pagination.pageSize) : "",
    startPage: pagination.startPage !== undefined ? String(pagination.startPage) : "1",
    cursorParam: typeof pagination.cursorParam === "string" ? pagination.cursorParam : base.cursorParam,
    nextCursorPath: typeof pagination.nextCursorPath === "string" ? pagination.nextCursorPath : base.nextCursorPath,
    toolName: typeof config.toolName === "string" ? config.toolName : "",
    toolArgsText: jsonOrEmpty(config.toolArgs),
    itemsJsonPath: typeof config.itemsJsonPath === "string" ? config.itemsJsonPath : "",
    fieldMap: { ...EMPTY_FIELD_MAP, ...fieldMap },
    scheduleMode: source.scheduleCron ? "cron" : source.scheduleEveryMinutes ? "interval" : "manual",
    everyMinutes: source.scheduleEveryMinutes ? String(source.scheduleEveryMinutes) : base.everyMinutes,
    cron: source.scheduleCron ?? base.cron,
    deactivateMissing: source.deactivateMissing,
    status: source.status === "PAUSED" ? "PAUSED" : "ACTIVE",
  };
}

export type DraftResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** `Nombre: valor` por línea → objeto. Líneas vacías se ignoran. */
export function parseKeyValueLines(text: string, what: string): DraftResult<Record<string, string> | undefined> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) return { ok: false, error: `${what}: cada línea debe ser "Nombre: valor" (revisa "${line}")` };
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) return { ok: false, error: `${what}: nombre inválido "${key}"` };
    out[key] = value;
  }
  return { ok: true, value: Object.keys(out).length > 0 ? out : undefined };
}

function parseJsonObject(text: string, what: string): DraftResult<Record<string, unknown> | undefined> {
  if (!text.trim()) return { ok: true, value: undefined };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: `${what}: debe ser un objeto JSON` };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: `${what}: JSON inválido` };
  }
}

function parseIntField(text: string, what: string, min: number, max: number): DraftResult<number | undefined> {
  if (!text.trim()) return { ok: true, value: undefined };
  const n = Number(text);
  if (!Number.isInteger(n) || n < min || n > max) {
    return { ok: false, error: `${what}: entero entre ${min} y ${max}` };
  }
  return { ok: true, value: n };
}

/** Cuerpo de `POST /data-sources` (y de `PATCH` sin `kind`). */
export interface DataSourcePayload {
  name: string;
  kind: DataSourceKind;
  url: string;
  authType: DataSourceAuthType;
  credential?: string;
  authHeaderName?: string;
  headers?: Record<string, string>;
  config: Record<string, unknown>;
  scheduleEveryMinutes: number | null;
  scheduleCron: string | null;
  deactivateMissing: boolean;
  status: "ACTIVE" | "PAUSED";
}

/** Solo la conexión (paso 1): lo que necesita `POST /data-sources/tools`. */
export interface ConnectionPayload
  extends Pick<DataSourcePayload, "url" | "authType" | "credential" | "authHeaderName" | "headers"> {
  /** Fuente guardada: el backend reutiliza su credencial si no se manda otra. */
  id?: string;
}

export function connectionPayload(draft: Draft): DraftResult<ConnectionPayload> {
  if (!draft.url.trim()) return { ok: false, error: "Escribe la URL de la fuente" };
  if (!/^https?:\/\//i.test(draft.url.trim())) return { ok: false, error: "La URL debe empezar con http:// o https://" };
  const headers = parseKeyValueLines(draft.headersText, "Headers");
  if (!headers.ok) return headers;
  const value: ConnectionPayload = {
    url: draft.url.trim(),
    authType: draft.authType,
    headers: headers.value,
  };
  if (draft.authType !== "NONE" && draft.credential) value.credential = draft.credential;
  if (draft.authType === "API_KEY_HEADER") value.authHeaderName = draft.authHeaderName.trim() || "X-API-Key";
  if (draft.id) value.id = draft.id;
  return { ok: true, value };
}

/** Config de mapeo (paso 2) según el tipo. */
export function configPayload(draft: Draft): DraftResult<Record<string, unknown>> {
  const fieldMap: Record<string, string> = {};
  for (const def of FIELD_DEFS) {
    const value = draft.fieldMap[def.key]?.trim();
    if (value) fieldMap[def.key] = value;
    else if (def.required) return { ok: false, error: `El campo "${def.label}" es obligatorio en el mapeo` };
  }
  const common = { itemsJsonPath: draft.itemsJsonPath.trim(), fieldMap };
  if (draft.kind === "MCP") {
    if (!draft.toolName.trim()) return { ok: false, error: "Elige la tool del servidor MCP" };
    const args = parseJsonObject(draft.toolArgsText, "Argumentos de la tool");
    if (!args.ok) return args;
    return { ok: true, value: { ...common, toolName: draft.toolName.trim(), toolArgs: args.value } };
  }
  if (!draft.listPath.trim()) return { ok: false, error: "Escribe la ruta del listado (p. ej. /products)" };
  const query = parseKeyValueLines(draft.queryText, "Parámetros de consulta");
  if (!query.ok) return query;
  const body = parseJsonObject(draft.bodyText, "Cuerpo JSON");
  if (!body.ok) return body;
  let pagination: Record<string, unknown> = { type: "none" };
  if (draft.paginationType === "page") {
    const pageSize = parseIntField(draft.pageSize, "Tamaño de página", 1, 1000);
    if (!pageSize.ok) return pageSize;
    const startPage = parseIntField(draft.startPage, "Primera página", 0, 1_000_000);
    if (!startPage.ok) return startPage;
    if (!draft.pageParam.trim()) return { ok: false, error: "Indica el parámetro de página" };
    pagination = {
      type: "page",
      pageParam: draft.pageParam.trim(),
      sizeParam: draft.sizeParam.trim() || undefined,
      pageSize: pageSize.value,
      startPage: startPage.value,
    };
  } else if (draft.paginationType === "cursor") {
    if (!draft.cursorParam.trim() || !draft.nextCursorPath.trim()) {
      return { ok: false, error: "Indica el parámetro del cursor y la ruta del siguiente cursor" };
    }
    pagination = { type: "cursor", cursorParam: draft.cursorParam.trim(), nextCursorPath: draft.nextCursorPath.trim() };
  }
  return {
    ok: true,
    value: {
      ...common,
      listPath: draft.listPath.trim(),
      method: draft.method,
      query: query.value,
      body: draft.method === "POST" ? body.value : undefined,
      pagination,
    },
  };
}

/** Cuerpo completo para crear/actualizar (paso 3). */
export function draftToPayload(draft: Draft): DraftResult<DataSourcePayload> {
  if (!draft.name.trim()) return { ok: false, error: "Ponle un nombre a la fuente" };
  const connection = connectionPayload(draft);
  if (!connection.ok) return connection;
  const config = configPayload(draft);
  if (!config.ok) return config;
  let scheduleEveryMinutes: number | null = null;
  let scheduleCron: string | null = null;
  if (draft.scheduleMode === "interval") {
    const minutes = parseIntField(draft.everyMinutes, "Intervalo", 5, 7 * 24 * 60);
    if (!minutes.ok) return minutes;
    if (minutes.value === undefined) return { ok: false, error: "Indica cada cuántos minutos sincronizar" };
    scheduleEveryMinutes = minutes.value;
  } else if (draft.scheduleMode === "cron") {
    if (draft.cron.trim().split(/\s+/).length !== 5) return { ok: false, error: "El cron debe tener 5 campos" };
    scheduleCron = draft.cron.trim();
  }
  const { id: _id, ...connectionFields } = connection.value;
  return {
    ok: true,
    value: {
      name: draft.name.trim(),
      kind: draft.kind,
      ...connectionFields,
      config: config.value,
      scheduleEveryMinutes,
      scheduleCron,
      deactivateMissing: draft.deactivateMissing,
      status: draft.status,
    },
  };
}

/** "Cada 30 min", "Cron 0 3 * * *" o "Solo manual". */
export function describeSchedule(source: Pick<DataSource, "scheduleEveryMinutes" | "scheduleCron">): string {
  if (source.scheduleCron) return `Cron ${source.scheduleCron}`;
  const m = source.scheduleEveryMinutes;
  if (!m) return "Solo manual";
  if (m % 1440 === 0) return m === 1440 ? "Cada día" : `Cada ${m / 1440} días`;
  if (m % 60 === 0) return m === 60 ? "Cada hora" : `Cada ${m / 60} horas`;
  return `Cada ${m} min`;
}

/** Una fuente está corriendo si tiene el lock puesto hace menos de 30 min. */
export function isRunning(source: Pick<DataSource, "lockedAt">, now: number = Date.now()): boolean {
  if (!source.lockedAt) return false;
  const locked = new Date(source.lockedAt).getTime();
  return Number.isFinite(locked) && now - locked < 30 * 60_000;
}
