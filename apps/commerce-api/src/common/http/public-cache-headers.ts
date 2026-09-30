import type { NextFunction, Request, Response } from "express";

/**
 * Política de caché de las lecturas públicas (links de cotización, checkout
 * y seguimiento, sin sesión).
 *
 * Son páginas personalizadas por token y con estado vivo (el cliente espera
 * ver "pagado" en cuanto pague), así que NO se permite servirlas desde caché
 * sin revalidar: `private, no-cache`. Lo que sí se aprovecha es el ETag débil
 * que Express ya calcula en `res.json`/`res.send`: el navegador manda
 * `If-None-Match` y, si la respuesta no cambió, recibe un 304 vacío en vez
 * del JSON completo (el sondeo de "¿ya se pagó?" cada 10 s cuesta cero bytes
 * mientras no cambie).
 */
export const PUBLIC_CACHE_CONTROL = "private, no-cache";

export function isPublicReadRequest(
  method: string,
  path: string,
  prefixes: readonly string[],
): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function publicCacheHeaders(prefixes: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isPublicReadRequest(req.method, req.path, prefixes)) {
      res.setHeader("Cache-Control", PUBLIC_CACHE_CONTROL);
    }
    next();
  };
}
