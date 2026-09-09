/**
 * Audit endpoint: T-IAM-06 — auditar eventos sensibles.
 */
import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { RequestContext } from "../common/context/request-context.js";

@Controller("audit")
@UseGuards(RoleGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("events")
  @RequireScopes("audit.read")
  async events(
    @Query("action") action?: string,
    @Query("limit") limit?: string,
  ) {
    const tenantId = RequestContext.tenantId!;
    const take = Math.min(Number(limit ?? 50), 200);
    return {
      data: await this.prisma.auditLog.findMany({
        where: { tenantId, ...(action ? { action } : {}) },
        orderBy: { createdAt: "desc" },
        take,
      }),
      requestId: RequestContext.requestId,
    };
  }
}