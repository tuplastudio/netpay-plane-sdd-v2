/**
 * Guard para /super-admin: solo usuarios con `User.isSuperAdmin = true`.
 * Cross-tenant a propósito — nunca acepta principal tipo API_KEY (esas están
 * siempre atadas a un único tenant) ni un usuario sin el flag.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(_host: ExecutionContext): boolean {
    const principal = RequestContext.principal;
    if (principal.type !== "USER" || !principal.isSuperAdmin) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Requiere permisos de super-admin",
      });
    }
    return true;
  }
}
