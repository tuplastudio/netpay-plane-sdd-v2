/**
 * Matriz normativa de permisos por rol.
 * Ver docs/03-iam.md. Una sola fuente de verdad para guards y policies.
 */

export type Scope =
  // Catálogo
  | "catalog.read"
  | "catalog.write"
  // Clientes
  | "customers.read"
  | "customers.write"
  // Cotizaciones
  | "quotes.read"
  | "quotes.write"
  // Pedidos / checkout
  | "orders.read"
  | "orders.write"
  | "orders.cancel_own"
  | "orders.cancel_any"
  // Pagos
  | "payments.read"
  | "payments.refund"
  | "payments.export"
  // Chat / canales
  | "chat.read"
  | "chat.write"
  // Notificaciones
  | "notifications.read"
  | "notifications.write"
  // Integraciones
  | "integrations.read"
  | "integrations.write"
  // Auditoría
  | "audit.read"
  // Empresa y usuarios
  | "tenant.admin"
  | "users.invite"
  | "users.manage"
  | "apikeys.manage";

export const ROLE_SCOPES: Record<string, ReadonlyArray<Scope>> = {
  OWNER: [
    "catalog.read", "catalog.write",
    "customers.read", "customers.write",
    "quotes.read", "quotes.write",
    "orders.read", "orders.write", "orders.cancel_own", "orders.cancel_any",
    "payments.read", "payments.refund", "payments.export",
    "chat.read", "chat.write",
    "notifications.read", "notifications.write",
    "integrations.read", "integrations.write",
    "audit.read",
    "tenant.admin", "users.invite", "users.manage", "apikeys.manage",
  ],
  ADMIN: [
    "catalog.read", "catalog.write",
    "customers.read", "customers.write",
    "quotes.read", "quotes.write",
    "orders.read", "orders.write", "orders.cancel_own", "orders.cancel_any",
    "payments.read",
    "chat.read", "chat.write",
    "notifications.read", "notifications.write",
    "integrations.read", "integrations.write",
    "audit.read",
    "users.invite", "users.manage", "apikeys.manage",
  ],
  VENDOR: [
    "catalog.read",
    "customers.read", "customers.write",
    "quotes.read", "quotes.write",
    "orders.read", "orders.cancel_own",
    "chat.read", "chat.write",
    "notifications.read",
  ],
  FINANCE: [
    "catalog.read",
    "customers.read",
    "quotes.read",
    "orders.read",
    "payments.read", "payments.refund", "payments.export",
    "notifications.read",
  ],
  CATALOG: [
    "catalog.read", "catalog.write",
  ],
  SUPPORT: [
    "catalog.read",
    "customers.read",
    "quotes.read",
    "orders.read",
    "chat.read", "chat.write",
    "notifications.read",
  ],
  VIEWER: [
    "catalog.read",
    "customers.read",
    "quotes.read",
    "orders.read",
    "notifications.read",
  ],
};

/** Devuelve los scopes efectivos de un rol. */
export function scopesFor(role: string): ReadonlyArray<Scope> {
  return ROLE_SCOPES[role] ?? [];
}

/** Indica si el rol tiene el scope. */
export function roleHas(role: string, scope: Scope): boolean {
  return scopesFor(role).includes(scope);
}