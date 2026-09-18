import {
  All,
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Request, Response } from "express";
import { PaymentService } from "./payment.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { RefundDto } from "./payment.dto.js";
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
  async refund(@Body() body: RefundDto) {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.payments.refund(tenantId, body.sessionId, body.amount, body.reason ?? ""),
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

  /**
   * Proxy transparente al dummy-gateway para servir el checkout hosted
   * desde el navegador del cliente. La pasarela no está expuesta al
   * público, así que commerce-api (que vive en la misma red de Docker)
   * hace de relay: /pay/checkout/sessions/<id> → /payments/dummy-proxy/
   * checkout/sessions/<id> → http://dummy-gateway:4100/checkout/sessions/<id>.
   *
   * El proxy es `@Public()`: la página hosted es la que muestra el iframe
   * de tarjeta y los recursos estáticos del gateway, no requiere sesión.
   */
  @Public()
  @All("dummy-proxy/**")
  async dummyProxy(@Req() req: Request, @Res() res: Response): Promise<void> {
    const base = (process.env.DUMMY_BASE_URL ?? "http://localhost:4100").replace(/\/$/, "");
    const rest = req.path.replace(/^\/api\/v1\/payments\/dummy-proxy/, "");
    const target = `${base}${rest}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;

    const headers = new Headers();
    const incomingType = req.headers["content-type"];
    if (incomingType) headers.set("content-type", incomingType);
    const incomingAuth = req.headers["authorization"];
    if (incomingAuth) headers.set("authorization", incomingAuth);
    if (process.env.DUMMY_SERVICE_KEY && !incomingAuth) {
      headers.set(
        "authorization",
        `Bearer ${process.env.DUMMY_SERVICE_KEY_REF ?? "npk_test_local"}`,
      );
    }

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers,
        body:
          req.method === "GET" || req.method === "HEAD"
            ? undefined
            : (req as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer
            ? await (req as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer()
            : undefined,
      });
    } catch (err) {
      res.status(502).json({
        code: "DUMMY_UNREACHABLE",
        message: (err as Error).message,
        target,
      });
      return;
    }

    res.status(upstream.status);
    const responseType = upstream.headers.get("content-type");
    if (responseType) res.setHeader("content-type", responseType);
    res.setHeader("cache-control", "no-store");
    const bodyBuf = Buffer.from(await upstream.arrayBuffer());
    res.send(bodyBuf);
  }
}