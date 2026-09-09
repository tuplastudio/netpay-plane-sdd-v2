import axios, { type AxiosInstance } from "axios";

/**
 * Cliente HTTP. Se reescribe a /api/v1 en el proxy de Next.js (next.config.mjs)
 * y reenvía al backend NestJS. Cookies de sesión se reenvían automáticamente
 * con `withCredentials`.
 */
export function createApiClient(opts?: { baseURL?: string }): AxiosInstance {
  return axios.create({
    baseURL: opts?.baseURL ?? "/api/v1",
    withCredentials: true,
    headers: { "content-type": "application/json" },
    timeout: 30_000,
  });
}

export const api = createApiClient();