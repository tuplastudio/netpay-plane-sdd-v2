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

export interface ApiKeySummary {
  id: string;
  prefix: string; // público, ej. npk_live_abc
  name: string;
  scopes: string[];
  createdAt: Iso8601;
  expiresAt: Iso8601 | null;
  revokedAt: Iso8601 | null;
}

export interface CreateApiKeyResponse extends ApiKeySummary {
  /** Visible SOLO en creación. No se persiste en claro. */
  secret: string;
}