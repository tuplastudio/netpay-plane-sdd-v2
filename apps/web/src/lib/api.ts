import axios, { type AxiosInstance } from "axios";
import {
  type AuthMe,
  type SessionUser,
  clearSession,
  sessionFromMe,
  writeSession,
} from "./session";
import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from "./access-token";

/**
 * Cliente HTTP. Se reescribe a /api/v1 en el proxy de Next.js (next.config.mjs)
 * y reenvía al backend NestJS. Cookies de sesión se reenvían automáticamente
 * con `withCredentials`.
 *
 * Refresh token: cuando el backend devuelve 401, el interceptor intenta un
 * `POST /auth/refresh` una vez. Si succeede, reintenta el request original.
 * Si falla, borra la sesión y deja que la pantalla decida (normalmente /login).
 *
 * El 401 de `/auth/refresh`, `/auth/login` y `/auth/mfa/verify` nunca dispara
 * este flujo (ver `NO_REFRESH_PATHS` abajo): evita un deadlock cuando el
 * propio refresh falla y evita reintentar credenciales inválidas como si
 * fueran una sesión vencida.
 */
export function createApiClient(opts?: { baseURL?: string }): AxiosInstance {
  const client = axios.create({
    baseURL: opts?.baseURL ?? "/api/v1",
    withCredentials: true,
    headers: { "content-type": "application/json" },
    timeout: 30_000,
  });

  // Request interceptor: inyecta `Authorization: Bearer <accessToken>` cuando
  // hay uno en memoria. El refresh cookie se reenvía solo por `withCredentials`.
  // Los endpoints que NO llevan bearer son los que NO deben autenticarse:
  // `/auth/login`, `/auth/mfa/verify`, `/auth/refresh`, `/auth/forgot-password`,
  // `/auth/reset-password`, `/auth/accept-invite`, `/auth/bootstrap`. La lista
  // está en `NO_AUTH_PATHS` y se chequea contra `config.url`.
  client.interceptors.request.use((config) => {
    const url = config.url ?? "";
    const isAuthEndpoint = NO_AUTH_PATHS.some((p) => url.includes(p));
    if (!isAuthEndpoint) {
      const token = getAccessToken();
      if (token) {
        config.headers = config.headers ?? ({} as typeof config.headers);
        config.headers["Authorization"] = `Bearer ${token}`;
      }
    }
    return config;
  });

  // Response interceptor: si la respuesta de un endpoint de auth trae un
  // `accessToken` en JSON, lo guarda en memoria. Login y MFA/verify la
  // usan; /auth/refresh también (pero ese caso lo cubre `attemptRefresh`
  // directamente porque necesita los campos específicos).
  client.interceptors.response.use(
    (response) => {
      const body = response.data as { data?: { accessToken?: string; accessExpiresAt?: string } } | undefined;
      const at = body?.data?.accessToken;
      const exp = body?.data?.accessExpiresAt;
      if (typeof at === "string" && typeof exp === "string") {
        setAccessToken(at, exp);
      }
      return response;
    },
    (error) => Promise.reject(error),
  );

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
      // /auth/refresh rota el par (access, refresh): la respuesta trae el
      // access nuevo. El response interceptor genérico ya lo guarda en
      // memoria cuando lo ve en `data.accessToken`, así que aquí solo
      // esperamos a que la promesa resuelva.
      await client.post("/auth/refresh");
      onRefreshSuccess();
    } catch {
      clearAccessToken();
      clearSession();
      onRefreshFailure();
      throw new Error("Session expired");
    }
  }

  // Endpoints donde NO se inyecta Bearer (request) ni se intenta refresh
  // (response) — son los puntos de la vida de la autenticación, no recursos
  // autenticados.
  // - `/auth/refresh`: deadlock con `attemptRefresh` (ver doc original abajo).
  // - `/auth/login` y `/auth/mfa/verify`: credenciales inválidas, no sesión.
  // - `/auth/forgot-password`, `/auth/reset-password`, `/auth/accept-invite`,
  //   `/auth/bootstrap`: anónimos por diseño.
  const NO_AUTH_PATHS = [
    "/auth/refresh",
    "/auth/login",
    "/auth/mfa/verify",
    "/auth/forgot-password",
    "/auth/reset-password",
    "/auth/accept-invite",
    "/auth/bootstrap",
  ];

  // Endpoints de auth que NUNCA deben disparar un refresh en su propio 401:
  // - `/auth/refresh`: es la llamada que hace `attemptRefresh` mismo. Sin esta
  //   exclusión, un 401 de refresh (sesión ya no válida, el caso normal de
  //   que falle) vuelve a entrar por este interceptor, que llama de nuevo a
  //   `attemptRefresh` — pero `isRefreshing` ya está en `true`, así que esa
  //   segunda llamada se encola en `refreshQueue` y espera a que la PRIMERA
  //   llamada resuelva. La primera llamada está esperando la respuesta de su
  //   propio `client.post("/auth/refresh")`, que es justo la promesa
  //   encolada: ninguna de las dos se resuelve nunca (deadlock). Esto era el
  //   bug real detrás de "el refresh no funciona": no fallaba con un error,
  //   se quedaba colgado para siempre y la UI nunca redirigía a /login.
  // - `/auth/login` y `/auth/mfa/verify`: su 401 es "credenciales inválidas"
  //   o "código MFA inválido", no una sesión vencida. No hay sesión que
  //   refrescar todavía.
  const NO_REFRESH_PATHS = ["/auth/refresh", "/auth/login", "/auth/mfa/verify"];

  client.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      const axiosError = error as {
        response?: { status?: number };
        config?: { _retry?: boolean; url?: string };
      };

      const isNoRefreshPath = NO_REFRESH_PATHS.some((path) =>
        axiosError.config?.url?.includes(path),
      );
      // El proxy `/agent/*` habla con otro servicio: sus 401/502 no dicen
      // nada de la sesión del portal y no deben cerrarla.
      const isAgentProxy = axiosError.config?.url?.includes("/agent/") ?? false;

      // 401 → intentar refresh una vez por request
      if (
        axiosError.response?.status === 401 &&
        !axiosError.config?._retry &&
        !isNoRefreshPath &&
        !isAgentProxy
      ) {
        const config = axiosError.config;
        if (config) config._retry = true;

        try {
          await attemptRefresh();
          // Refresh ok: reintentar el request original con el Bearer nuevo
          // (el interceptor de request lo lee de `getAccessToken()` otra vez).
          return client(config! as Parameters<typeof client>[0]);
        } catch {
          // Refresh falló: limpiar sesión y rechazar para que la UI
          // haga lo que tenga que hacer (normalmente redirect a /login).
          clearAccessToken();
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
