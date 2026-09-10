import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { RequestContext } from "../common/context/request-context.js";
import { ApiKeyService } from "../auth/api-key.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard.js";
import { SuperAdminService } from "../super-admin/super-admin.service.js";
import { SuperAdminMembershipService } from "../super-admin/super-admin-membership.service.js";
import {
  CreateTenantInvitationDto,
  UpdateTenantDto,
  UpdateTenantMembershipDto,
} from "../super-admin/super-admin.dto.js";
import { TenantProvisioningService } from "./tenant-provisioning.service.js";
import { TenantLogoService } from "./tenant-logo.service.js";
import { LogoUploadInterceptor } from "./logo-upload.interceptor.js";
import {
  CreateTenantApiKeyDto,
  CreateTenantDto,
  UpdateBrandingDto,
  UpdateTenantStatusDto,
} from "./tenants.dto.js";

/**
 * Administración cross-tenant de empresas y de su gente. Todo bajo
 * SuperAdminGuard; las lecturas agregadas y las mutaciones de membresía viven
 * en src/super-admin (ver SuperAdminService / SuperAdminMembershipService).
 */
@Controller("super-admin/tenants")
@UseGuards(SuperAdminGuard)
export class SuperAdminTenantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: TenantProvisioningService,
    private readonly superAdmin: SuperAdminService,
    private readonly people: SuperAdminMembershipService,
    private readonly apiKeys: ApiKeyService,
  ) {}

  @Get()
  async list() {
    const tenants = await this.superAdmin.listTenants();
    return { data: tenants, requestId: RequestContext.requestId };
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const tenant = await this.superAdmin.getTenant(id);
    return { data: tenant, requestId: RequestContext.requestId };
  }

  @Get(":id/usage")
  async usage(
    @Param("id") id: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const data = await this.superAdmin.usageForTenant(id, from, to);
    return { data, requestId: RequestContext.requestId };
  }

  @Post()
  async create(@Body() body: CreateTenantDto) {
    const result = await this.provisioning.createTenant(body);
    return { data: result, requestId: RequestContext.requestId };
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: UpdateTenantDto) {
    if (body.name === undefined) {
      // Con whitelist activo un body vacío llega aquí sin campos: nada que hacer.
      const tenant = await this.superAdmin.requireTenant(id);
      return { data: tenant, requestId: RequestContext.requestId };
    }
    const tenant = await this.superAdmin.renameTenant(id, RequestContext.userId, body.name);
    return { data: tenant, requestId: RequestContext.requestId };
  }

  @Patch(":id/status")
  async updateStatus(@Param("id") id: string, @Body() body: UpdateTenantStatusDto) {
    await this.superAdmin.requireTenant(id);
    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: { status: body.status, version: { increment: 1 } },
    });
    return { data: tenant, requestId: RequestContext.requestId };
  }

  // ---- Invitaciones ----

  @Post(":id/invitations")
  async invite(@Param("id") id: string, @Body() body: CreateTenantInvitationDto) {
    const data = await this.people.invite({
      tenantId: id,
      actor: { userId: RequestContext.userId },
      email: body.email,
      fullName: body.fullName,
      role: body.role,
    });
    return { data, requestId: RequestContext.requestId };
  }

  @Delete(":id/invitations/:invitationId")
  @HttpCode(204)
  async revokeInvitation(
    @Param("id") id: string,
    @Param("invitationId") invitationId: string,
  ): Promise<void> {
    await this.people.revokeInvitation({
      tenantId: id,
      actor: { userId: RequestContext.userId },
      invitationId,
    });
  }

  // ---- Membresías ----

  @Patch(":id/memberships/:membershipId")
  async updateMembership(
    @Param("id") id: string,
    @Param("membershipId") membershipId: string,
    @Body() body: UpdateTenantMembershipDto,
  ) {
    const data = await this.people.updateMembership({
      tenantId: id,
      actor: { userId: RequestContext.userId },
      membershipId,
      role: body.role,
      status: body.status,
    });
    return { data, requestId: RequestContext.requestId };
  }

  /** Quitar = transición a DISABLED, igual que /iam/memberships/:id. */
  @Delete(":id/memberships/:membershipId")
  @HttpCode(204)
  async removeMembership(
    @Param("id") id: string,
    @Param("membershipId") membershipId: string,
  ): Promise<void> {
    await this.people.removeMembership({
      tenantId: id,
      actor: { userId: RequestContext.userId },
      membershipId,
    });
  }

  // ---- API keys ----
  //
  // Mismo servicio que /iam/api-keys, pero autorizado por SuperAdminGuard: un
  // super-admin normalmente no es miembro de la empresa y no tendría el scope
  // apikeys.manage. Se audita con `metadata.via = "super-admin"` igual que el
  // resto de mutaciones cross-tenant.

  @Get(":id/api-keys")
  async listApiKeys(@Param("id") id: string) {
    await this.assertTenantExists(id);
    const keys = await this.apiKeys.list(id);
    return { data: keys, requestId: RequestContext.requestId };
  }

  @Post(":id/api-keys")
  async createApiKey(@Param("id") id: string, @Body() body: CreateTenantApiKeyDto) {
    await this.assertTenantExists(id);
    const actorId = RequestContext.userId;
    if (!actorId) throw new ForbiddenException();
    const created = await this.apiKeys.create({
      tenantId: id,
      actorId,
      name: body.name,
      scopes: body.scopes,
      expiresInDays: body.expiresInDays,
    });
    await this.prisma.auditLog.create({
      data: {
        tenantId: id,
        actorId,
        action: "apikey.created",
        targetType: "ApiKey",
        targetId: created.id,
        metadata: {
          name: created.name,
          prefix: created.prefix,
          scopes: created.scopes,
          expiresAt: created.expiresAt?.toISOString() ?? null,
          via: "super-admin",
        },
      },
    });
    return { data: created, requestId: RequestContext.requestId };
  }

  @Delete(":id/api-keys/:keyId")
  @HttpCode(204)
  async revokeApiKey(@Param("id") id: string, @Param("keyId") keyId: string): Promise<void> {
    await this.assertTenantExists(id);
    // Se lee antes de revocar para dejar nombre y prefijo en la bitácora; el
    // 404 de una key ajena o ya revocada lo sigue dando el servicio.
    const key = await this.prisma.apiKey.findFirst({
      where: { id: keyId, tenantId: id, revokedAt: null },
      select: { name: true, prefix: true },
    });
    await this.apiKeys.revoke(id, keyId);
    await this.prisma.auditLog.create({
      data: {
        tenantId: id,
        actorId: RequestContext.userId,
        action: "apikey.revoked",
        targetType: "ApiKey",
        targetId: keyId,
        metadata: { name: key?.name ?? null, prefix: key?.prefix ?? null, via: "super-admin" },
      },
    });
  }

  private async assertTenantExists(id: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Empresa no encontrada" });
  }
}

/**
 * Branding del propio tenant: lo edita el ADMIN/OWNER de esa empresa, no
 * requiere super-admin. Separado del controller anterior porque el guard es
 * distinto (RoleGuard + scope tenant.admin, no cross-tenant).
 */
@Controller("tenants/me")
@UseGuards(RoleGuard)
export class TenantSelfController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logo: TenantLogoService,
  ) {}

  @Get()
  @RequireScopes("tenant.admin")
  async get() {
    const tenantId = this.requireTenant();
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant no encontrado" });
    return { data: tenant, requestId: RequestContext.requestId };
  }

  /** Contexto mínimo que el agente necesita para hablar en nombre del tenant.
   * No expone membresías, secretos ni configuración administrativa. */
  @Get("agent-context")
  @RequireScopes("catalog.read")
  async agentContext() {
    const tenantId = this.requireTenant();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        accentColor: true,
      },
    });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant no encontrado" });
    return { data: tenant, requestId: RequestContext.requestId };
  }

  @Patch("branding")
  @RequireScopes("tenant.admin")
  async updateBranding(@Body() body: UpdateBrandingDto) {
    const tenantId = this.requireTenant();
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        logoUrl: body.logoUrl,
        primaryColor: body.primaryColor,
        secondaryColor: body.secondaryColor,
        accentColor: body.accentColor,
        version: { increment: 1 },
      },
    });
    return { data: tenant, requestId: RequestContext.requestId };
  }

  /**
   * Logo de la empresa: multipart con el archivo en el campo `file`. PNG, JPG,
   * WebP o SVG saneado, ≤ 2 MB, entre 128×128 y 4096×4096 px y proporción
   * 1:3–3:1; ver `logo-validation.ts`. Cualquier rechazo sale como
   * `{ code: "VALIDATION_FAILED", message }` en español.
   */
  @Post("logo")
  @RequireScopes("tenant.admin")
  @UseInterceptors(LogoUploadInterceptor)
  async uploadLogo(@UploadedFile() file?: Express.Multer.File) {
    const tenantId = this.requireTenant();
    const tenant = await this.logo.upload(tenantId, RequestContext.userId ?? null, file);
    return { data: tenant, requestId: RequestContext.requestId };
  }

  @Delete("logo")
  @RequireScopes("tenant.admin")
  async removeLogo() {
    const tenantId = this.requireTenant();
    const tenant = await this.logo.remove(tenantId, RequestContext.userId ?? null);
    return { data: tenant, requestId: RequestContext.requestId };
  }

  private requireTenant(): string {
    const t = RequestContext.tenantId;
    if (!t) throw new NotFoundException({ code: "UNAUTHORIZED", message: "Sin tenant" });
    return t;
  }
}
