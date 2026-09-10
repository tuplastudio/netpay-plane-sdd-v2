/**
 * Membresías del tenant (T-IAM-04). Mismo prefijo y mismos guards que
 * ApiKeyController: PrincipalGuard + RoleGuard con @RequireScopes.
 */
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
  UseGuards,
} from "@nestjs/common";
import { RoleGuard, RequireScopes } from "./guards/role.guard.js";
import { PrincipalGuard } from "./guards/principal.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import { MembershipActor, MembershipService } from "./membership.service.js";

@Controller("iam")
@UseGuards(PrincipalGuard, RoleGuard)
export class MembershipController {
  constructor(private readonly memberships: MembershipService) {}

  @Get("memberships")
  @RequireScopes("users.manage")
  async list() {
    const tenantId = this.requireTenant();
    const data = await this.memberships.list(tenantId, RequestContext.userId);
    return { data, requestId: RequestContext.requestId };
  }

  @Patch("memberships/:id")
  @RequireScopes("users.manage")
  async changeRole(@Param("id") id: string, @Body() body: { role: string }) {
    const tenantId = this.requireTenant();
    const data = await this.memberships.changeRole({
      tenantId,
      actor: this.requireActor(),
      membershipId: id,
      role: body?.role,
    });
    return { data, requestId: RequestContext.requestId };
  }

  /**
   * Remover = transición a DISABLED (ver membership.service.ts). Se conserva el
   * verbo DELETE porque para el portal es "quitar del tenant".
   */
  @Delete("memberships/:id")
  @HttpCode(204)
  @RequireScopes("users.manage")
  async remove(@Param("id") id: string): Promise<void> {
    const tenantId = this.requireTenant();
    await this.memberships.remove({
      tenantId,
      actor: this.requireActor(),
      membershipId: id,
    });
  }

  @Delete("invitations/:id")
  @HttpCode(204)
  @RequireScopes("users.manage")
  async revokeInvitation(@Param("id") id: string): Promise<void> {
    const tenantId = this.requireTenant();
    await this.memberships.revokeInvitation({
      tenantId,
      actor: this.requireActor(),
      invitationId: id,
    });
  }

  private requireTenant(): string {
    const t = RequestContext.tenantId;
    if (!t) throw new NotFoundException({ code: "UNAUTHORIZED", message: "Sin tenant" });
    return t;
  }

  /**
   * Toda mutación de membresía exige una sesión de usuario: hace falta un actor
   * para la auditoría y para las reglas de "no te toques a ti mismo". Una API
   * key con users.manage podría, si no, fabricarse un OWNER sin dueño humano.
   */
  private requireActor(): MembershipActor {
    const principal = RequestContext.principal;
    if (principal.type !== "USER" || !principal.userId) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Esta acción requiere una sesión de usuario del portal",
      });
    }
    return { userId: principal.userId, role: principal.role ?? "VIEWER" };
  }
}
