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
import { PaymentService } from "./payment.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { Public } from "../auth/guards/principal.guard.js";
import { RequestContext } from "../common/context/request-context.js";

@Controller("payments")
@UseGuards(RoleGuard)
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Get("sessions")
  @RequireScopes("payments.read")
  async listSessions() {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.payments.listSessions(tenantId),
      requestId: RequestContext.requestId,
    };
  }

  @Get("sessions/:id")
  @RequireScopes("payments.read")
  async getSession(@Param("id") id: string) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.payments.getSession(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  @Get("ledger")
  @RequireScopes("payments.read")
  async ledger(@Query("sessionId") sessionId?: string) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.payments.getLedger(tenantId, sessionId),
      requestId: RequestContext.requestId,
    };
  }

  @Post("refunds")
  @HttpCode(200)
  @RequireScopes("payments.refund")
  async refund(
    @Body()
    body: { sessionId: string; amount: string; reason: string },
  ) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.payments.refund(tenantId, body.sessionId, body.amount, body.reason),
      requestId: RequestContext.requestId,
    };
  }

  @Public()
  @Post("webhook")
  @HttpCode(200)
  async webhook(@Req() req: Request) {
    // Usa el rawBody capturado por bodyParser.raw (configurado en main.ts)
    // para verificar HMAC sobre los bytes exactos.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (req as any).body;
    const rawBody: string =
      typeof raw === "string"
        ? raw
        : Buffer.isBuffer(raw)
          ? raw.toString("utf8")
          : JSON.stringify(raw);
    const signature = req.headers["x-dummy-signature"] as string | undefined;
    try {
      await this.payments.handleWebhook(rawBody, signature);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Webhook inválido",
      });
    }
    return { data: { ok: true }, requestId: RequestContext.requestId };
  }
}