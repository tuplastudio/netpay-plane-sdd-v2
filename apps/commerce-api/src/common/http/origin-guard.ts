import type { NextFunction, Request, Response } from "express";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Defensa CSRF para la sesión por cookie (SameSite=Lax ya frena la mayoría;
 * esto cubre el resto): en métodos con efecto, si el navegador manda
 * `Origin`/`Referer` y no coincide con el frontend permitido, se rechaza.
 *
 * Sin `Origin` (curl, servicios, API key) se deja pasar: no hay cookie de
 * sesión que robar en esas llamadas y la auth la decide el guard normal.
 */
export function originGuard(allowedOrigins: string[]) {
  const allowed = new Set(
    allowedOrigins.map((o) => originOf(o)).filter((o): o is string => Boolean(o)),
  );
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!UNSAFE.has(req.method)) return next();
    const cookieHeader = req.headers.cookie ?? "";
    const hasSessionCookie = /(?:^|;\s*)(?:__Host-)?session=/.test(cookieHeader);
    if (!hasSessionCookie) return next();

    const origin = originOf(req.headers.origin as string | undefined)
      ?? originOf(req.headers.referer as string | undefined);
    if (!origin) return next();
    if (allowed.has(origin)) return next();

    res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Origen no permitido para esta operación",
        retryable: false,
      },
    });
  };
}
