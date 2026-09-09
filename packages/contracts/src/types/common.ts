// Tipos comunes compartidos por API, web y agent
// Ver docs/17-contratos-api-eventos.md

export type Iso8601 = string; // RFC3339 UTC
export type TenantId = string; // UUIDv7
export type UserId = string; // UUIDv7
export type ResourceId = string; // UUIDv7

/** Decimal string con dos decimales para dinero (ej: "199.99"). */
export type Money = string;
/** Decimal string con tres decimales para cantidades (ej: "1.500"). */
export type Quantity = string;
/** Moneda soportada. */
export type Currency = "MXN";

export interface RequestEnvelope<T> {
  data: T;
  requestId: string;
}

export interface Page<T> {
  data: T[];
  page: {
    nextCursor: string | null;
    hasMore: boolean;
  };
  requestId: string;
}

export interface PageInput {
  cursor?: string;
  limit?: number; // 1..100; default 25
}

export interface AuditFields {
  createdAt: Iso8601;
  updatedAt: Iso8601;
  createdBy: UserId | null;
  updatedBy: UserId | null;
  version: number; // optimistic concurrency
}

export interface TenantScoped {
  tenantId: TenantId;
}

/** Identificador UUIDv7 (timestamp-ordered). */
export type UuidV7 = string;