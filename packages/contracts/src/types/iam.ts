import type { Iso8601, RequestEnvelope, UserId, TenantId } from "./common.js";

export interface BootstrapTenantRequest {
  tenantName: string;
  ownerEmail: string;
  ownerFullName: string;
  ownerPassword: string; // bootstrap: se valida complejidad mínima
  timezone: string; // IANA, ej. America/Mexico_City
}

export interface BootstrapTenantResponse {
  tenantId: TenantId;
  ownerUserId: UserId;
  invitationToken: string; // single-use, 48h
  configVersion: number;
}

export type BootstrapResult = RequestEnvelope<BootstrapTenantResponse>;

export interface LoginRequest {
  email: string;
  password: string;
  tenantSlug?: string;
}

export interface LoginResponse {
  sessionToken: string; // opaco, server-set cookie
  userId: UserId;
  tenantId: TenantId;
  role: Role;
  mfaRequired: boolean;
  expiresAt: Iso8601;
}

export interface AcceptInvitationRequest {
  token: string;
  password: string;
}

export interface Membership {
  userId: UserId;
  tenantId: TenantId;
  role: Role;
  status: "ACTIVE" | "INVITED" | "DISABLED";
  joinedAt: Iso8601;
}

export type Role =
  | "OWNER"
  | "ADMIN"
  | "VENDOR"
  | "FINANCE"
  | "CATALOG"
  | "SUPPORT"
  | "VIEWER";

export interface InviteUserRequest {
  email: string;
  fullName: string;
  role: Role;
}

/**
 * Estado derivado de una API key (ApiKeyService.apiKeyStatusOf):
 * REVOKED > EXPIRED > ROTATED (en gracia, aún válida) > ACTIVE.
 */
export type ApiKeyStatus = "ACTIVE" | "EXPIRED" | "REVOKED" | "ROTATED";

export interface ApiKeySummary {
  id: string;
  prefix: string; // público, ej. npk_live_abc
  name: string;
  scopes: string[];
  createdAt: Iso8601;
  expiresAt: Iso8601 | null;
  revokedAt: Iso8601 | null;
  lastUsedAt: Iso8601 | null;
  /** Fecha de rotación e id de la sucesora; null si nunca se rotó. */
  rotatedAt: Iso8601 | null;
  rotatedToId: string | null;
  createdBy: { id: UserId; fullName: string; email: string } | null;
  status: ApiKeyStatus;
}

export interface CreateApiKeyResponse {
  id: string;
  prefix: string;
  name: string;
  scopes: string[];
  expiresAt: Iso8601 | null;
  /** Visible SOLO en creación/rotación. No se persiste en claro. */
  secret: string;
}

/** `PATCH /iam/api-keys/:id`. Omitido = no se toca; `expiresAt: null` = sin vencimiento. */
export interface UpdateApiKeyRequest {
  name?: string;
  scopes?: string[];
  expiresAt?: Iso8601 | null;
}

/** `POST /iam/api-keys/:id/rotate`. 0 revoca la key vieja en el acto; default 24 h. */
export interface RotateApiKeyRequest {
  graceHours?: number;
}

export interface RotateApiKeyResponse extends CreateApiKeyResponse {
  rotatedFromId: string;
  previousKey: { id: string; prefix: string; graceHours: number; validUntil: Iso8601 };
}

/** Fila de `GET /iam/api-keys/:id/usage` (tabla ApiKeyUsage). */
export interface ApiKeyUsageEvent {
  id: string;
  tenantId: TenantId | null;
  apiKeyId: string;
  occurredAt: Iso8601;
  method: string;
  /** Ruta normalizada sin ids: `/api/v1/orders/:id`. */
  path: string;
  statusCode: number;
  durationMs: number;
  ip: string | null;
  userAgent: string | null;
  scopeUsed: string | null;
  errorCode: string | null;
}

/** Query de `GET /iam/api-keys/:id/usage`. `status` = `404` o `4xx`. */
export interface ApiKeyUsageQuery {
  from?: Iso8601;
  to?: Iso8601;
  path?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}

export interface ApiKeyUsagePage {
  data: ApiKeyUsageEvent[];
  pageInfo: { nextCursor: string | null; size: number };
  requestId: string;
}

/** `GET /iam/api-keys/:id/usage/summary?days=30`. */
export interface ApiKeyUsageSummary {
  days: number;
  from: Iso8601;
  to: Iso8601;
  totals: { requests: number; errors: number; requests7d: number; avgDurationMs: number | null };
  lastUsedAt: Iso8601 | null;
  lastIp: string | null;
  distinctIps: number;
  /** Serie completa (días sin tráfico en cero), `day` = YYYY-MM-DD en America/Mexico_City. */
  byDay: Array<{ day: string; total: number; errors: number }>;
  byPath: Array<{ method: string; path: string; count: number; errors: number }>;
  byStatus: Array<{ statusCode: number; count: number }>;
}