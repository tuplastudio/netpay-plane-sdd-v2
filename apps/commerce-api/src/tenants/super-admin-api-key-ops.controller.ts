/**
 * Operaciones de API keys desde la consola de plataforma (T-IAM-05b):
 * bitácora de uso, rotación y edición, tanto de las keys de una empresa
 * (`/super-admin/tenants/:id/api-keys/:keyId/...`) como de las globales
 * (`/super-admin/api-keys/:id/...`). Mismo `ApiKeyService` que `/iam`, pero
 * autorizado por `SuperAdminGuard`: el super-admin no es miembro de la
 * empresa y no tendría `apikeys.manage`.
 *
 * Va en un controlador aparte para no tocar la firma (ni los tests) de
 * `SuperAdminTenantsController` y `SuperAdminApiKeysController`.
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { RequestContext } from "../common/context/request-context.js";
import { ApiKeyService } from "../auth/api-key.service.js";
import { ApiKeyUsageService } from "../auth/usage/api-key-usage.service.js";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard.js";
import { diffApiKey } from "../auth/api-key.controller.js";
import {
  ApiKeyUsageQueryDto,
  ApiKeyUsageSummaryQueryDto,
  PurgeApiKeyUsageDto,
  RotateApiKeyDto,
  UpdateApiKeyDto,
} from "../auth/iam.dto.js";

@Controller("super-admin")
@UseGuards(SuperAdminGuard)
export class SuperAdminApiKeyOpsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
    private readonly usage: ApiKeyUsageService,
  ) {}

  // ---- Keys de una empresa ----

  @Get("tenants/:id/api-keys/:keyId/usage")
  async tenantKeyUsage(
    @Param("id") tenantId: string,
    @Param("keyId") keyId: string,
    @Query() query: ApiKeyUsageQueryDto,
  ) {
    await this.assertTenantExists(tenantId);
    await this.apiKeys.get(tenantId, keyId);
    return this.usagePage(keyId, query);
  }

  @Get("tenants/:id/api-keys/:keyId/usage/summary")
  async tenantKeyUsageSummary(
    @Param("id") tenantId: string,
    @Param("keyId") keyId: string,
    @Query() query: ApiKeyUsageSummaryQueryDto,
  ) {
    await this.assertTenantExists(tenantId);
    await this.apiKeys.get(tenantId, keyId);
    const summary = await this.usage.summary(keyId, query.days ?? 30);
    return { data: summary, requestId: RequestContext.requestId };
  }

  @Post("tenants/:id/api-keys/:keyId/rotate")
  async rotateTenantKey(
    @Param("id") tenantId: string,
    @Param("keyId") keyId: string,
    @Body() body: RotateApiKeyDto,
  ) {
    await this.assertTenantExists(tenantId);
    const actorId = this.requireHuman("rotar");
    const rotated = await this.apiKeys.rotate({ tenantId, id: keyId, actorId, graceHours: body.graceHours });
    await this.audit(tenantId, "apikey.rotated", keyId, {
      name: rotated.name,
      previousPrefix: rotated.previousKey.prefix,
      newKeyId: rotated.id,
      newPrefix: rotated.prefix,
      graceHours: rotated.previousKey.graceHours,
      previousValidUntil: rotated.previousKey.validUntil.toISOString(),
      via: "super-admin",
    });
    return { data: rotated, requestId: RequestContext.requestId };
  }

  @Patch("tenants/:id/api-keys/:keyId")
  async updateTenantKey(
    @Param("id") tenantId: string,
    @Param("keyId") keyId: string,
    @Body() body: UpdateApiKeyDto,
  ) {
    await this.assertTenantExists(tenantId);
    const { before, after } = await this.apiKeys.update({
      tenantId,
      id: keyId,
      name: body.name,
      scopes: body.scopes,
      expiresAt: toExpiresAt(body.expiresAt),
    });
    await this.audit(tenantId, "apikey.updated", keyId, {
      prefix: after.prefix,
      changes: diffApiKey(before, after),
      via: "super-admin",
    });
    return { data: after, requestId: RequestContext.requestId };
  }

  // ---- Keys globales ----

  @Get("api-keys/:id/usage")
  async globalKeyUsage(@Param("id") id: string, @Query() query: ApiKeyUsageQueryDto) {
    await this.apiKeys.get(null, id);
    return this.usagePage(id, query);
  }

  @Get("api-keys/:id/usage/summary")
  async globalKeyUsageSummary(@Param("id") id: string, @Query() query: ApiKeyUsageSummaryQueryDto) {
    await this.apiKeys.get(null, id);
    const summary = await this.usage.summary(id, query.days ?? 30);
    return { data: summary, requestId: RequestContext.requestId };
  }

  @Post("api-keys/:id/rotate")
  async rotateGlobalKey(@Param("id") id: string, @Body() body: RotateApiKeyDto) {
    const actorId = this.requireHuman("rotar");
    const rotated = await this.apiKeys.rotate({ tenantId: null, id, actorId, graceHours: body.graceHours });
    await this.audit(null, "apikey.global.rotated", id, {
      name: rotated.name,
      previousPrefix: rotated.previousKey.prefix,
      newKeyId: rotated.id,
      newPrefix: rotated.prefix,
      graceHours: rotated.previousKey.graceHours,
      previousValidUntil: rotated.previousKey.validUntil.toISOString(),
    });
    return { data: rotated, requestId: RequestContext.requestId };
  }

  /** Una global siempre lleva todos los scopes: aquí solo nombre y vencimiento. */
  @Patch("api-keys/:id")
  async updateGlobalKey(@Param("id") id: string, @Body() body: UpdateApiKeyDto) {
    if (body.scopes !== undefined) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Los scopes de una key global no se pueden acotar",
      });
    }
    const { before, after } = await this.apiKeys.update({
      tenantId: null,
      id,
      name: body.name,
      expiresAt: toExpiresAt(body.expiresAt),
    });
    await this.audit(null, "apikey.global.updated", id, {
      prefix: after.prefix,
      changes: diffApiKey(before, after),
    });
    return { data: after, requestId: RequestContext.requestId };
  }

  /**
   * Purga manual de la bitácora (la automática corre cada 6 h en el API;
   * ver `ApiKeyUsageService.onModuleInit`). Sin `days` usa la retención
   * configurada (`API_KEY_USAGE_RETENTION_DAYS`, 90).
   */
  @Post("api-keys/usage/purge")
  async purgeUsage(@Body() body: PurgeApiKeyUsageDto) {
    const days = body.days ?? this.usage.retentionDays();
    const deleted = await this.usage.purgeOlderThan(days);
    await this.audit(null, "apikey.usage.purged", null, { days, deleted });
    return { data: { days, deleted }, requestId: RequestContext.requestId };
  }

  // ---- helpers ----

  private async usagePage(keyId: string, query: ApiKeyUsageQueryDto) {
    const page = await this.usage.list(keyId, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      path: query.path,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { data: page.items, pageInfo: page.pageInfo, requestId: RequestContext.requestId };
  }

  private async assertTenantExists(id: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Empresa no encontrada" });
  }

  /** Igual que emitir/revocar: rotar exige una persona detrás, no otra key. */
  private requireHuman(verb: string): string {
    const actorId = RequestContext.userId;
    if (!actorId) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: `Solo una sesión de super-admin humano puede ${verb} una API key`,
      });
    }
    return actorId;
  }

  private async audit(
    tenantId: string | null,
    action: string,
    targetId: string | null,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: RequestContext.userId ?? null,
        action,
        targetType: "ApiKey",
        targetId,
        metadata,
      },
    });
  }
}

/** `undefined` = no tocar; `null` = sin vencimiento; ISO = fecha. */
function toExpiresAt(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
}
