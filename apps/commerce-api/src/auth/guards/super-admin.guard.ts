/**
 * Guard para /super-admin: usuarios con `User.isSuperAdmin = true`, o una API
 * key GLOBAL (T-IAM-09b: `ApiKey.tenantId IS NULL`, ver `ApiKeyService.createGlobal`
 * y `PrincipalGuard`) — esa sí es intencionalmente cross-tenant. Una key de
 * tenant normal nunca pasa esto: `PrincipalGuard` solo pone `isSuperAdmin` en
 * el principal cuando la key resolvió como global.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(_host: ExecutionContext): boolean {
    const principal = RequestContext.principal;
    const allowed =
      (principal.type === "USER" || principal.type === "API_KEY") && principal.isSuperAdmin === true;
    if (!allowed) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Requiere permisos de super-admin",
      });
    }
    return true;
  }
}
