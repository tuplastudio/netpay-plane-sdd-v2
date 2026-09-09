import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RequestContext } from "../../common/context/request-context.js";
import { Scope, scopesFor } from "../policies.js";

export const SCOPES_KEY = "required:scopes";

/** Decorador para exigir scopes. Uso: @RequireScopes('catalog.write'). */
export const RequireScopes =
  (...scopes: Scope[]) =>
  (target: object, _key?: string | symbol, descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata(SCOPES_KEY, scopes, descriptor?.value ?? target);
    return descriptor ?? target;
  };

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(host: ExecutionContext): boolean {
    const requiredScopes =
      this.reflector.get<Scope[]>(SCOPES_KEY, host.getHandler()) ?? [];

    if (requiredScopes.length === 0) return true;

    const principal = RequestContext.principal;

    // Principal tipo API key: validar contra scopes del API key.
    if (principal.type === "API_KEY") {
      const have = new Set(principal.scopes ?? []);
      const missing = requiredScopes.filter((s) => !have.has(s));
      if (missing.length > 0) {
        throw new ForbiddenException({
          code: "FORBIDDEN",
          message: `Faltan scopes: ${missing.join(", ")}`,
        });
      }
      return true;
    }

    if (principal.type !== "USER") {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Autenticación de usuario requerida",
      });
    }

    const role = (principal.role ?? "VIEWER") as string;
    const effective = new Set(scopesFor(role));
    const missing = requiredScopes.filter((s) => !effective.has(s));
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: `Faltan scopes: ${missing.join(", ")}`,
      });
    }

    return true;
  }
}