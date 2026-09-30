import type { Tone } from "@/components/ui/status-badge";

/**
 * Tipos y helpers puros de la sección de API keys (sin React), para que la
 * lógica de estado, permisos y formatos sea testeable aparte de los
 * componentes.
 *
 * Contratos: `GET /iam/api-keys` (apps/commerce-api/src/auth/api-key.service.ts
 * → list) y `GET /iam/api-keys/:id/usage[/summary]`
 * (src/auth/usage/api-key-usage.service.ts). Mismas formas en
 * `packages/contracts/src/types/iam.ts`.
 */

export type ApiKeyStatus = "ACTIVE" | "EXPIRED" | "REVOKED" | "ROTATED";

export interface ApiKey {
  id: string;
  prefix: string;
  name: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  rotatedAt: string | null;
  rotatedToId: string | null;
  createdBy: { id: string; fullName: string; email: string } | null;
  status: ApiKeyStatus;
}

export interface ApiKeyUsageEvent {
  id: string;
  occurredAt: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip: string | null;
  userAgent: string | null;
  scopeUsed: string | null;
  errorCode: string | null;
}

export interface ApiKeyUsageSummary {
  days: number;
  from: string;
  to: string;
  totals: { requests: number; errors: number; requests7d: number; avgDurationMs: number | null };
  lastUsedAt: string | null;
  lastIp: string | null;
  distinctIps: number;
  byDay: Array<{ day: string; total: number; errors: number }>;
  byPath: Array<{ method: string; path: string; count: number; errors: number }>;
  byStatus: Array<{ statusCode: number; count: number }>;
}

/** Respuesta de `POST /iam/api-keys/:id/rotate`. */
export interface RotatedApiKey {
  id: string;
  prefix: string;
  name: string;
  scopes: string[];
  secret: string;
  expiresAt: string | null;
  rotatedFromId: string;
  previousKey: { id: string; prefix: string; graceHours: number; validUntil: string };
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

export interface ScopeOption {
  scope: string;
  label: string;
  description: string;
}

export interface ScopeGroup {
  title: string;
  scopes: ScopeOption[];
}

/**
 * Catálogo de scopes (fuente: apps/commerce-api/src/auth/policies.ts) con la
 * descripción que ve quien emite la key. Si el backend agrega un scope, hay
 * que darlo de alta aquí para que aparezca en el formulario.
 */
export const SCOPE_GROUPS: ReadonlyArray<ScopeGroup> = [
  {
    title: "Catálogo",
    scopes: [
      { scope: "catalog.read", label: "Leer catálogo", description: "Consultar productos, variantes, precios e imágenes." },
      { scope: "catalog.write", label: "Editar catálogo", description: "Crear y modificar productos, variantes e inventario." },
    ],
  },
  {
    title: "Clientes",
    scopes: [
      { scope: "customers.read", label: "Leer clientes", description: "Consultar la ficha y el historial de los clientes." },
      { scope: "customers.write", label: "Editar clientes", description: "Crear clientes y actualizar sus datos de contacto y facturación." },
    ],
  },
  {
    title: "Cotizaciones",
    scopes: [
      { scope: "quotes.read", label: "Leer cotizaciones", description: "Consultar cotizaciones y su estado." },
      { scope: "quotes.write", label: "Crear cotizaciones", description: "Crear, editar y emitir cotizaciones." },
    ],
  },
  {
    title: "Pedidos",
    scopes: [
      { scope: "orders.read", label: "Leer pedidos", description: "Consultar pedidos, envíos y seguimiento." },
      { scope: "orders.write", label: "Crear pedidos", description: "Registrar pedidos y abrir cobros." },
      { scope: "orders.cancel_own", label: "Cancelar propios", description: "Cancelar pedidos creados con esta misma credencial." },
      { scope: "orders.cancel_any", label: "Cancelar cualquiera", description: "Cancelar cualquier pedido de la empresa." },
    ],
  },
  {
    title: "Pagos",
    scopes: [
      { scope: "payments.read", label: "Leer pagos", description: "Consultar cobros, sesiones de pago y el libro mayor." },
      { scope: "payments.refund", label: "Reembolsar", description: "Emitir reembolsos totales o parciales. Solo propietarios y finanzas." },
      { scope: "payments.export", label: "Exportar pagos", description: "Descargar reportes y conciliaciones." },
    ],
  },
  {
    title: "Chat",
    scopes: [
      { scope: "chat.read", label: "Leer conversaciones", description: "Consultar conversaciones y mensajes de WhatsApp y chat web." },
      { scope: "chat.write", label: "Responder", description: "Enviar mensajes y gestionar conversaciones." },
    ],
  },
  {
    title: "Notificaciones",
    scopes: [
      { scope: "notifications.read", label: "Leer notificaciones", description: "Consultar el historial de notificaciones enviadas." },
      { scope: "notifications.write", label: "Enviar notificaciones", description: "Disparar notificaciones a clientes." },
    ],
  },
  {
    title: "Integraciones",
    scopes: [
      { scope: "integrations.read", label: "Leer integraciones", description: "Consultar canales, webhooks y su estado." },
      { scope: "integrations.write", label: "Configurar integraciones", description: "Conectar canales y configurar el agente." },
    ],
  },
  {
    title: "Auditoría",
    scopes: [
      { scope: "audit.read", label: "Leer auditoría", description: "Consultar la bitácora de acciones de la empresa." },
    ],
  },
  {
    title: "Administración",
    scopes: [
      { scope: "tenant.admin", label: "Administrar empresa", description: "Cambiar ajustes, marca y configuración fiscal. Solo propietarios." },
      { scope: "users.invite", label: "Invitar usuarios", description: "Enviar invitaciones a nuevos miembros." },
      { scope: "users.manage", label: "Gestionar usuarios", description: "Cambiar roles y dar de baja miembros." },
      { scope: "apikeys.manage", label: "Gestionar API keys", description: "Crear, rotar y revocar API keys (incluida esta)." },
    ],
  },
];

const SCOPE_INDEX = new Map(
  SCOPE_GROUPS.flatMap((g) => g.scopes.map((s) => [s.scope, s] as const)),
);

/** Descripción corta de un scope, o el propio scope si es desconocido. */
export function describeScope(scope: string): string {
  return SCOPE_INDEX.get(scope)?.description ?? scope;
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export const API_KEY_STATUS_LABELS: Record<ApiKeyStatus, string> = {
  ACTIVE: "Activa",
  EXPIRED: "Expirada",
  REVOKED: "Revocada",
  ROTATED: "En gracia",
};

export const API_KEY_STATUS_TONES: Record<ApiKeyStatus, Tone> = {
  ACTIVE: "success",
  EXPIRED: "neutral",
  REVOKED: "destructive",
  ROTATED: "warning",
};

/** Solo una key viva se puede editar, rotar o revocar. */
export function isApiKeyMutable(key: Pick<ApiKey, "status">): boolean {
  return key.status === "ACTIVE" || key.status === "ROTATED";
}

// ---------------------------------------------------------------------------
// Formatos
// ---------------------------------------------------------------------------

const COUNT_FORMAT = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

/** Conteos con separador de miles es-MX (no hay primitiva para enteros). */
export function formatCount(n: number): string {
  return COUNT_FORMAT.format(n);
}

const RELATIVE_FORMAT = new Intl.RelativeTimeFormat("es-MX", { numeric: "auto" });

const RELATIVE_STEPS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
];

/**
 * "hace 3 minutos", "ayer", "hace 2 meses". Menos de un minuto → "hace un
 * momento". Fecha inválida o ausente → `null` (quien pinta decide el em dash).
 */
export function formatRelativeTime(value: string | null | undefined, now: Date = new Date()): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs < 60_000) return diff <= 0 ? "hace un momento" : "en un momento";
  for (const step of RELATIVE_STEPS) {
    if (abs >= step.ms) {
      return RELATIVE_FORMAT.format(Math.round(diff / step.ms), step.unit);
    }
  }
  return "hace un momento";
}

/** Tono semántico de un status HTTP para la tabla de eventos. */
export function httpStatusTone(statusCode: number): Tone {
  if (statusCode >= 500) return "destructive";
  if (statusCode >= 400) return "warning";
  if (statusCode >= 300) return "info";
  return "success";
}

/** `YYYY-MM-DD` → "29 sept" para el eje de la gráfica, sin `toLocaleDateString`. */
const DAY_LABEL_FORMAT = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export function formatDayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return DAY_LABEL_FORMAT.format(date);
}

/** Convierte una fecha ISO del API al valor de un `<input type="date">`. */
export function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

/**
 * Valor de `<input type="date">` → ISO al final de ese día (23:59:59 en la
 * zona local del navegador), para que "expira el 30" incluya el 30.
 */
export function fromDateInputValue(value: string): string | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 59).toISOString();
}
