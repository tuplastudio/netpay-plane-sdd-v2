/**
 * Qué puede ver y hacer cada rol en el panel.
 *
 * Los scopes los calcula el backend (`auth/policies.ts` → `GET /auth/me#scopes`);
 * aquí solo se decide qué mostrar con ellos. El backend sigue siendo la
 * autoridad: esconder algo aquí es para no enseñar botones que acaban en 403,
 * no una medida de seguridad.
 */

export type Scope =
  | "catalog.read"
  | "catalog.write"
  | "customers.read"
  | "customers.write"
  | "quotes.read"
  | "quotes.write"
  | "orders.read"
  | "orders.write"
  | "orders.cancel_own"
  | "orders.cancel_any"
  | "payments.read"
  | "payments.refund"
  | "payments.export"
  | "chat.read"
  | "chat.write"
  | "notifications.read"
  | "notifications.write"
  | "integrations.read"
  | "integrations.write"
  | "audit.read"
  | "tenant.admin"
  | "users.invite"
  | "users.manage"
  | "apikeys.manage";

/** Basta con tener UNO de los scopes. Sin `anyOf` ni `superAdmin`, abierto. */
export interface Access {
  anyOf?: readonly Scope[];
  superAdmin?: boolean;
}

/** Leer la configuración del bot / transcripts (igual que el proxy del agente). */
export const AGENT_READ: readonly Scope[] = ["chat.read", "integrations.read", "tenant.admin"];
/** Configurar el bot: conocimiento, ajustes, aprendizajes. */
export const AGENT_MANAGE: readonly Scope[] = ["tenant.admin", "integrations.write"];

/**
 * Secciones del panel. El orden importa: gana el primer prefijo que coincide.
 * Es la única tabla: la usan el sidebar, la búsqueda y el guardia de páginas.
 */
export const ROUTE_ACCESS: ReadonlyArray<{ prefix: string; access: Access }> = [
  { prefix: "/super-admin", access: { superAdmin: true } },
  { prefix: "/catalog", access: { anyOf: ["catalog.read"] } },
  { prefix: "/quotes", access: { anyOf: ["quotes.read"] } },
  { prefix: "/quick-charge", access: { anyOf: ["orders.write"] } },
  { prefix: "/orders", access: { anyOf: ["orders.read"] } },
  { prefix: "/payments", access: { anyOf: ["payments.read"] } },
  { prefix: "/customers", access: { anyOf: ["customers.read"] } },
  { prefix: "/chat", access: { anyOf: ["chat.write"] } },
  { prefix: "/agent", access: { anyOf: AGENT_MANAGE } },
  { prefix: "/channels", access: { anyOf: ["integrations.write"] } },
  { prefix: "/conversations", access: { anyOf: ["chat.read"] } },
];

export function accessForPath(pathname: string): Access {
  const hit = ROUTE_ACCESS.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return hit?.access ?? {};
}

export interface Permissions {
  /** `false` mientras no se conocen los scopes (sesión aún sin hidratar). */
  ready: boolean;
  isSuperAdmin: boolean;
  scopes: ReadonlySet<string>;
}

export function makePermissions(input: {
  scopes?: readonly string[] | null;
  isSuperAdmin?: boolean;
}): Permissions {
  const known = Array.isArray(input.scopes) && input.scopes.length > 0;
  return {
    ready: known,
    isSuperAdmin: input.isSuperAdmin === true,
    scopes: new Set(known ? input.scopes : []),
  };
}

export function hasScope(p: Permissions, scope: Scope): boolean {
  return p.scopes.has(scope);
}

export function hasAny(p: Permissions, scopes: readonly Scope[]): boolean {
  return scopes.some((s) => p.scopes.has(s));
}

/**
 * ¿Puede entrar? Sin scopes conocidos se deja pasar: el backend decide y así
 * no parpadea un "sin permiso" mientras carga la sesión.
 */
export function canAccess(p: Permissions, access: Access): boolean {
  if (access.superAdmin) return !p.ready || p.isSuperAdmin;
  if (!access.anyOf || access.anyOf.length === 0) return true;
  if (!p.ready) return true;
  return hasAny(p, access.anyOf);
}
