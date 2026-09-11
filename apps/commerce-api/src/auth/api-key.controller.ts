import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiKeyService } from "./api-key.service.js";
import { RoleGuard, RequireScopes } from "./guards/role.guard.js";
import { PrincipalGuard } from "./guards/principal.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import { InviteService } from "./invite.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { InvitationMailer } from "./invitation-mailer.service.js";
import { CreateApiKeyDto, CreateInvitationDto } from "./iam.dto.js";
import { effectiveScopesOf } from "./policies.js";

@Controller("iam")
@UseGuards(PrincipalGuard, RoleGuard)
export class ApiKeyController {
  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly invite: InviteService,
    private readonly prisma: PrismaService,
    private readonly mailer: InvitationMailer,
  ) {}

  // ---- API keys (T-IAM-05) ----
  @Get("api-keys")
  @RequireScopes("apikeys.manage")
  async listKeys() {
    const tenantId = this.requireTenant();
    const keys = await this.apiKeys.list(tenantId);
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

    const granted = effectiveScopesOf(RequestContext.principal);
    const excess = body.scopes.filter((s) => !granted.has(s));
    if (excess.length > 0) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: `No puedes otorgar scopes que tú no tienes: ${excess.join(", ")}`,
      });
    }

    const created = await this.apiKeys.create({
      tenantId,
      actorId: userId,
      name: body.name,
      scopes: body.scopes,
      expiresInDays: body.expiresInDays,
    });
    return { data: created, requestId: RequestContext.requestId };
  }

  @Delete("api-keys/:id")
  @HttpCode(204)
  @RequireScopes("apikeys.manage")
  async revokeKey(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    await this.apiKeys.revoke(tenantId, id);
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

  private requireTenant(): string {
    const t = RequestContext.tenantId;
    if (!t) throw new NotFoundException({ code: "UNAUTHORIZED", message: "Sin tenant" });
    return t;
  }
}
