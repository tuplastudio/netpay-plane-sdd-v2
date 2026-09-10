/**
 * Endpoints de plataforma que no cuelgan de una empresa concreta:
 * resumen global y directorio de usuarios. Los de /super-admin/tenants/* viven
 * en tenants.controller.ts (SuperAdminTenantsController).
 *
 * Impersonación: el super-admin puede "entrar como" un tenant concreto
 * fijando la cookie `impersonate=<slug>`. El `PrincipalGuard` la aplica
 * en cada petición y sustituye tenantId+rol del principal.
 */
import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Request, Response } from "express";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard.js";
import { IMPERSONATE_COOKIE } from "../auth/guards/principal.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SuperAdminService } from "./super-admin.service.js";

@Controller("super-admin")
@UseGuards(SuperAdminGuard)
export class SuperAdminController {
  constructor(
    private readonly superAdmin: SuperAdminService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("overview")
  async overview() {
    const data = await this.superAdmin.overview();
    return { data, requestId: RequestContext.requestId };
  }

  @Get("users")
  async users(@Query("q") q?: string) {
    const data = await this.superAdmin.listUsers(q);
    return { data, requestId: RequestContext.requestId };
  }

  /**
   * Inicia la impersonación del tenant indicado: valida que esté ACTIVE y
   * fija la cookie `impersonate=<slug>`. Las siguientes peticiones del
   * navegador se resuelven con ese tenant como contexto activo.
   *
   * Solo accesible a super-admin (guard a nivel de controlador).
   */
  @Post("tenants/:id/impersonate")
  async impersonate(
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, slug: true, name: true, status: true },
    });
    if (!tenant) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Empresa no encontrada" });
    }
    if (tenant.status !== "ACTIVE") {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: `No se puede impersonar una empresa ${tenant.status}`,
      });
    }
    res.cookie(IMPERSONATE_COOKIE, tenant.slug, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      // 2h. Más corto que la sesión (12h) para que el olvido no abra
      // ventanas de impersonación eternas tras un descuido del super-admin.
      maxAge: 2 * 60 * 60 * 1000,
    });
    return {
      data: { slug: tenant.slug, name: tenant.name },
      requestId: RequestContext.requestId,
    };
  }

  /**
   * Termina la impersonación: borra la cookie. Las siguientes peticiones
   * vuelven al modo super-admin normal (sin tenant activo).
   */
  @Delete("impersonate")
  async stopImpersonating(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(IMPERSONATE_COOKIE, { path: "/" });
    return { data: { ok: true }, requestId: RequestContext.requestId };
  }

  /**
   * Devuelve el slug del tenant impersonado actualmente (o null). El
   * frontend lo usa para mostrar el banner y colorear el selector.
   */
  @Get("impersonate")
  async currentImpersonation(@Req() req: Request) {
    const slug = (req.cookies as Record<string, string> | undefined)?.[IMPERSONATE_COOKIE];
    if (!slug) return { data: null, requestId: RequestContext.requestId };
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true },
    });
    return { data: tenant, requestId: RequestContext.requestId };
  }
}
