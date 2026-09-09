import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { IntegrationService } from "./integration.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { Public } from "../auth/guards/principal.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("integrations")
@UseGuards(RoleGuard)
export class IntegrationController {
  constructor(
    private readonly integrations: IntegrationService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequireScopes("integrations.read" as never)
  async list() {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.integrations.list(tenantId),
      requestId: RequestContext.requestId,
    };
  }

  @Post()
  @HttpCode(201)
  @RequireScopes("integrations.write" as never)
  async create(
    @Body()
    body: {
      name: string;
      provider: string;
      direction: "INBOUND" | "OUTBOUND" | "BIDIRECTIONAL";
      endpoint?: string;
      secret?: string;
    },
  ) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.integrations.create(tenantId, body),
      requestId: RequestContext.requestId,
    };
  }

  @Post(":id/disable")
  @HttpCode(204)
  @RequireScopes("integrations.write" as never)
  async disable(@Param("id") id: string) {
    const tenantId = RequestContext.tenantId!;
    await this.integrations.disable(tenantId, id);
  }

  @Get("events")
  @RequireScopes("integrations.read" as never)
  async listEvents(@Query("status") status?: string) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.integrations.listEvents(tenantId, status),
      requestId: RequestContext.requestId,
    };
  }

  @Post("events/:eventId/reprocess")
  @HttpCode(200)
  @RequireScopes("integrations.write" as never)
  async reprocessEvent(@Param("eventId") eventId: string) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.integrations.reprocess(tenantId, eventId),
      requestId: RequestContext.requestId,
    };
  }

  @Post(":id/publish")
  @HttpCode(200)
  @RequireScopes("integrations.write" as never)
  async publish(
    @Param("id") id: string,
    @Body() body: { eventName: string; payload: Record<string, unknown>; secret: string },
  ) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.integrations.publishOutbound({
        tenantId,
        integrationId: id,
        eventName: body.eventName,
        payload: body.payload,
        secret: body.secret,
      }),
      requestId: RequestContext.requestId,
    };
  }

  // ---- T-INT-03: webhook entrante público ----
  @Public()
  @Post("webhook/:token")
  @HttpCode(200)
  async webhook(@Param("token") token: string, @Body() body: unknown, @Req() req: Request) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = this.prisma as any;
    const integration = await prisma.integration.findFirst({
      where: { webhookUrl: { contains: token } },
    });
    if (!integration) {
      throw new BadRequestException({
        code: "NOT_FOUND",
        message: "Webhook token inválido",
      });
    }
    const signature =
      (req.headers["x-netpay-signature"] as string | undefined) ??
      (req.headers["x-dummy-signature"] as string | undefined);
    const obj = (body ?? {}) as { eventName?: string; externalId?: string };
    const result = await this.integrations.ingestInbound({
      tenantId: integration.tenantId,
      integrationId: integration.id,
      eventName: obj.eventName ?? "unknown",
      externalId: obj.externalId,
      payload: obj as Record<string, unknown>,
      rawBody: JSON.stringify(body),
      signature,
    });
    return { data: result, requestId: RequestContext.requestId };
  }
}