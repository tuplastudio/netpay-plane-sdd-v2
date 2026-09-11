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

/**
 * Catálogo cerrado de scopes existentes, derivado de la propia matriz (OWNER
 * los tiene todos por definición, pero se calcula por unión para que agregar
 * un scope a otro rol no lo deje fuera del catálogo por descuido).
 *
 * Sirve como lista blanca al emitir API keys: sin ella, `scopes: string[]`
 * dejaba acuñar credenciales con cadenas arbitrarias.
 */
export const ALL_SCOPES: ReadonlyArray<Scope> = Object.freeze(
  [...new Set(Object.values(ROLE_SCOPES).flat())].sort(),
) as ReadonlyArray<Scope>;

/** ¿La cadena es un scope conocido? */
export function isScope(value: unknown): value is Scope {
  return typeof value === "string" && (ALL_SCOPES as ReadonlyArray<string>).includes(value);
}

/**
 * Scopes de los que dispone realmente un principal:
 *
 *  - USER: los de su rol (la matriz de arriba).
 *  - API_KEY / SERVICE: los grabados en la credencial, filtrados contra el
 *    catálogo (una key vieja puede tener cadenas que ya no son scopes).
 *  - ANONYMOUS: ninguno.
 *
 * Es la misma cuenta que hace `RoleGuard` para autorizar; se comparte para que
 * la emisión de API keys no invente una segunda jerarquía.
 */
export function effectiveScopesOf(principal: {
  type: string;
  role?: string;
  scopes?: ReadonlyArray<string>;
}): ReadonlySet<Scope> {
  if (principal.type === "API_KEY" || principal.type === "SERVICE") {
    return new Set((principal.scopes ?? []).filter(isScope));
  }
  if (principal.type === "USER") {
    return new Set(scopesFor(principal.role ?? "VIEWER"));
  }
  return new Set<Scope>();
}