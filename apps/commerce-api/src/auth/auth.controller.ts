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
import { Public } from "./guards/principal.guard.js";
import { InviteService } from "./invite.service.js";

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
  async bootstrapTenant(
    @Body() body: {
      tenantName: string;
      ownerEmail: string;
      ownerFullName: string;
      ownerPassword: string;
      timezone: string;
    },
  ) {
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
    @Body() body: { email: string; password: string; tenantSlug?: string },
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
    @Body() body: { challengeToken: string; code: string },
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
  async confirmMfa(@Body() body: { code: string }) {
    const userId = RequestContext.userId;
    if (!userId) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Sesión requerida" });
    }
    await this.auth.confirmMfaEnrollment(userId, body.code);
    return { data: { ok: true }, requestId: RequestContext.requestId };
  }

  @Get("me")
  async me() {
    const userId = RequestContext.userId;
    if (!userId) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Sesión requerida" });
    }
    return { data: await this.auth.me(userId, RequestContext.tenantId), requestId: RequestContext.requestId };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    await this.auth.logout(token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  @Public()
  @Post("forgot-password")
  @HttpCode(200)
  async forgot(@Body() body: { email: string }) {
    const result = await this.invite.requestPasswordReset(body.email);
    // Respuesta uniforme; en producción no devolver el token (enviarlo por email).
    return { data: { ok: true, ...(result.token ? { token: result.token } : {}) }, requestId: RequestContext.requestId };
  }

  @Public()
  @Post("reset-password")
  @HttpCode(200)
  async reset(@Body() body: { token: string; newPassword: string }) {
    await this.invite.resetPassword(body);
    return { data: { ok: true }, requestId: RequestContext.requestId };
  }

  @Public()
  @Post("accept-invite")
  @HttpCode(200)
  async acceptInvite(@Body() body: { token: string; password: string }) {
    const result = await this.invite.acceptInvite(body);
    return { data: result, requestId: RequestContext.requestId };
  }
}