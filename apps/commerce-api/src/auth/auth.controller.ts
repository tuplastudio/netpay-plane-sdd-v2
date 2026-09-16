import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { BootstrapService } from "./bootstrap.service.js";
import { RequestContext } from "../common/context/request-context.js";
import { COOKIE_ATTRS, IMPERSONATE_COOKIE, Public } from "./guards/principal.guard.js";
import { InviteService } from "./invite.service.js";
import {
  AcceptInviteDto,
  BootstrapTenantDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  MfaCodeDto,
  ResetPasswordDto,
  SwitchTenantDto,
  VerifyMfaDto,
} from "./auth.dto.js";

const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-session" : "session";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly bootstrap: BootstrapService,
    private readonly invite: InviteService,
  ) {}

  @Public()
  @Post("bootstrap")
  async bootstrapTenant(@Body() body: BootstrapTenantDto) {
    const result = await this.bootstrap.run(body);
    return {
      data: {
        tenantId: result.tenantId,
        ownerUserId: result.ownerUserId,
        invitationToken: result.invitationToken,
        configVersion: result.configVersion,
      },
      requestId: RequestContext.requestId,
    };
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login({
      email: body.email,
      password: body.password,
      tenantSlug: body.tenantSlug,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    if ("sessionToken" in result) {
      res.cookie(SESSION_COOKIE, result.sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        expires: new Date(result.expiresAt),
      });
      RequestContext.setPrincipal({
        type: "USER",
        userId: result.userId,
        tenantId: result.tenantId,
        role: result.role,
      });
    }

    return {
      data: result,
      requestId: RequestContext.requestId,
    };
  }

  /** Segundo paso de login cuando el usuario tiene MFA activado. */
  @Public()
  @Post("mfa/verify")
  @HttpCode(200)
  async verifyMfa(
    @Body() body: VerifyMfaDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.completeMfa({
      challengeToken: body.challengeToken,
      code: body.code,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.cookie(SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(result.expiresAt),
    });
    RequestContext.setPrincipal({
      type: "USER",
      userId: result.userId,
      tenantId: result.tenantId,
      role: result.role,
    });

    return { data: result, requestId: RequestContext.requestId };
  }

  /** Enrolamiento MFA: requiere sesión ya iniciada (sin MFA aún). */
  @Post("mfa/enroll")
  @HttpCode(200)
  async enrollMfa() {
    const userId = RequestContext.userId;
    if (!userId) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Sesión requerida" });
    }
    const enrollment = await this.auth.enrollMfa(userId);
    return { data: enrollment, requestId: RequestContext.requestId };
  }

  @Post("mfa/enroll/confirm")
  @HttpCode(200)
  async confirmMfa(@Body() body: MfaCodeDto) {
    const userId = RequestContext.userId;
    if (!userId) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Sesión requerida" });
    }
    await this.auth.confirmMfaEnrollment(userId, body.code);
    return { data: { ok: true }, requestId: RequestContext.requestId };
  }

  /** Apaga MFA en la cuenta propia; exige un código TOTP o recovery code vigente. */
  @Post("mfa/disable")
  @HttpCode(200)
  async disableMfa(@Body() body: MfaCodeDto) {
    const userId = RequestContext.userId;
    if (!userId) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Sesión requerida" });
    }
    await this.auth.disableMfa(userId, body.code, RequestContext.tenantId ?? null);
    return { data: { ok: true }, requestId: RequestContext.requestId };
  }

  /** Reemplaza los recovery codes vigentes; exige un código TOTP vigente. */
  @Post("mfa/recovery-codes/regenerate")
  @HttpCode(200)
  async regenerateRecoveryCodes(@Body() body: MfaCodeDto) {
    const userId = RequestContext.userId;
    if (!userId) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Sesión requerida" });
    }
    const recoveryCodes = await this.auth.regenerateRecoveryCodes(userId, body.code, RequestContext.tenantId ?? null);
    return { data: { recoveryCodes }, requestId: RequestContext.requestId };
  }

  @Get("me")
  async me() {
    const userId = RequestContext.userId;
    if (!userId) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Sesión requerida" });
    }
    return { data: await this.auth.me(userId, RequestContext.tenantId), requestId: RequestContext.requestId };
  }

  /**
   * Cambia la empresa activa de la sesión (usuario con varias membresías).
   * Valida membresía ACTIVE en el tenant destino, mueve `Session.tenantId` y
   * lo audita como `auth.tenant_switched`. Desde la siguiente petición el
   * `PrincipalGuard` resuelve tenant y rol desde esa membresía.
   *
   * Si un super-admin estaba impersonando, la cookie se borra: eligió
   * explícitamente una de **sus** empresas, y la impersonación (que tiene
   * precedencia en el guard) taparía el cambio.
   */
  @Post("switch-tenant")
  @HttpCode(200)
  async switchTenant(
    @Body() body: SwitchTenantDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId, sessionId } = RequestContext.principal;
    if (!userId || !sessionId) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Sesión requerida" });
    }
    const result = await this.auth.switchTenant({ userId, sessionId, tenantId: body.tenantId });
    res.clearCookie(IMPERSONATE_COOKIE, COOKIE_ATTRS);
    return { data: result, requestId: RequestContext.requestId };
  }

  /**
   * Refresca la sesión: extiende el TTL de la cookie sin pedir credenciales.
   *
   * Es `@Public()` a propósito. Si pasara por el `PrincipalGuard`, una sesión
   * expirada recibiría 401 del guard antes de llegar aquí y el refresh nunca
   * podría hacer nada. La validación completa (token, revocación, expiración,
   * inactividad de 30 min y membresía ACTIVE) la hace `refreshSession` con
   * las mismas reglas que el guard.
   *
   * El frontend lo llama automáticamente cuando recibe un 401 de cualquier
   * API (interceptor de `lib/api.ts`): si el refresh succeede, reintenta la
   * petición original; si falla, redirige a /login. Un 401 aquí significa
   * "vuelve a iniciar sesión".
   */
  @Public()
  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    const result = token ? await this.auth.sessions.refreshSession(token) : null;

    if (!result || !token) {
      res.clearCookie(SESSION_COOKIE, COOKIE_ATTRS);
      throw new UnauthorizedException({
        code: "SESSION_EXPIRED",
        message: "Sesión expirada o inactividad prolongada. Inicia sesión de nuevo.",
      });
    }

    res.cookie(SESSION_COOKIE, token, {
      ...COOKIE_ATTRS,
      expires: result.expiresAt,
    });

    return {
      data: { ok: true, expiresAt: result.expiresAt.toISOString() },
      requestId: RequestContext.requestId,
    };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    await this.auth.logout(token);
    res.clearCookie(SESSION_COOKIE, COOKIE_ATTRS);
    // La cookie de impersonación no tiene estado en servidor: si no se borra
    // aquí sobrevive al logout, y al volver a entrar desde el mismo navegador
    // el super-admin reaparecía dentro del tenant que estaba impersonando sin
    // haberlo pedido.
    res.clearCookie(IMPERSONATE_COOKIE, COOKIE_ATTRS);
  }

  @Public()
  @Post("forgot-password")
  @HttpCode(200)
  async forgot(@Body() body: ForgotPasswordDto) {
    const result = await this.invite.requestPasswordReset(body.email);
    // Respuesta uniforme. El token solo viaja en la respuesta cuando NO
    // estamos en producción: en prod se manda por correo y el frontend nunca
    // debe verlo. `result.throttled` se ignora a propósito para no filtrar
    // estado del throttle al atacante.
    const includeToken = process.env.NODE_ENV !== "production" && !!result.token;
    return {
      data: { ok: true, ...(includeToken ? { token: result.token } : {}) },
      requestId: RequestContext.requestId,
    };
  }

  @Public()
  @Post("reset-password")
  @HttpCode(200)
  async reset(@Body() body: ResetPasswordDto) {
    await this.invite.resetPassword(body);
    return { data: { ok: true }, requestId: RequestContext.requestId };
  }

  @Public()
  @Post("accept-invite")
  @HttpCode(200)
  async acceptInvite(@Body() body: AcceptInviteDto) {
    const result = await this.invite.acceptInvite(body);
    return { data: result, requestId: RequestContext.requestId };
  }

  /**
   * Cambio de contraseña estando autenticado: requiere la contraseña actual.
   * Si la operación tiene éxito, **revoca todas las sesiones** del usuario
   * para que un atacante que ya tuviera una sesión abierta no pueda seguir
   * usándola. La actual la está usando esta misma petición y la respuesta
   * se sigue mandando, pero a partir del siguiente refresh ya no cuenta.
   */
  @Post("change-password")
  @HttpCode(200)
  async changePassword(@Body() body: ChangePasswordDto) {
    const userId = RequestContext.userId;
    if (!userId) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Sesión requerida" });
    }
    await this.invite.changePassword({
      userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    return { data: { ok: true }, requestId: RequestContext.requestId };
  }
}