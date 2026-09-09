import type { NextFunction, Request, Response } from "express";

interface Window {
  count: number;
  resetAt: number;
}

export interface RateRule {
  /** Prefijo de ruta (ya con /api/v1). */
  prefix: string;
  /** Peticiones permitidas por ventana. */
  limit: number;
  /** Ventana en ms. */
  windowMs: number;
}

function clientIp(req: Request): string {
  const forwarded = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return forwarded || req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Rate limit por IP para superficies públicas (login, recuperación, webhooks,
 * enlaces públicos de cotización/checkout). En memoria: suficiente para una
 * instancia; con varias réplicas debe ir a Redis.
 */
export function publicRateLimit(rules: RateRule[]) {
  const windows = new Map<string, Window>();
  let lastGc = Date.now();

  const gc = (now: number) => {
    if (now - lastGc < 60_000) return;
    lastGc = now;
    for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const rule = rules.find((r) => req.path.startsWith(r.prefix));
    if (!rule) return next();
    const now = Date.now();
    gc(now);
    const key = `${rule.prefix}|${clientIp(req)}`;
    let w = windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + rule.windowMs };
      windows.set(key, w);
    }
    w.count += 1;
    res.setHeader("x-ratelimit-limit", String(rule.limit));
    res.setHeader("x-ratelimit-remaining", String(Math.max(0, rule.limit - w.count)));
    if (w.count > rule.limit) {
      res.setHeader("retry-after", String(Math.ceil((w.resetAt - now) / 1000)));
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Demasiadas solicitudes, intenta de nuevo en un momento",
          retryable: true,
        },
      });
      return;
    }
    next();
  };
}
