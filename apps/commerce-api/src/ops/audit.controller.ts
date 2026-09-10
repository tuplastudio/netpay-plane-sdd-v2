/**
 * Audit endpoint: T-IAM-06 — auditar eventos sensibles.
 */
import { Controller, Get, NotFoundException, Param, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { RequestContext } from "../common/context/request-context.js";

/** El actor se expone con lo mínimo para nombrarlo en el UI; nunca hashes ni TOTP. */
const ACTOR_INCLUDE = {
  actor: { select: { id: true, email: true, fullName: true } },
} as const;

@Controller("audit")
@UseGuards(RoleGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("events")
  @RequireScopes("audit.read")
  async events(
    @Query("action") action?: string,
    @Query("targetType") targetType?: string,
    @Query("limit") limit?: string,
  ) {
    const tenantId = RequestContext.tenantId!;
    const take = Math.min(Number(limit ?? 50), 200);
    return {
      data: await this.prisma.auditLog.findMany({
        where: {
          tenantId,
          ...(action ? { action } : {}),
          ...(targetType ? { targetType } : {}),
        },
        include: ACTOR_INCLUDE,
        orderBy: { createdAt: "desc" },
        take,
      }),
      requestId: RequestContext.requestId,
    };
  }

  @Get("events/:id")
  @RequireScopes("audit.read")
  async event(@Param("id") id: string) {
    const tenantId = RequestContext.tenantId!;
    // Scoped por tenant: un id de otra empresa responde 404, no 403, para no
    // confirmar que existe.
    const event = await this.prisma.auditLog.findFirst({
      where: { id, tenantId },
      include: ACTOR_INCLUDE,
    });
    if (!event) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Evento no encontrado" });
    }
    return { data: event, requestId: RequestContext.requestId };
  }
}
