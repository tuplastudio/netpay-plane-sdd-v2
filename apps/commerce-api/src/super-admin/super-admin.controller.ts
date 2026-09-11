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
import { COOKIE_ATTRS, IMPERSONATE_COOKIE } from "../auth/guards/principal.guard.js";
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
    // Traza en la auditoría DEL TENANT: es ahí donde su dueño puede ver que
    // alguien de plataforma entró como él. Sin esta fila, la impersonación no
    // dejaba rastro alguno.
    await this.writeImpersonationAudit("superadmin.impersonation_started", tenant);
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
  async stopImpersonating(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Mismos atributos que al emitirla (ver COOKIE_ATTRS): sin Secure el
    // navegador descarta el borrado de una cookie `__Host-` en producción.
    const slug = (req.cookies as Record<string, string> | undefined)?.[IMPERSONATE_COOKIE];
    res.clearCookie(IMPERSONATE_COOKIE, COOKIE_ATTRS);

    // Cierra el par de la traza: la fila `_started` sin su `_stopped` deja
    // abierta la ventana en la que hay que revisar qué se hizo. Si la cookie
    // apuntaba a un slug que ya no existe no hay tenantId al que colgar la
    // fila (AuditLog.tenantId es obligatorio) y se omite en silencio: no había
    // impersonación efectiva que cerrar.
    if (slug) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { slug },
        select: { id: true, slug: true },
      });
      if (tenant) {
        await this.writeImpersonationAudit("superadmin.impersonation_stopped", tenant);
      }
    }
    return { data: { ok: true }, requestId: RequestContext.requestId };
  }

  /**
   * Fila de auditoría de inicio/fin de impersonación. Va al tenant impersonado
   * y el actor es el super-admin real (en estos dos endpoints el principal
   * todavía no está sustituido: el guard solo impersona cuando la cookie ya
   * venía en la petición, y `DELETE` la borra en la respuesta).
   */
  private async writeImpersonationAudit(
    action: "superadmin.impersonation_started" | "superadmin.impersonation_stopped",
    tenant: { id: string; slug: string },
  ): Promise<void> {
    const actorId = RequestContext.userId ?? null;
    await this.prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorId,
        action,
        targetType: "Tenant",
        targetId: tenant.id,
        metadata: {
          userId: actorId,
          impersonatorUserId: actorId,
          tenantSlug: tenant.slug,
        },
      },
    });
  }

  /**
   * Devuelve el slug del tenant impersonado actualmente (o null). El
   * frontend lo usa para mostrar el banner y colorear el selector.
   */
  @Get("impersonate")
  async currentImpersonation(@Req() req: Request) {
    const slug = (req.cookies as Record<string, string> | undefined)?.[IMPERSONATE_COOKIE];
    if (!slug) return { data: null, requestId: RequestContext.requestId };
    // Mismo criterio que PrincipalGuard, que solo impersona tenants ACTIVE:
    // sin el filtro, un tenant suspendido a media sesión seguía saliendo en el
    // banner ("estás dentro de ACME") mientras el guard ya había vuelto al
    // tenant propio del super-admin, y las escrituras caían en otro lado.
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug, status: "ACTIVE" },
      select: { id: true, slug: true, name: true },
    });
    return { data: tenant, requestId: RequestContext.requestId };
  }
}
