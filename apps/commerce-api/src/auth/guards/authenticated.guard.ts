import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { SessionService } from "../session.service.js";
import { RequestContext } from "../../common/context/request-context.js";
import { REFRESH_COOKIE } from "./principal.guard.js";

@Injectable()
export class AuthenticatedGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(host: ExecutionContext): Promise<boolean> {
    const req = host.switchToHttp().getRequest<Request>();
    const cookies = (req.cookies ?? {}) as Record<string, string>;
    // El guard verifica el REFRESH (lo único que vive en cookie). El access
    // ya lo validó `PrincipalGuard` en el camino normal del frontend.
    const token = cookies[REFRESH_COOKIE];
    const session = await this.sessions.resolveSession(token);
    if (!session) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Sesión inválida o expirada",
      });
    }
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
}