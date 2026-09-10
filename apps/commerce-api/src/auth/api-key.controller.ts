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

  @Post("api-keys")
  @RequireScopes("apikeys.manage")
  async createKey(
    @Body() body: { name: string; scopes: string[]; expiresInDays?: number },
  ) {
    const tenantId = this.requireTenant();
    const userId = RequestContext.userId;
    if (!userId) throw new ForbiddenException();
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
  @Post("invitations")
  @RequireScopes("users.invite")
  async inviteUser(
    @Body() body: {
      email: string;
      fullName: string;
      role: "VENDOR" | "FINANCE" | "CATALOG" | "SUPPORT" | "VIEWER";
    },
  ) {
    const tenantId = this.requireTenant();
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

  private requireTenant(): string {
    const t = RequestContext.tenantId;
    if (!t) throw new NotFoundException({ code: "UNAUTHORIZED", message: "Sin tenant" });
    return t;
  }
}