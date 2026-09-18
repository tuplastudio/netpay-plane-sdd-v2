import {
  All,
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
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
  private readonly logger = new Logger(PaymentController.name);

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
   * Proxy al dummy-gateway para servir el checkout hosted desde el navegador
   * del cliente. La pasarela no está expuesta al público, así que commerce-api
   * (misma red de Docker) hace de relay:
   *   /pay/checkout/<id>/hosted → /api/v1/payments/dummy-proxy/checkout/<id>/hosted
   *                             → http://dummy-gateway:4100/checkout/<id>/hosted
   *
   * Es `@Public()` porque la página hosted no requiere sesión, y por eso
   * mismo NO es un proxy abierto: solo pasan las rutas que esa página usa
   * (ver `DUMMY_PROXY_ALLOWLIST`) y nunca se inyecta la service key. Crear
   * sesiones (`POST /checkout/sessions`) sigue siendo servidor-a-servidor.
   */
  @Public()
  @All("dummy-proxy/**")
  async dummyProxy(@Req() req: Request, @Res() res: Response): Promise<void> {
    const base = (process.env.DUMMY_BASE_URL ?? "http://localhost:4100").replace(/\/$/, "");
    const rest = req.path.replace(/^\/api\/v1\/payments\/dummy-proxy/, "");
    if (!isAllowedDummyProxyPath(req.method, rest)) {
      res.status(404).json({ code: "NOT_FOUND", message: "Ruta no disponible" });
      return;
    }
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const target = `${base}${rest}${qs}`;
    this.logger.debug(`[dummy-proxy] ${req.method} ${req.path} → ${target}`);

    const headers = new Headers();
    const incomingType = req.headers["content-type"];
    if (incomingType) headers.set("content-type", incomingType);
    // El gateway comprime respuestas grandes y el relay las reenvía crudas:
    // pedimos identidad para no tener que descomprimir.
    headers.set("accept-encoding", "identity");

    // `bodyParser.raw` (main.ts) deja el cuerpo como Buffer; el `json()`
    // global lo deja como objeto. Se reserializa lo que haya.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (req as any).body;
    const body =
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : Buffer.isBuffer(raw)
          ? raw
          : typeof raw === "string"
            ? raw
            : raw && typeof raw === "object" && Object.keys(raw).length > 0
              ? JSON.stringify(raw)
              : undefined;

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(target, { method: req.method, headers, body });
    } catch (err) {
      res.status(502).json({
        code: "DUMMY_UNREACHABLE",
        message: (err as Error).message,
      });
      return;
    }

    res.status(upstream.status);
    const responseType = upstream.headers.get("content-type");
    if (responseType) res.setHeader("content-type", responseType);
    const csp = upstream.headers.get("content-security-policy");
    if (csp) res.setHeader("content-security-policy", csp);
    res.setHeader("cache-control", "no-store");
    const bodyBuf = Buffer.from(await upstream.arrayBuffer());
    res.send(bodyBuf);
  }
}

/**
 * Rutas del gateway que la página hosted necesita desde el navegador. Todo lo
 * demás (crear sesiones, healthz, consultar sesiones ajenas) queda fuera.
 */
const DUMMY_PROXY_ALLOWLIST: Array<{ method: "GET" | "POST"; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/checkout\/[a-f0-9]{32}\/hosted\/?$/ },
  { method: "POST", pattern: /^\/checkout\/sessions\/[a-f0-9]{32}\/(capture|fail)\/?$/ },
];

export function isAllowedDummyProxyPath(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  const effective = upper === "HEAD" ? "GET" : upper;
  return DUMMY_PROXY_ALLOWLIST.some((rule) => rule.method === effective && rule.pattern.test(path));
}
