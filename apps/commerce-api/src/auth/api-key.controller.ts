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
  UseGuards,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ApiKeyService } from "./api-key.service.js";
import { ApiKeyUsageService } from "./usage/api-key-usage.service.js";
import { RoleGuard, RequireScopes } from "./guards/role.guard.js";
import { PrincipalGuard } from "./guards/principal.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import { InviteService } from "./invite.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { InvitationMailer } from "./invitation-mailer.service.js";
import {
  ApiKeyUsageQueryDto,
  ApiKeyUsageSummaryQueryDto,
  CreateApiKeyDto,
  CreateInvitationDto,
  RotateApiKeyDto,
  UpdateApiKeyDto,
} from "./iam.dto.js";
import { effectiveScopesOf, isScope } from "./policies.js";

/** Acciones de auditoría de API keys de tenant (las globales llevan `apikey.global.*`). */
export const API_KEY_AUDIT = {
  created: "apikey.created",
  updated: "apikey.updated",
  rotated: "apikey.rotated",
  revoked: "apikey.revoked",
} as const;

@Controller("iam")
@UseGuards(PrincipalGuard, RoleGuard)
export class ApiKeyController {
  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly invite: InviteService,
    private readonly prisma: PrismaService,
    private readonly mailer: InvitationMailer,
    private readonly usage: ApiKeyUsageService,
  ) {}

  // ---- API keys (T-IAM-05) ----
  @Get("api-keys")
  @RequireScopes("apikeys.manage")
  async listKeys(@Query("includeRevoked") includeRevoked?: string) {
    const tenantId = this.requireTenant();
    const keys = await this.apiKeys.list(tenantId, { includeRevoked: includeRevoked === "true" });
    return { data: keys, requestId: RequestContext.requestId };
  }

  /**
   * Emite una API key del tenant.
   *
   * Dos candados sobre `scopes`, que antes llegaba como `string[]` sin validar:
   *
   *  1. El DTO lo acota al catálogo de `policies.ts` (antes se podía grabar
   *     cualquier cadena en la columna).
   *  2. Aquí se comprueba que no exceda lo que el propio emisor tiene. Sin
   *     esto, un CATALOG con `apikeys.manage`... —no lo tiene— pero sí un
   *     ADMIN, que no puede reembolsar (`payments.refund`) ni administrar el
   *     tenant (`tenant.admin`), se acuñaba una key con esos scopes y la usaba
   *     como Bearer para hacer justo lo que su rol le prohíbe.
   *
   * Se rechaza en vez de intersecar en silencio: quien pide una key con más
   * permisos de los que tiene debe enterarse, no recibir una key mutilada que
   * falle más tarde en cualquier otro sitio.
   */
  @Post("api-keys")
  @RequireScopes("apikeys.manage")
  async createKey(@Body() body: CreateApiKeyDto) {
    const tenantId = this.requireTenant();
    const userId = RequestContext.userId;
    if (!userId) throw new ForbiddenException();
    this.assertCanGrantScopes(body.scopes);

    const created = await this.apiKeys.create({
      tenantId,
      actorId: userId,
      name: body.name,
      scopes: body.scopes,
      expiresInDays: body.expiresInDays,
    });
    await this.audit(tenantId, API_KEY_AUDIT.created, created.id, {
      name: created.name,
      prefix: created.prefix,
      scopes: created.scopes,
      expiresAt: created.expiresAt?.toISOString() ?? null,
    });
    return { data: created, requestId: RequestContext.requestId };
  }

  /**
   * Renombrar, cambiar scopes o vencimiento. Mismo candado de scopes que al
   * crear: nadie amplía una key por encima de lo que su propio rol tiene.
   */
  @Patch("api-keys/:id")
  @RequireScopes("apikeys.manage")
  async updateKey(@Param("id") id: string, @Body() body: UpdateApiKeyDto) {
    const tenantId = this.requireTenant();
    if (body.scopes) this.assertCanGrantScopes(body.scopes);
    const { before, after } = await this.apiKeys.update({
      tenantId,
      id,
      name: body.name,
      scopes: body.scopes,
      expiresAt: body.expiresAt === undefined ? undefined : body.expiresAt === null ? null : new Date(body.expiresAt),
    });
    await this.audit(tenantId, API_KEY_AUDIT.updated, id, {
      prefix: after.prefix,
      changes: diffApiKey(before, after),
    });
    return { data: after, requestId: RequestContext.requestId };
  }

  /**
   * Rota la key: secreto nuevo (se devuelve una sola vez) y la vieja en
   * gracia. Ver `ApiKeyService.rotate`.
   */
  @Post("api-keys/:id/rotate")
  @RequireScopes("apikeys.manage")
  async rotateKey(@Param("id") id: string, @Body() body: RotateApiKeyDto) {
    const tenantId = this.requireTenant();
    const userId = RequestContext.userId;
    if (!userId) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Solo una sesión de usuario puede rotar una API key",
      });
    }
    const rotated = await this.apiKeys.rotate({ tenantId, id, actorId: userId, graceHours: body.graceHours });
    await this.audit(tenantId, API_KEY_AUDIT.rotated, id, {
      name: rotated.name,
      previousPrefix: rotated.previousKey.prefix,
      newKeyId: rotated.id,
      newPrefix: rotated.prefix,
      graceHours: rotated.previousKey.graceHours,
      previousValidUntil: rotated.previousKey.validUntil.toISOString(),
    });
    return { data: rotated, requestId: RequestContext.requestId };
  }

  @Delete("api-keys/:id")
  @HttpCode(204)
  @RequireScopes("apikeys.manage")
  async revokeKey(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    // Se lee antes para dejar nombre y prefijo en la bitácora; el 404 de una
    // key ajena o ya revocada lo sigue dando el servicio.
    const key = await this.prisma.apiKey.findFirst({
      where: { id, tenantId, revokedAt: null },
      select: { name: true, prefix: true },
    });
    await this.apiKeys.revoke(tenantId, id);
    await this.audit(tenantId, API_KEY_AUDIT.revoked, id, {
      name: key?.name ?? null,
      prefix: key?.prefix ?? null,
    });
  }

  // ---- Bitácora de uso ----

  @Get("api-keys/:id/usage")
  @RequireScopes("apikeys.manage")
  async keyUsage(@Param("id") id: string, @Query() query: ApiKeyUsageQueryDto) {
    const tenantId = this.requireTenant();
    await this.apiKeys.get(tenantId, id);
    const page = await this.usage.list(id, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      path: query.path,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { data: page.items, pageInfo: page.pageInfo, requestId: RequestContext.requestId };
  }

  @Get("api-keys/:id/usage/summary")
  @RequireScopes("apikeys.manage")
  async keyUsageSummary(@Param("id") id: string, @Query() query: ApiKeyUsageSummaryQueryDto) {
    const tenantId = this.requireTenant();
    await this.apiKeys.get(tenantId, id);
    const summary = await this.usage.summary(id, query.days ?? 30);
    return { data: summary, requestId: RequestContext.requestId };
  }

  // ---- Users / memberships (T-IAM-04 subset) ----
  /**
   * Invita a alguien al tenant. `role` viajaba sin validar: bastaba mandar
   * `role: "OWNER"` (o el propio correo del ADMIN) para fabricarse un
   * propietario y saltarse la regla que `membership.service.ts` sí aplica al
   * cambiar el rol de una membresía existente.
   *
   * La jerarquía no se reinventa aquí: es la misma de `policies.ts` que usa
   * `MembershipService.assertTenantAdmin` — otorgar OWNER exige `tenant.admin`,
   * que en la matriz solo tiene OWNER.
   */
  @Post("invitations")
  @RequireScopes("users.invite")
  async inviteUser(@Body() body: CreateInvitationDto) {
    const tenantId = this.requireTenant();
    this.assertCanGrantRole(body.role);

    const result = await this.invite.createInvite({
      tenantId,
      email: body.email,
      fullName: body.fullName,
      role: body.role,
    });

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (tenant) {
      // Best-effort (ver InvitationMailer): si el correo falla, la invitación ya
      // existe y el admin puede copiar el enlace desde el panel.
      await this.mailer.sendBestEffort({
        tenant,
        email: body.email,
        fullName: body.fullName,
        role: body.role,
        token: result.token,
        expiresAt: result.expiresAt,
      });
    }

    return { data: result, requestId: RequestContext.requestId };
  }

  /**
   * Nadie invita por encima de su propia jerarquía. Solo OWNER es especial:
   * el resto de roles los puede otorgar cualquiera con `users.invite`, igual
   * que `MembershipService.changeRole` deja a un ADMIN mover roles no-OWNER.
   *
   * Además se exige una sesión de persona: una API key con `users.invite`
   * podría, si no, fabricar un OWNER sin dueño humano detrás (mismo argumento
   * que `MembershipController.requireActor`).
   */
  private assertCanGrantRole(role: string): void {
    if (role !== "OWNER") return;

    const principal = RequestContext.principal;
    const canGrantOwner =
      principal.type === "USER" &&
      (principal.isSuperAdmin === true || effectiveScopesOf(principal).has("tenant.admin"));

    if (!canGrantOwner) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Solo un propietario puede invitar a otro propietario.",
      });
    }
  }

  /** Ver `createKey`: no se otorgan scopes que el emisor no tiene. */
  private assertCanGrantScopes(scopes: ReadonlyArray<string>): void {
    const granted = effectiveScopesOf(RequestContext.principal);
    const excess = scopes.filter((s) => !isScope(s) || !granted.has(s));
    if (excess.length > 0) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: `No puedes otorgar scopes que tú no tienes: ${excess.join(", ")}`,
      });
    }
  }

  private async audit(
    tenantId: string,
    action: string,
    targetId: string,
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

  private requireTenant(): string {
    const t = RequestContext.tenantId;
    if (!t) throw new NotFoundException({ code: "UNAUTHORIZED", message: "Sin tenant" });
    return t;
  }
}

/** Solo los campos que cambiaron, con antes/después, para el AuditLog. */
export function diffApiKey(
  before: { name: string; scopes: string[]; expiresAt: Date | null },
  after: { name: string; scopes: string[]; expiresAt: Date | null },
): Prisma.InputJsonObject {
  const changes: Record<string, { from: Prisma.InputJsonValue | null; to: Prisma.InputJsonValue | null }> = {};
  if (before.name !== after.name) changes.name = { from: before.name, to: after.name };
  const sameScopes =
    before.scopes.length === after.scopes.length && before.scopes.every((s) => after.scopes.includes(s));
  if (!sameScopes) changes.scopes = { from: before.scopes, to: after.scopes };
  const b = before.expiresAt?.toISOString() ?? null;
  const a = after.expiresAt?.toISOString() ?? null;
  if (b !== a) changes.expiresAt = { from: b, to: a };
  return changes;
}
