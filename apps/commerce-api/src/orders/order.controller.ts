import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { OrderService } from "./order.service.js";
import { QuickChargeDto, RequestInvoiceDto } from "./order.dto.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { roleHas } from "../auth/policies.js";
import { Public } from "../auth/guards/principal.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import { PaymentService } from "../payments/payment.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { WhatsAppService } from "../whatsapp/whatsapp.service.js";
import { randomBytes } from "node:crypto";

@Controller("orders")
@UseGuards(RoleGuard)
export class OrderController {
  private readonly logger = new Logger(OrderController.name);

  constructor(
    private readonly orders: OrderService,
    private readonly payments: PaymentService,
    private readonly prisma: PrismaService,
    private readonly wa: WhatsAppService,
  ) {}

  @Get()
  @RequireScopes("orders.read")
  async list(@Query("status") status?: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.orders.list(tenantId, status),
      requestId: RequestContext.requestId,
    };
  }

  @Get(":id")
  @RequireScopes("orders.read")
  async get(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.orders.get(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  @Post()
  @RequireScopes("orders.write")
  async createDirect(
    @Body()
    body: {
      customerId: string;
      lines: Array<{ variantId: string; quantity: string; discountPct?: number }>;
      notes?: string;
    },
  ) {
    const tenantId = this.requireTenant();
    const actorId = RequestContext.userId ?? null;
    return {
      data: await this.orders.createDirect(tenantId, actorId, body),
      requestId: RequestContext.requestId,
    };
  }

  /**
   * Cobro rápido. `idempotencyKey` viaja en el cuerpo (opcional; el panel
   * siempre la manda) y hace que reintentar el mismo cobro devuelva el pedido
   * original en lugar de crear un segundo cargo. El link de pago también se
   * reusa en el replay: emitir un token nuevo por cada reintento dejaría al
   * cliente con varios links vivos del mismo pedido.
   */
  @Post("quick-charge")
  @RequireScopes("orders.write")
  async quickCharge(@Body() body: QuickChargeDto) {
    const tenantId = this.requireTenant();
    const actorId = RequestContext.userId ?? null;
    const order = await this.orders.quickCharge(tenantId, { ...body, actorId });
    const expiresAt = order.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000);
    const currentRev = order.revisions[order.revisions.length - 1];
    const token = currentRev ? await this.reuseOrCreateAccessToken(currentRev.id, expiresAt) : null;
    return {
      data: { order, checkoutToken: token },
      requestId: RequestContext.requestId,
    };
  }

  @Post("from-quote/:quoteId")
  @RequireScopes("orders.write")
  async fromQuote(@Param("quoteId") quoteId: string) {
    const tenantId = this.requireTenant();
    const actorId = RequestContext.userId ?? null;
    const order = await this.orders.createFromQuote(tenantId, quoteId, actorId);

    // Solo cuando una persona del equipo acepta desde el panel (no cuando el
    // propio agente la acepta por WhatsApp: ahí el link ya va en su respuesta
    // del chat y mandarlo aquí también lo duplicaría).
    let checkoutLink: string | null = null;
    if (actorId) {
      checkoutLink = await this.autoCheckoutAndNotify(tenantId, order.id, quoteId);
    }

    return {
      data: { ...order, checkoutLink },
      requestId: RequestContext.requestId,
    };
  }

  /**
   * Al aceptar una cotización desde el panel, adelanta el checkout y avisa
   * al cliente por WhatsApp con el link de pago, en vez de dejar que el
   * pedido se quede en DRAFT esperando que alguien lo retome a mano.
   * Best-effort: si falla (sin stock, sin WhatsApp activo, etc.), el pedido
   * ya quedó creado igual y se puede cobrar manualmente desde su página.
   */
  private async autoCheckoutAndNotify(
    tenantId: string,
    orderId: string,
    quoteId: string,
  ): Promise<string | null> {
    try {
      const quote = await this.prisma.quote.findFirst({
        where: { id: quoteId, tenantId },
        include: { lines: true, customer: true },
      });
      if (!quote || quote.lines.length === 0) return null;

      const order = await this.orders.startCheckout(tenantId, orderId, {
        lines: quote.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity.toString(),
          discountPct: Number(l.discountPct),
        })),
        deliveryMode: "PICKUP",
      });
      const currentRev = order.revisions[order.revisions.length - 1];
      if (!currentRev) return null;
      const expiresAt = order.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000);
      const token = await this.createAccessToken(currentRev.id, expiresAt);
      const base = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
      const link = `${base}/checkout/${token}`;

      if (quote.customer.phone) {
        await this.wa.send(tenantId, {
          tenantId,
          to: quote.customer.phone,
          type: "text",
          body:
            `¡Tu cotización quedó aceptada! Aquí tu link para pagar en línea: ${link}\n` +
            "Se vence en unos minutos, así que complétalo cuanto antes.",
        });
      }
      return link;
    } catch (err) {
      this.logger.warn(`auto-checkout tras aceptar cotización ${quoteId} falló: ${err}`);
      return null;
    }
  }

  @Post(":id/checkout")
  @RequireScopes("orders.write")
  async startCheckout(
    @Param("id") id: string,
    @Body()
    body: {
      lines: Array<{ variantId: string; quantity: string; discountPct?: number }>;
      deliveryMode: "PICKUP" | "LOCAL_DELIVERY";
      addressId?: string;
    },
  ) {
    const tenantId = this.requireTenant();
    const order = await this.orders.startCheckout(tenantId, id, body);
    // Crear token de acceso público al checkout (envío por email/WhatsApp).
    const expiresAt = order.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000);
    const currentRev = order.revisions[order.revisions.length - 1];
    const token = currentRev ? await this.createAccessToken(currentRev.id, expiresAt) : null;
    return {
      data: { order, checkoutToken: token },
      requestId: RequestContext.requestId,
    };
  }

  /**
   * Reemite un link de pago para un pedido cuyo checkout ya está abierto
   * (CHECKOUT_OPEN/AWAITING_PAYMENT). No recalcula líneas ni total: reutiliza
   * la revisión vigente, solo emite un nuevo token de acceso público.
   */
  @Post(":id/checkout/resume")
  @RequireScopes("orders.write")
  async resumeCheckout(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    const { revisionId, expiresAt } = await this.orders.resumeCheckout(tenantId, id);
    const token = await this.createAccessToken(revisionId, expiresAt);
    return {
      data: { checkoutToken: token },
      requestId: RequestContext.requestId,
    };
  }

  /**
   * Devuelve el token de acceso vigente de la revisión (sin usar y sin vencer)
   * o emite uno nuevo. Solo lo usa el cobro rápido: la revisión de un cobro
   * recién creado nunca tiene tokens, así que reusar equivale exactamente a
   * "esta petición era un replay de una clave de idempotencia ya vista".
   */
  private async reuseOrCreateAccessToken(revisionId: string, expiresAt: Date): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = this.prisma as any;
    const existing = await prisma.checkoutAccessToken.findFirst({
      where: { revisionId, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: "desc" },
    });
    if (existing) return existing.token as string;
    return this.createAccessToken(revisionId, expiresAt);
  }

  private async createAccessToken(revisionId: string, expiresAt: Date): Promise<string> {
    const token = randomBytes(24).toString("base64url");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = this.prisma as any;
    await prisma.checkoutAccessToken.create({
      data: { revisionId, token, expiresAt },
    });
    return token;
  }

  @Patch(":id/invoice-request")
  @RequireScopes("orders.write")
  async requestInvoice(@Param("id") id: string, @Body() body: RequestInvoiceDto) {
    const tenantId = this.requireTenant();
    return {
      data: await this.orders.requestInvoice(tenantId, id, body),
      requestId: RequestContext.requestId,
    };
  }

  @Patch(":id/cancel")
  @RequireScopes("orders.cancel_own")
  async cancel(@Param("id") id: string, @Body() body: { reason?: string }) {
    const tenantId = this.requireTenant();
    const actorId = RequestContext.userId ?? null;
    const principal = RequestContext.principal;
    const canCancelAny =
      principal.type === "API_KEY"
        ? (principal.scopes ?? []).includes("orders.cancel_any")
        : roleHas((principal.role ?? "VIEWER") as string, "orders.cancel_any");
    return {
      data: await this.orders.cancel(tenantId, id, actorId, body.reason, {
        requireOwnership: !canCancelAny,
      }),
      requestId: RequestContext.requestId,
    };
  }

  // ---- Endpoints públicos ----

  @Public()
  @Get("public/:token")
  async publicView(@Param("token") token: string) {
    const resolved = await this.orders.resolvePublicToken(token);
    if (!resolved) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Link inválido o expirado" });
    }
    const { order, lines, revisionExpiresAt } = resolved;
    return {
      data: {
        id: order.id,
        status: order.status,
        subtotal: order.subtotal,
        discount: order.discount,
        tax: order.tax,
        shipping: order.shipping,
        total: order.total,
        currency: "MXN",
        livemode: false,
        expiresAt: order.expiresAt ?? revisionExpiresAt,
        merchant: order.tenant.name,
        customer: { fullName: order.customer.fullName },
        lines,
      },
      requestId: RequestContext.requestId,
    };
  }

  @Public()
  @Post("public/:token/checkout")
  async publicCheckout(
    @Param("token") token: string,
    @Res() res: Response,
  ) {
    const resolved = await this.orders.resolvePublicToken(token);
    if (!resolved) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Link inválido o expirado" });
    }
    const { order } = resolved;
    if (order.status !== "CHECKOUT_OPEN" && order.status !== "AWAITING_PAYMENT") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Pedido ${order.status} no aceptable`,
      });
    }
    // Para el endpoint público, no tenemos expectedVersion; usamos 0 y
    // confiamos en el state machine (CHECKOUT_OPEN/AWAITING_PAYMENT).
    const session = await this.payments.createCheckout({
      tenantId: order.tenantId,
      orderId: order.id,
      expectedOrderVersion: 0,
      amount: order.total.toString(),
      metadata: { source: "public_checkout" },
    });
    res.setHeader("Location", session.checkoutUrl);
    res.status(201).json({
      data: { sessionId: session.sessionId, checkoutUrl: session.checkoutUrl, expiresAt: session.expiresAt },
      requestId: RequestContext.requestId,
    });
  }

  /**
   * El cliente paga desde el link público de la cotización sin esperar a
   * que el asesor la apruebe: se acepta, se crea el pedido y se abre el
   * checkout. Si el checkout ya estaba abierto sólo se reemite el link.
   */
  @Public()
  @Post("public/quote/:shareToken/checkout")
  @HttpCode(201)
  async publicCheckoutFromQuote(@Param("shareToken") shareToken: string) {
    const { orderId, revisionId, expiresAt } = await this.orders.checkoutFromShareToken(shareToken);
    const token = await this.createAccessToken(revisionId, expiresAt);
    return {
      data: { orderId, checkoutToken: token, expiresAt },
      requestId: RequestContext.requestId,
    };
  }

  @Public()
  @Get("public/:token/result")
  async publicResult(@Param("token") token: string) {
    const resolved = await this.orders.resolvePublicToken(token);
    if (!resolved) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Link inválido o expirado" });
    }
    const { order } = resolved;
    return {
      data: {
        status:
          order.status === "PAID"
            ? "PAID"
            : order.status === "EXPIRED"
              ? "EXPIRED"
              : order.status === "CANCELLED"
                ? "CANCELLED"
                : "PENDING",
        orderId: order.id,
        total: order.total.toString(),
        livemode: false,
      },
      requestId: RequestContext.requestId,
    };
  }

  private requireTenant(): string {
    const t = RequestContext.tenantId;
    if (!t) throw new NotFoundException({ code: "UNAUTHORIZED", message: "Sin tenant" });
    return t;
  }
}