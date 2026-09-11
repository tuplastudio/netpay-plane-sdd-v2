import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RequestContext } from "../../common/context/request-context.js";
import { Scope, effectiveScopesOf } from "../policies.js";
import { IS_PUBLIC_KEY } from "./principal.guard.js";

export const SCOPES_KEY = "required:scopes";
export const NO_SCOPE_KEY = "required:no-scope";

/**
 * Decorador para exigir scopes. Uso: `@RequireScopes('catalog.write')`.
 *
 * Se declara con `SetMetadata` (y no con `Reflect.defineMetadata` a mano) para
 * que funcione igual sobre un método y sobre una clase: puesto en el
 * controlador, el scope aplica a todas sus rutas y el guard lo ve vía
 * `getAllAndMerge`.
 */
export const RequireScopes = (...scopes: Scope[]) => SetMetadata(SCOPES_KEY, scopes);

/**
 * Marca explícita de "esta ruta no pide ningún scope, basta con estar
 * autenticado". Es la única forma de pasar el `RoleGuard` sin `@RequireScopes`
 * ni `@Public`: la ausencia de decorador ya no autoriza (ver abajo).
 */
export const NoScopeRequired = () => SetMetadata(NO_SCOPE_KEY, true);

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(host: ExecutionContext): boolean {
    const targets = [host.getHandler(), host.getClass()];

    // Ruta pública declarada: no hay principal que evaluar. El PrincipalGuard
    // global ya la dejó pasar sin autenticar.
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    // `getAllAndMerge` une controlador + handler: un `@RequireScopes` a nivel
    // de clase se exige en TODAS sus rutas y el del método suma. Antes se leía
    // solo el handler y el decorador de clase se ignoraba en silencio.
    const requiredScopes = this.reflector.getAllAndMerge<Scope[]>(SCOPES_KEY, targets) ?? [];

    if (requiredScopes.length === 0) {
      // Fail-closed. Antes esto devolvía `true`: cualquier ruta a la que se le
      // olvidara el `@RequireScopes` quedaba abierta a cualquier principal
      // autenticado —incluida una API key de un servicio con scopes mínimos—
      // y el olvido no se notaba nunca porque la ruta simplemente funcionaba.
      // Ahora hay que decirlo a propósito: `@Public()` o `@NoScopeRequired()`.
      if (this.reflector.getAllAndOverride<boolean>(NO_SCOPE_KEY, targets)) {
        return true;
      }
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Ruta sin política de acceso declarada",
      });
    }

    const principal = RequestContext.principal;

    if (principal.type === "ANONYMOUS") {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Autenticación de usuario requerida",
      });
    }

    // Principales no-humanos: valen los scopes de la credencial/API o de la
    // aserción interna firmada del agente. Los humanos, los de su rol.
    const effective = effectiveScopesOf(principal);
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
