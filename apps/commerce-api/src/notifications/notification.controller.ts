import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { NotificationService } from "./notification.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { ScheduleNotificationDto } from "./notification.dto.js";
import { RequestContext } from "../common/context/request-context.js";
import { buildPageInfo, parsePaging } from "../common/pagination.js";

@Controller("notifications")
@UseGuards(RoleGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @RequireScopes("notifications.read" as never)
  async list(
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const tenantId = RequestContext.tenantId!;
    const paging = parsePaging({ limit, offset }, { defaultLimit: 50, maxLimit: 100 });
    const { items, total } = await this.notifications.list(tenantId, status, paging);
    return {
      data: items,
      pageInfo: buildPageInfo(total, paging),
      requestId: RequestContext.requestId,
    };
  }

  @Get("timeline/:subjectType/:subjectId")
  @RequireScopes("notifications.read" as never)
  async timeline(
    @Param("subjectType") subjectType: string,
    @Param("subjectId") subjectId: string,
  ) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.notifications.getTimeline(tenantId, subjectType, subjectId),
      requestId: RequestContext.requestId,
    };
  }

  @Get("report/cohort")
  @RequireScopes("notifications.read" as never)
  async cohort() {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.notifications.cohortReport(tenantId),
      requestId: RequestContext.requestId,
    };
  }

  @Get("export.csv")
  @RequireScopes("notifications.read" as never)
  async exportCsv(@Res() res: Response) {
    const tenantId = RequestContext.tenantId!;
    const csv = await this.notifications.exportCsv(tenantId);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="notifications-${tenantId}.csv"`);
    res.send(csv);
  }

  @Post("schedule")
  @HttpCode(201)
  @RequireScopes("notifications.write" as never)
  async schedule(@Body() body: ScheduleNotificationDto) {
    const tenantId = RequestContext.tenantId!;
    const n = await this.notifications.schedule({
      tenantId,
      recipientType: body.recipientType,
      recipientId: body.recipientId,
      channel: body.channel,
      templateKey: body.templateKey,
      payload: body.payload,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
    });
    return { data: n, requestId: RequestContext.requestId };
  }
}