import axios, { type AxiosInstance } from "axios";
import {
  type AuthMe,
  type SessionUser,
  clearSession,
  sessionFromMe,
  writeSession,
} from "./session";

/**
 * Cliente HTTP. Se reescribe a /api/v1 en el proxy de Next.js (next.config.mjs)
 * y reenvía al backend NestJS. Cookies de sesión se reenvían automáticamente
 * con `withCredentials`.
 */
export function createApiClient(opts?: { baseURL?: string }): AxiosInstance {
  const client = axios.create({
    baseURL: opts?.baseURL ?? "/api/v1",
    withCredentials: true,
    headers: { "content-type": "application/json" },
    timeout: 30_000,
  });

  // Un 401 significa que el servidor ya no reconoce la cookie (expiró o la
  // revocaron). La caché de identidad se borra en el acto para que el menú de
  // cuenta no siga mostrando a un usuario que el backend desconoce. No se
  // redirige desde aquí: la pantalla decide qué hacer (login y MFA también
  // contestan 401 con credenciales malas, y ahí no hay a dónde ir).
  client.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      if ((error as { response?: { status?: number } })?.response?.status === 401) {
        clearSession();
      }
      return Promise.reject(error);
    },
  );

  return client;
}

export const api = createApiClient();

/**
 * `GET /auth/me` — la autoridad sobre quién tiene la sesión abierta.
 * Devuelve el objeto tal cual lo manda el backend para que comparta caché de
 * TanStack Query (`["auth-me"]`) con las demás pantallas que ya lo consultan.
 */
export async function fetchAuthMe(): Promise<AuthMe> {
  const res = await api.get<{ data: AuthMe }>("/auth/me");
  return res.data.data;
}

/**
 * `POST /auth/switch-tenant` — mueve la sesión a otra empresa del usuario.
 * El backend valida la membresía y borra una impersonación en curso. Tras
 * cambiar, quien llama debe vaciar la caché de consultas (todo lo cargado era
 * de la empresa anterior) y volver a pedir `/auth/me`; ver `tenant-switcher`.
 */
export async function switchTenant(
  tenantId: string,
): Promise<{ tenantId: string; slug: string; name: string; role: string }> {
  const res = await api.post<{ data: { tenantId: string; slug: string; name: string; role: string } }>(
    "/auth/switch-tenant",
    { tenantId },
  );
  return res.data.data;
}

/**
 * Cierre del ciclo de autenticación: con la cookie ya puesta por el backend,
 * pregunta quién quedó dentro y guarda solo la identidad de pantalla.
 *
 * `role` es el de la respuesta de login/MFA y solo actúa de respaldo: si
 * `/auth/me` trae el suyo, gana el del servidor.
 *
 * Si `/auth/me` falla por red o por un 5xx se guarda `fallback` (cuando la
 * pantalla tiene con qué armarlo) para no dejar el menú en "Entrar" con la
 * sesión abierta; el propio `UserMenu` vuelve a consultar `/auth/me` al
 * montarse y corrige lo que haga falta. Ante un 401 no se guarda nada: el
 * servidor dice que no hay sesión y él manda.
 */
export async function syncSessionAfterAuth(input: {
  role?: string;
  fallback?: SessionUser;
}): Promise<void> {
  try {
    writeSession(sessionFromMe(await fetchAuthMe(), input.role));
  } catch (error) {
    if ((error as { response?: { status?: number } })?.response?.status === 401) return;
    if (input.fallback) writeSession(input.fallback);
  }
}
