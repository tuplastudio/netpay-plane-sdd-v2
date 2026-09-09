/**
 * Security middleware. Ver docs/15-ops.md T-OPS-01.
 *
 *  - CSP estricta (sin scripts inline; usamos nonces vía Next.js).
 *  - HSTS, X-Frame-Options, X-Content-Type-Options ya via helmet.
 *  - Body size limit (1 MB JSON, 10 MB upload).
 *  - Rate limit por IP/email/token en endpoints sensibles.
 */

import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SecurityHeadersMiddleware.name);

  use = (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    if (process.env.PAYMENT_PROVIDER !== "DUMMY") {
      this.logger.error(
        `PAYMENT_PROVIDER inválido: ${process.env.PAYMENT_PROVIDER}. Solo DUMMY permitido (ADR-005).`,
      );
    }
    next();
  };
}

/**
 * Rate limit simple en memoria. Para producción, sustituir por Redis.
 * Ver docs/15-ops.md T-OPS-01.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private buckets = new Map<string, Bucket>();
  private readonly WINDOW_MS = 60_000;
  private readonly MAX = 120;

  use = (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip}|${req.path}`;
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.WINDOW_MS });
      return next();
    }
    b.count += 1;
    res.setHeader("X-RateLimit-Limit", String(this.MAX));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, this.MAX - b.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(b.resetAt / 1000)));
    if (b.count > this.MAX) {
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Demasiadas solicitudes",
          retryable: true,
          traceId: req.headers["x-request-id"] ?? "",
        },
        requestId: req.headers["x-request-id"] ?? "",
      });
      return;
    }
    next();
  };
}

/**
 * Valida la configuración al arranque. Ver docs/15-ops.md T-OPS-01.
 * Falla rápido si hay secretos faltantes o PAYMENT_PROVIDER != DUMMY.
 */
export function validateStartupConfig(): void {
  const logger = new Logger("StartupValidation");
  const errors: string[] = [];

  if (process.env.PAYMENT_PROVIDER !== "DUMMY") {
    errors.push(
      `PAYMENT_PROVIDER debe ser DUMMY. Recibido: ${process.env.PAYMENT_PROVIDER ?? "(no definido)"}.`,
    );
  }
  if (!process.env.DATABASE_URL) errors.push("DATABASE_URL requerido");
  if (!process.env.SESSION_SECRET_REF || process.env.SESSION_SECRET_REF.length < 32) {
    errors.push("SESSION_SECRET_REF debe tener >=32 chars");
  }
  if (!process.env.TOKEN_ENCRYPTION_KEY_REF || process.env.TOKEN_ENCRYPTION_KEY_REF.length < 32) {
    errors.push("TOKEN_ENCRYPTION_KEY_REF debe tener >=32 chars");
  }

  if (errors.length > 0) {
    logger.error("Configuración inválida:");
    for (const e of errors) logger.error(`  - ${e}`);
    throw new Error("Startup validation failed: ver logs");
  }
  logger.log("Config validation OK (PAYMENT_PROVIDER=DUMMY)");
}