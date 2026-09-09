/**
 * Guard global: API key (Bearer) o sesión cookie. Ver docs/03-iam.md T-IAM-05.
 *
 * Acepta @Public() para rutas sin autenticación (login, bootstrap, etc).
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { Reflector } from "@nestjs/core";
import { SessionService } from "../session.service.js";
import { ApiKeyService } from "../api-key.service.js";
import { RequestContext } from "../../common/context/request-context.js";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class PrincipalGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly apiKeys: ApiKeyService,
  ) {}

  async canActivate(host: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      host.getHandler(),
      host.getClass(),
    ]);
    if (isPublic) return true;

    const req = host.switchToHttp().getRequest<Request>();
    const cookies = (req.cookies ?? {}) as Record<string, string>;
    const cookieName =
      process.env.NODE_ENV === "production" ? "__Host-session" : "session";

    // 1) API key (Bearer) tiene prioridad sobre cookie.
    const auth = req.headers["authorization"] as string | undefined;
    if (auth?.startsWith("Bearer npk_")) {
      const principal = await this.apiKeys.resolve(auth.slice("Bearer ".length));
      if (!principal) {
        throw new UnauthorizedException({
          code: "UNAUTHORIZED",
          message: "API key inválida o revocada",
        });
      }
      RequestContext.setPrincipal({
        type: "API_KEY",
        tenantId: principal.tenantId,
        scopes: [...principal.scopes],
        apiKeyId: principal.apiKeyId,
      });
      return true;
    }

    // 2) Sesión cookie.
    const token = cookies[cookieName];
    const session = await this.sessions.resolveSession(token);
    if (session) {
      RequestContext.setPrincipal({
        type: "USER",
        userId: session.userId,
        tenantId: session.tenantId,
        role: session.role,
        sessionId: session.sessionId,
      });
      await this.sessions.touchActivity(session.sessionId);
      return true;
    }

    throw new UnauthorizedException({
      code: "UNAUTHORIZED",
      message: "Autenticación requerida",
    });
  }
}