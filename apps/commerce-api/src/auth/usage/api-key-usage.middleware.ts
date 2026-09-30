/**
 * Registra en la bitácora cada petición autenticada con una API key.
 *
 * Es middleware (no interceptor) a propósito: los interceptores de Nest solo
 * corren si los guards dejan pasar, y un 403 por scope faltante es justo lo
 * que un admin quiere ver en la bitácora de su key. Aquí se engancha
 * `res.on("finish")`, que dispara con cualquier status, incluido el que
 * escribe el filtro global de excepciones.
 *
 * El principal todavía no existe cuando corre el middleware (lo fija
 * `PrincipalGuard` después): se lee al terminar la respuesta. `AsyncResource.
 * bind` conserva el contexto de `RequestContext` hasta ese momento; el store
 * es el mismo objeto que el guard muta, así que ahí ya trae la key.
 */
import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AsyncResource } from "node:async_hooks";
import { RequestContext } from "../../common/context/request-context.js";
import { ApiKeyUsageService } from "./api-key-usage.service.js";
import { errorCodeForStatus, normalizeApiPath, truncateUserAgent } from "./api-key-usage.path.js";

@Injectable()
export class ApiKeyUsageMiddleware implements NestMiddleware {
  constructor(private readonly usage: ApiKeyUsageService) {}

  use = (req: Request, res: Response, next: NextFunction): void => {
    // Sin Bearer de API key no hay nada que registrar: ni siquiera se
    // engancha el listener (las sesiones cookie son la mayoría del tráfico).
    const auth = req.headers["authorization"];
    if (typeof auth !== "string" || !auth.startsWith("Bearer npk_")) {
      next();
      return;
    }
    const startedAt = process.hrtime.bigint();
    const occurredAt = new Date();
    res.once(
      "finish",
      AsyncResource.bind(() => {
        const principal = RequestContext.principal;
        if (principal.type !== "API_KEY" || !principal.apiKeyId) return;
        const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
        this.usage.record({
          tenantId: principal.tenantId ?? null,
          apiKeyId: principal.apiKeyId,
          occurredAt,
          method: req.method,
          path: normalizeApiPath(req.originalUrl ?? req.url ?? "/"),
          statusCode: res.statusCode,
          durationMs,
          ip: req.ip ?? null,
          userAgent: truncateUserAgent(req.headers["user-agent"]),
          scopeUsed: RequestContext.requiredScopes[0] ?? null,
          errorCode: errorCodeForStatus(res.statusCode),
        });
      }),
    );
    next();
  };
}
