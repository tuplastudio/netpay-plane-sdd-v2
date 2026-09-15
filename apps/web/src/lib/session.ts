/**
 * Caché de identidad de la sesión — solo para pintar el chrome del portal.
 *
 * La autenticación **no** vive aquí: el backend abre sesión con una cookie
 * `HttpOnly` (`session` / `__Host-session`, ver `auth.controller.ts`) y axios la
 * reenvía sola con `withCredentials`. Este módulo guarda únicamente lo que el
 * `UserMenu` y el selector de empresa necesitan para no parpadear entre
 * recargas: correo, nombre, rol y la empresa activa (id, slug, nombre).
 *
 * Reglas:
 * - Nunca se guarda una credencial. El `sessionToken` que devuelven
 *   `POST /auth/login` y `POST /auth/mfa/verify` ya viaja en la cookie
 *   `HttpOnly`; duplicarlo en `localStorage` solo lo expondría a XSS sin
 *   habilitar nada nuevo. Tampoco se guardan contraseña, secreto TOTP ni
 *   códigos de recuperación.
 * - La autoridad es `GET /auth/me`. Lo de aquí es caché: si el servidor
 *   contesta 401, se borra (ver el interceptor de `lib/api.ts`) y el menú
 *   vuelve a "Entrar" aunque el `localStorage` dijera otra cosa.
 * - Los cambios se avisan con un evento propio para que el `UserMenu`, que ya
 *   está montado en el topbar cuando el login navega, se entere sin recargar.
 */

const SESSION_KEY = "netpay.session";
/** Se emite en `window` al escribir o borrar la caché (misma pestaña). */
const SESSION_EVENT = "netpay:session";

/** Identidad mínima para pintar el menú de cuenta. Nada sensible. */
export interface SessionUser {
  email: string;
  fullName?: string;
  /** Rol del usuario en el tenant. Sin él, el menú no inventa uno. */
  role?: string;
  /** Empresa activa de la sesión: id, slug y nombre para pintar el topbar. */
  tenantId?: string;
  tenantSlug?: string;
  tenantName?: string;
  /** Gestiona /super-admin (crear/editar empresas). Sin relación con `role`. */
  isSuperAdmin?: boolean;
  /**
   * Scopes efectivos del rol actual. El sidebar los usa para ocultar items
   * a los que el usuario no tiene acceso (en lugar de mostrar pinchos
   * que devuelven 403). Se hidrata desde `GET /auth/me#scopes`.
   */
  scopes?: readonly string[];
}

/** Una empresa a la que el usuario puede entrar (`GET /auth/me#memberships`). */
export interface AuthMembership {
  tenantId: string;
  slug: string;
  name: string;
  role: string;
  status: "ACTIVE";
  logoUrl: string | null;
}

export interface TenantBranding {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string | null;
}

/** Forma exacta de `GET /auth/me` (`auth.service.ts#me`). */
export interface AuthMe {
  id: string;
  email: string;
  fullName: string | null;
  totpEnabled: boolean;
  isSuperAdmin: boolean;
  role: string | null;
  /**
   * Id canónico del tenant. El agente lo usa para aislar conversaciones,
   * ajustes, conocimiento y llamadas comerciales en todos los canales.
   */
  tenantId: string | null;
  tenantSlug: string | null;
  tenantName: string | null;
  branding: TenantBranding | null;
  /**
   * Todas las empresas con membresía activa del usuario, ordenadas por nombre.
   * `tenantId` (arriba) dice cuál está activa; el selector del topbar cambia
   * entre ellas con `POST /auth/switch-tenant`.
   */
  memberships: AuthMembership[];
  /**
   * Scopes efectivos del rol actual (calculados server-side por
   * `auth.service.ts#me` con la matriz de `auth/policies.ts`). El sidebar los
   * usa para ocultar items a los que el usuario no tiene acceso.
   */
  scopes?: readonly string[];
}

/**
 * Proyecta la respuesta del servidor a la caché.
 *
 * El rol lo manda el servidor; `fallbackRole` (el de la respuesta de
 * login/MFA) solo cubre el hueco de un backend que todavía no lo conteste.
 */
export function sessionFromMe(me: AuthMe, fallbackRole?: string): SessionUser {
  const role = me.role ?? fallbackRole;
  return {
    email: me.email,
    ...(me.fullName ? { fullName: me.fullName } : {}),
    ...(role ? { role } : {}),
    ...(me.tenantId ? { tenantId: me.tenantId } : {}),
    ...(me.tenantSlug ? { tenantSlug: me.tenantSlug } : {}),
    ...(me.tenantName ? { tenantName: me.tenantName } : {}),
    isSuperAdmin: me.isSuperAdmin,
    ...(me.scopes ? { scopes: me.scopes } : {}),
  };
}

export function readSession(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // Un `localStorage` editado a mano no debe romper el topbar.
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<SessionUser>;
    if (typeof candidate.email !== "string" || !candidate.email) return null;
    return {
      email: candidate.email,
      ...(typeof candidate.fullName === "string" ? { fullName: candidate.fullName } : {}),
      ...(typeof candidate.role === "string" ? { role: candidate.role } : {}),
      ...(typeof candidate.tenantId === "string" ? { tenantId: candidate.tenantId } : {}),
      ...(typeof candidate.tenantSlug === "string" ? { tenantSlug: candidate.tenantSlug } : {}),
      ...(typeof candidate.tenantName === "string" ? { tenantName: candidate.tenantName } : {}),
      ...(typeof candidate.isSuperAdmin === "boolean"
        ? { isSuperAdmin: candidate.isSuperAdmin }
        : {}),
    };
  } catch {
    return null;
  }
}

export function writeSession(user: SessionUser): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  } catch {
    /* modo privado o cuota llena: el menú se resuelve igual con /auth/me */
  }
  notify();
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
  notify();
}

/**
 * Avisa de un cambio de caché. Devuelve la baja para usarla en el cleanup del
 * efecto. Escucha también `storage`, que cubre "cerré sesión en otra pestaña".
 */
export function subscribeSession(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SESSION_KEY) listener();
  };
  window.addEventListener(SESSION_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SESSION_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

function notify(): void {
  try {
    window.dispatchEvent(new Event(SESSION_EVENT));
  } catch {
    /* noop */
  }
}
