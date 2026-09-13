/**
 * Tipos, claves de caché y helpers compartidos por las pantallas de
 * `/super-admin`. Sin JSX a propósito: es la capa de datos de la sección.
 *
 * Contrato del backend (`apps/commerce-api`, controladores `super-admin/*`).
 * Todas las respuestas vienen envueltas en `{ data, requestId }` y los errores
 * como `{ code, message }`.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type TenantStatus = "ACTIVE" | "DISABLED";
export type MembershipStatus = "ACTIVE" | "INVITED" | "DISABLED";

/** Consumo del agente en el mes en curso (`usageMtd`). */
export interface UsageMtd {
  /** Decimal en string: va tal cual a `<Money currency="USD">`. */
  costUsd: string;
  totalTokens: number;
  events: number;
}

export interface Overview {
  tenants: { total: number; active: number; disabled: number };
  users: number;
  pendingInvitations: number;
  usageMtd: UsageMtd;
  /** Métricas extra del dashboard (T-SA-08). */
  newTenantsThisMonth: number;
  activeConversations: number;
  ordersMtd: number;
  revenueMtd: string;
  /** Serie de 7 días del gasto del agente (más viejo → más nuevo). */
  usageTrend: Array<{ day: string; events: number; tokens: number; costUsd: string }>;
  /** Eventos recientes del AuditLog de TODA la plataforma. */
  recentActivity: Array<{
    id: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    metadata: unknown;
    createdAt: string;
    actor: { id: string; email: string; fullName: string | null } | null;
    tenant: { id: string; name: string; slug: string } | null;
  }>;
  from: string;
  to: string;
}

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  createdAt: string;
  primaryColor: string;
  _count: { memberships: number; products: number; orders: number };
  usageMtd: UsageMtd;
}

export interface TenantMembership {
  id: string;
  role: string;
  status: MembershipStatus;
  joinedAt: string | null;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    isSuperAdmin: boolean;
    createdAt: string;
  };
}

export interface TenantInvitation {
  id: string;
  email: string;
  fullName: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

export interface TenantDetail {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  createdAt: string;
  usageMtd: UsageMtd;
  memberships: TenantMembership[];
  invitations: TenantInvitation[];
  _count: { products: number; orders: number };
}

export interface ModelUsageRow {
  model: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
}

export interface TenantUsage {
  from: string;
  to: string;
  byModel: ModelUsageRow[];
  totalCostUsd: string;
  totalTokens: number;
}

/** Un renglón del desglose día × modelo (`GET /super-admin/usage/detail`). */
export interface UsageDetailRow {
  /** "YYYY-MM-DD" en la zona horaria de la empresa (`timeZone`). */
  day: string;
  model: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
}

/** Drill-down de consumo de una empresa: base de los paneles de "Costos". */
export interface TenantUsageDetail {
  from: string;
  to: string;
  timeZone: string;
  byDayAndModel: UsageDetailRow[];
  totalCostUsd: string;
  totalTokens: number;
}

export interface PlatformUser {
  id: string;
  email: string;
  fullName: string | null;
  isSuperAdmin: boolean;
  totpEnabled: boolean;
  createdAt: string;
  memberships: Array<{
    id: string;
    role: string;
    status: MembershipStatus;
    tenant: { id: string; name: string; slug: string; status: TenantStatus };
  }>;
}

/** Respuesta de `POST /super-admin/tenants/:id/invitations` (misma que `POST /iam/invitations`). */
export interface InvitationCreated {
  token?: string;
  expiresAt?: string;
}

// ---------------------------------------------------------------------------
// Claves de caché — todas bajo el prefijo `["super-admin", …]`
// ---------------------------------------------------------------------------

export const SA_ROOT_KEY = ["super-admin"] as const;
export const SA_OVERVIEW_KEY = ["super-admin", "overview"] as const;
export const SA_TENANTS_KEY = ["super-admin", "tenants"] as const;
export const saTenantKey = (id: string) => ["super-admin", "tenant", id] as const;
export const saTenantUsageKey = (id: string, from: string, to: string) =>
  ["super-admin", "tenant", id, "usage", from, to] as const;
export const saTenantUsageDetailKey = (id: string, from: string, to: string) =>
  ["super-admin", "tenant", id, "usage-detail", from, to] as const;
export const saUsersKey = (q: string) => ["super-admin", "users", q] as const;
export const saUsageKey = (month: string, tenantId: string) =>
  ["super-admin", "usage", month, tenantId] as const;

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** Orden de presentación. El super-admin puede otorgar cualquiera, OWNER incluido. */
export const ALL_ROLES = [
  "OWNER",
  "ADMIN",
  "VENDOR",
  "FINANCE",
  "CATALOG",
  "SUPPORT",
  "VIEWER",
] as const;
export type Role = (typeof ALL_ROLES)[number];

// ---------------------------------------------------------------------------
// Errores del API
// ---------------------------------------------------------------------------

/** Extrae el `message` del cuerpo de error del backend (`{ code, message }`). */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const detail = (
    error as { response?: { data?: { message?: string; error?: { message?: string } } } } | null
  )?.response?.data;
  return detail?.message ?? detail?.error?.message ?? fallback;
}

export function apiErrorStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status;
}

// ---------------------------------------------------------------------------
// Formato de conteos
// ---------------------------------------------------------------------------

const INT_FORMAT = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

/** Entero con separador de miles es-MX ("12,345"); em dash sin dato. */
export function formatInt(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? INT_FORMAT.format(value) : "—";
}

// ---------------------------------------------------------------------------
// Periodos mensuales
// ---------------------------------------------------------------------------

/** Nombres de mes en es-MX, estáticos: sin `toLocaleDateString` en línea. */
const MONTHS_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

export interface MonthOption {
  /** "YYYY-MM" */
  value: string;
  /** "Septiembre 2026" */
  label: string;
}

/** Últimos `count` meses, el más reciente primero. */
export function monthOptions(count = 12): MonthOption[] {
  const out: MonthOption[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value, label: `${MONTHS_ES[d.getMonth()] ?? ""} ${d.getFullYear()}` });
  }
  return out;
}

/** Rango ISO [primer día 00:00, último día 23:59:59] del mes "YYYY-MM". */
export function monthRange(value: string): { from: string; to: string } {
  const [year, month] = value.split("-").map(Number);
  const y = year ?? new Date().getFullYear();
  const m = month ?? new Date().getMonth() + 1;
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 0, 23, 59, 59);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Etiqueta legible del mes "YYYY-MM" ("Septiembre 2026"). */
export function monthLabel(value: string): string {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return `${MONTHS_ES[month - 1] ?? ""} ${year}`;
}

/** Etiqueta del mes en curso, para las pistas de los mosaicos "del mes". */
export function currentMonthLabel(): string {
  const now = new Date();
  return `${MONTHS_ES[now.getMonth()] ?? ""} ${now.getFullYear()}`;
}
