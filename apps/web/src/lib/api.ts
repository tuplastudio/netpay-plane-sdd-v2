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
 *
 * Refresh token: cuando el backend devuelve 401, el interceptor intenta un
 * `POST /auth/refresh` una vez. Si succeede, reintenta el request original.
 * Si falla, borra la sesión y deja que la pantalla decida (normalmente /login).
 */
export function createApiClient(opts?: { baseURL?: string }): AxiosInstance {
  const client = axios.create({
    baseURL: opts?.baseURL ?? "/api/v1",
    withCredentials: true,
    headers: { "content-type": "application/json" },
    timeout: 30_000,
  });

  let isRefreshing = false;
  let refreshQueue: Array<{
    resolve: (token: string) => void;
    reject: (err: unknown) => void;
  }> = [];

  function onRefreshSuccess() {
    isRefreshing = false;
    refreshQueue.forEach((cb) => cb.resolve("refreshed"));
    refreshQueue = [];
  }

  function onRefreshFailure() {
    isRefreshing = false;
    refreshQueue.forEach((cb) => cb.reject(new Error("Refresh failed")));
    refreshQueue = [];
  }

  async function attemptRefresh(): Promise<void> {
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push({ resolve, reject });
      }) as unknown as Promise<void>;
    }

    isRefreshing = true;
    try {
      await client.post("/auth/refresh");
      onRefreshSuccess();
    } catch {
      clearSession();
      onRefreshFailure();
      throw new Error("Session expired");
    }
  }

  client.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      const axiosError = error as {
        response?: { status?: number };
        config?: { _retry?: boolean };
      };

      // 401 → intentar refresh una vez por request
      if (axiosError.response?.status === 401 && !axiosError.config?._retry) {
        const config = axiosError.config;
        if (config) config._retry = true;

        try {
          await attemptRefresh();
          // Refresh ok: reintentar el request original
          return client(config! as Parameters<typeof client>[0]);
        } catch {
          // Refresh falló: limpiar sesión y rechazar para que la UI
          // haga lo que tenga que hacer (normalmente redirect a /login).
          clearSession();
          if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
            window.location.href = "/login";
          }
        }
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
