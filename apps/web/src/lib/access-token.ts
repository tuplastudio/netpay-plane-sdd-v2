/**
 * Almacén en memoria para el access token JWT.
 *
 * El access token vive SOLO aquí, no en `localStorage` ni `sessionStorage`.
 * Razones:
 *   - `localStorage` es legible por cualquier script en la página (XSS lo
 *     roba sin esfuerzo). El access es de corta vida (15 min) pero sigue
 *     siendo valioso mientras está vivo.
 *   - `sessionStorage` muere con la pestaña; cerrar el tab = login de nuevo.
 *     Eso rompe el flujo normal del usuario.
 *
 * El refresh token es lo que importa para "recordar al usuario": vive en
 * cookie `HttpOnly` (no accesible desde JS), dura 30 días, y el backend lo
 * rota en cada `/auth/refresh` para cerrar la ventana de replay.
 *
 * Esta variable se reinicia al recargar la pestaña (es un módulo: muere con
 * el bundle). En la siguiente petición, si el access ya expiró, el
 * interceptor de `lib/api.ts` llama `/auth/refresh` y el backend emite uno
 * nuevo desde el refresh cookie. El usuario sigue autenticado sin re-login.
 *
 * Como el módulo se evalúa una sola vez, el token sobrevive entre
 * peticiones de la misma pestaña (que es lo que queremos), pero NO entre
 * pestañas ni recargas.
 */

let accessToken: string | null = null;
let accessExpiresAt: Date | null = null;

export function setAccessToken(token: string, expiresAtIso: string): void {
  accessToken = token;
  accessExpiresAt = new Date(expiresAtIso);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getAccessExpiresAt(): Date | null {
  return accessExpiresAt;
}

export function clearAccessToken(): void {
  accessToken = null;
  accessExpiresAt = null;
}

/** True si el access token expira en menos de `skewSeconds`. Útil para
 * gatillar un refresh proactivo antes de un 401. */
export function accessTokenNearExpiry(skewSeconds = 30): boolean {
  if (!accessExpiresAt) return true;
  const nowMs = Date.now();
  return accessExpiresAt.getTime() - nowMs < skewSeconds * 1000;
}