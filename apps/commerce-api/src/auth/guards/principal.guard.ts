/**
 * Guard global: API key (Bearer) o sesión cookie. Ver docs/03-iam.md T-IAM-05.
 *
 * Acepta @Public() para rutas sin autenticación (login, bootstrap, etc).
 *
 * Si la sesión es de un super-admin y llega la cookie `impersonate=<slug>`,
 * el tenant y el rol del principal se **sustituyen** por los del tenant
 * impersonado (rol OWNER). Eso permite al super-admin operar el portal del
 * tenant exactamente igual que su dueño. Ver docs/03-iam.md T-IAM-09.
 */
import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { Reflector } from "@nestjs/core";
import { SessionService } from "../session.service.js";
import { ApiKeyService } from "../api-key.service.js";
import { AccessTokenService } from "../jwt.service.js";
import { RequestContext } from "../../common/context/request-context.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Scope } from "../policies.js";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const IMPERSONATE_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-impersonate" : "impersonate";

/**
 * Nombre del cookie con el refresh token opaco. El access JWT NO viaja en
 * cookie, va en `Authorization: Bearer`. Ver `auth.controller.ts` para la
 * definición simétrica del lado del response.
 */
export const REFRESH_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-refresh" : "refresh";

/**
 * Atributos con los que se emiten las cookies de sesión e impersonación. Hay
 * que repetirlos EXACTOS al borrarlas: en producción los nombres llevan el
 * prefijo `__Host-`, y el navegador descarta cualquier Set-Cookie de una
 * cookie `__Host-` que no venga con Secure y Path=/ (y sin Domain).
 *
 * `res.clearCookie(nombre, { path: "/" })` a secas emitía el borrado SIN
 * Secure, así que en producción el navegador lo ignoraba y la cookie seguía
 * viva: "salir de la impersonación" devolvía 200 pero el super-admin se
 * quedaba dentro del tenant hasta que expiraban las 2h.
 */
export const COOKIE_ATTRS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AGENT_SERVICE_SCOPES: ReadonlyArray<Scope> = [
  "catalog.read",
  "customers.read",
  "customers.write",
  "quotes.read",
  "quotes.write",
  "orders.read",
  "orders.write",
  "chat.read",
  "chat.write",
];

const AGENT_SIGNATURE_MAX_AGE_MS = 60_000;

export function resolveAgentServicePrincipal(
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  nowMs = Date.now(),
) {
  const tenantId = typeof headers["x-agent-tenant"] === "string" ? headers["x-agent-tenant"].trim() : "";
  const timestamp = typeof headers["x-agent-timestamp"] === "string" ? headers["x-agent-timestamp"] : "";
  const signature = typeof headers["x-agent-signature"] === "string" ? headers["x-agent-signature"] : "";
  if (!secret || !tenantId || !timestamp || !signature) return null;

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > AGENT_SIGNATURE_MAX_AGE_MS) {
    return null;
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${tenantId}`).digest("hex");
  const actualBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    return null;
  }
  return {
    type: "SERVICE" as const,
    tenantId,
    scopes: [...AGENT_SERVICE_SCOPES],
  };
}

@Injectable()
export class PrincipalGuard implements CanActivate {
  private readonly logger = new Logger(PrincipalGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly apiKeys: ApiKeyService,
    private readonly accessTokens: AccessTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(host: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      host.getHandler(),
      host.getClass(),
    ]);
    if (isPublic) return true;

    const req = host.switchToHttp().getRequest<Request>();
    const cookies = (req.cookies ?? {}) as Record<string, string>;

    // 1) Aserción interna firmada del agente multi-tenant. El tenant queda
    // ligado criptográficamente a esta petición y caduca en 60 segundos.
    const hasAgentAssertion = Boolean(
      req.headers["x-agent-tenant"] ||
      req.headers["x-agent-timestamp"] ||
      req.headers["x-agent-signature"],
    );
    if (hasAgentAssertion) {
      const secret = process.env.AGENT_INTERNAL_KEY_REF ?? process.env.AGENT_INTERNAL_KEY ?? "";
      const principal = resolveAgentServicePrincipal(req.headers, secret);
      if (!principal) {
        throw new UnauthorizedException({
          code: "UNAUTHORIZED",
          message: "Aserción interna del agente inválida o expirada",
        });
      }
      RequestContext.setPrincipal(principal);
      return true;
    }

    // 2) Authorization: Bearer. Acepta JWT de access (camino normal del
    // frontend) y API keys (`npk_...`). El JWT se valida con la firma
    // primero (sin BD); después se confirma que la sesión siga viva
    // (`resolveByAccessToken`).
    const auth = req.headers["authorization"] as string | undefined;
    if (auth?.startsWith("Bearer ")) {
      const tokenRaw = auth.slice("Bearer ".length);

      if (tokenRaw.startsWith("npk_")) {
        return this.handleApiKey(req, tokenRaw);
      }

      // Access JWT
      let claims;
      try {
        claims = await this.accessTokens.verify(tokenRaw);
      } catch {
        throw new UnauthorizedException({
          code: "UNAUTHORIZED",
          message: "Access token inválido o expirado",
        });
      }

      const session = await this.sessions.resolveByAccessToken({
        sessionId: claims.sid,
        jti: claims.jti,
      });
      if (!session) {
        // Firma OK pero sesión revocada / expirada / jti viejo / membresía
        // caída: el frontend debe disparar /auth/refresh. El 401 lo hace el
        // interceptor (lib/api.ts) — desde el guard respondemos 401 normal.
        throw new UnauthorizedException({
          code: "UNAUTHORIZED",
          message: "Sesión inválida o expirada",
        });
      }

      return this.applySessionToContext(req, session, cookies);
    }

    // 3) Sin Bearer → fallback al refresh cookie. Útil para SSR (route
    // handlers del frontend Next.js que reenvían la cookie automáticamente)
    // y para clientes sin header (legacy). El backend valida igual contra la
    // BD; un refresh robado no se queda vivo tras un logout/rotación.
    const refreshToken = cookies[REFRESH_COOKIE];
    const session = await this.sessions.resolveSession(refreshToken);
    if (session) {
      return this.applySessionToContext(req, session, cookies);
    }

    throw new UnauthorizedException({
      code: "UNAUTHORIZED",
      message: "Autenticación requerida",
    });
  }

  private async handleApiKey(req: Request, tokenRaw: string): Promise<boolean> {
    const principal = await this.apiKeys.resolve(tokenRaw);
    if (!principal) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "API key inválida o revocada",
      });
    }

    let tenantId = principal.tenantId ?? undefined;
    if (principal.isGlobal) {
      const headerTenant = req.headers["x-tenant-id"];
      const raw = Array.isArray(headerTenant) ? headerTenant[0] : headerTenant;
      if (raw) {
        if (!UUID_RE.test(raw)) {
          throw new BadRequestException({
            code: "VALIDATION_FAILED",
            message: "X-Tenant-Id debe ser un UUID",
          });
        }
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: raw },
          select: { status: true },
        });
        if (!tenant || tenant.status !== "ACTIVE") {
          throw new BadRequestException({
            code: "VALIDATION_FAILED",
            message: "X-Tenant-Id no corresponde a un tenant activo",
          });
        }
        tenantId = raw;
      }
    }

    RequestContext.setPrincipal({
      type: "API_KEY",
      tenantId,
      scopes: [...principal.scopes],
      apiKeyId: principal.apiKeyId,
      isSuperAdmin: principal.isGlobal,
    });
    return true;
  }

  private async applySessionToContext(
    _req: Request,
    session: {
      sessionId: string;
      userId: string;
      tenantId: string;
      role: string;
      isSuperAdmin: boolean;
    },
    cookies: Record<string, string>,
  ): Promise<boolean> {
    let impersonatedTenantId: string | undefined;
    let impersonatedRole: string | undefined;
    const impersonateSlug = cookies[IMPERSONATE_COOKIE];
    if (session.isSuperAdmin && impersonateSlug) {
      const target = await this.prisma.tenant.findUnique({
        where: { slug: impersonateSlug },
        select: { id: true, status: true },
      });
      if (target && target.status === "ACTIVE") {
        impersonatedTenantId = target.id;
        impersonatedRole = "OWNER";
      } else {
        this.logger.warn(
          `Impersonate cookie apunta a slug=${impersonateSlug} sin tenant ACTIVE; ignorando`,
        );
      }
    }

    RequestContext.setPrincipal({
      type: "USER",
      userId: session.userId,
      tenantId: impersonatedTenantId ?? session.tenantId,
      role: impersonatedRole ?? session.role,
      sessionId: session.sessionId,
      isSuperAdmin: session.isSuperAdmin,
      impersonated: Boolean(impersonatedTenantId),
      impersonatorUserId: impersonatedTenantId ? session.userId : undefined,
    });
    await this.sessions.touchActivity(session.sessionId);
    return true;
  }
}
