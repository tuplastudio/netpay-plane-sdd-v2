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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { Response } from "express";
import { OrderService, SETTLED_ORDER_STATUSES } from "./order.service.js";
import { ConstanciaUploadInterceptor } from "./constancia-upload.interceptor.js";
import {
  CancelOrderDto,
  CreateOrderDto,
  QuickChargeDto,
  RequestInvoiceDto,
  StartCheckoutDto,
} from "./order.dto.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { roleHas } from "../auth/policies.js";
import { Public } from "../auth/guards/principal.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import { PaymentService } from "../payments/payment.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { pickChannel } from "../notifications/pick-channel.js";
import { randomBytes } from "node:crypto";

@Controller("orders")
@UseGuards(RoleGuard)
export class OrderController {
  private readonly logger = new Logger(OrderController.name);

  constructor(
    private readonly orders: OrderService,
    private readonly payments: PaymentService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
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
  async createDirect(@Body() body: CreateOrderDto) {
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
    // `include: { revisions: true }` no garantiza orden: se toma la revisión
    // que startCheckout acaba de dejar como vigente, no la última del array.
    const currentRev =
      order.revisions.find((r) => r.id === order.currentRevisionId) ??
      order.revisions[order.revisions.length - 1];
    const token = currentRev ? await this.reuseOrCreateAccessToken(currentRev.id, expiresAt) : null;
    return {
      data: { order, checkoutToken: token, checkoutLink: token ? this.checkoutLink(token) : null },
      requestId: RequestContext.requestId,
    };
  }

  /**
   * El token por sí solo no es un link usable: quien lo llama (panel, MCP,
   * un agente) tendría que conocer de memoria `PUBLIC_BASE_URL` y la ruta
   * `/checkout/:token` para armarlo. Se arma aquí, una sola vez, igual que
   * ya hace `autoCheckoutAndNotify` para el mensaje de WhatsApp.
   */
  private checkoutLink(token: string): string {
    const base = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    return `${base}/checkout/${token}`;
  }

  @Post("from-quote/:quoteId")
  @RequireScopes("orders.write")
  async fromQuote(@Param("quoteId") quoteId: string) {
    const tenantId = this.requireTenant();
    const actorId = RequestContext.userId ?? null;
    // Sin actor = el agente de WhatsApp: ya le dijo al cliente todo en su
    // propia respuesta (cotización, enlace de pago, PDF); el "recibimos tu
    // pedido" del dispatcher horas después solo confunde a quien pidió una
    // cotización. Desde el panel o la página pública sí se notifica.
    const order = await this.orders.createFromQuote(tenantId, quoteId, actorId, {
      notify: Boolean(actorId),
    });

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

      // Totales de la cotización, no repreciados: se cobra lo cotizado.
      const order = await this.orders.startCheckout(
        tenantId,
        orderId,
        {
          lines: quote.lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity.toString(),
            discountPct: Number(l.discountPct),
          })),
          deliveryMode: "PICKUP",
        },
        { quotedTotals: quote },
      );
      // `include: { revisions: true }` no garantiza orden: se toma la revisión
    // que startCheckout acaba de dejar como vigente, no la última del array.
    const currentRev =
      order.revisions.find((r) => r.id === order.currentRevisionId) ??
      order.revisions[order.revisions.length - 1];
      if (!currentRev) return null;
      const expiresAt = order.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000);
      const token = await this.createAccessToken(currentRev.id, expiresAt);
      const link = this.checkoutLink(token);

      // Va por NotificationService, no por `wa.send` directo: es un mensaje
      // que inicia el negocio, así que tiene que pasar por el opt-out del
      // cliente, el horario local y la ventana de servicio de 24 h de Meta.
      // Además el texto ya no promete "unos minutos": la vigencia del link
      // la fija el negocio (`checkoutReservationMinutes`).
      const target = pickChannel(quote.customer);
      if (target) {
        await this.notifications.scheduleFromTemplate({
          tenantId,
          recipientType: "CUSTOMER",
          recipientId: quote.customerId,
          channel: target.channel,
          templateKey: "REMINDER",
          to: target.to,
          vars: {
            customerName: quote.customer.fullName,
            total: quote.total.toFixed(2),
            link,
          },
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
  async startCheckout(@Param("id") id: string, @Body() body: StartCheckoutDto) {
    const tenantId = this.requireTenant();
    const order = await this.orders.startCheckout(tenantId, id, body);
    // Crear token de acceso público al checkout (envío por email/WhatsApp).
    const expiresAt = order.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000);
    // `include: { revisions: true }` no garantiza orden: se toma la revisión
    // que startCheckout acaba de dejar como vigente, no la última del array.
    const currentRev =
      order.revisions.find((r) => r.id === order.currentRevisionId) ??
      order.revisions[order.revisions.length - 1];
    const token = currentRev ? await this.createAccessToken(currentRev.id, expiresAt) : null;
    return {
      data: { order, checkoutToken: token, checkoutLink: token ? this.checkoutLink(token) : null },
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
      data: { checkoutToken: token, checkoutLink: this.checkoutLink(token) },
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
  async cancel(@Param("id") id: string, @Body() body: CancelOrderDto) {
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

  /**
   * Marca un pedido pagado como entregado/completado y avisa al cliente con
   * su link de seguimiento (se genera aquí si todavía no existe). Único
   * avance manual de estado disponible hoy: el enum no tiene etapas
   * intermedias de envío.
   */
  @Post(":id/fulfill")
  @RequireScopes("orders.write")
  async fulfill(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    const actorId = RequestContext.userId ?? null;
    const { order, trackingLink } = await this.orders.fulfill(tenantId, id, actorId);
    return {
      data: { ...order, trackingLink },
      requestId: RequestContext.requestId,
    };
  }

  /**
   * Link de seguimiento del pedido (se genera si no existe). Lo usa el
   * panel para copiarlo/reenviarlo a mano además del aviso automático que
   * ya manda `fulfill`.
   */
  @Get(":id/tracking-link")
  @RequireScopes("orders.read")
  async trackingLink(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    const token = await this.orders.getOrCreateTrackingToken(tenantId, id);
    const base = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    return {
      data: { token, link: `${base}/orders/public/track/${token}` },
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
    const { order, lines, revisionExpiresAt, readOnly } = resolved;
    const settled = (SETTLED_ORDER_STATUSES as readonly string[]).includes(order.status);
    const [lastPaymentStatus, whatsappNumber, trackingToken] = await Promise.all([
      this.payments.lastPaymentStatus(order.id),
      this.merchantWhatsappNumber(order.tenantId),
      settled
        ? this.orders.getOrCreateTrackingToken(order.tenantId, order.id).catch((err) => {
            this.logger.warn(`tracking token no disponible para ${order.id}: ${err}`);
            return null;
          })
        : Promise.resolve(null),
    ]);
    const email: string | null = order.customer.email ?? null;
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
        /** Link vencido de un pedido ya cobrado: se muestra, no se paga. */
        readOnly,
        /** Resultado del último intento de pago: "PENDING" | "CAPTURED" | "FAILED" | null. */
        lastPaymentStatus,
        /** WhatsApp del negocio (solo dígitos) para "Volver a WhatsApp"; null si no hay conexión activa. */
        whatsappNumber,
        hasCustomerEmail: Boolean(email && !email.endsWith("@quickcharge.local")),
        trackingToken,
        trackingUrl: trackingToken ? this.trackingUrl(trackingToken) : null,
      },
      requestId: RequestContext.requestId,
    };
  }

  private trackingUrl(token: string): string {
    const base = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    return `${base}/orders/public/track/${token}`;
  }

  /**
   * Número de WhatsApp del negocio (conexión ACTIVE con número conocido),
   * normalizado a dígitos para armar `https://wa.me/<n>`. Best-effort: sin
   * conexión o ante cualquier error devuelve null.
   */
  private async merchantWhatsappNumber(tenantId: string): Promise<string | null> {
    try {
      const conn = await this.prisma.whatsAppConnection.findFirst({
        where: { tenantId, status: "ACTIVE", phoneNumber: { not: null } },
        orderBy: { connectedAt: "desc" },
        select: { phoneNumber: true },
      });
      // Evolution puede guardar un JID ("5215512345678@s.whatsapp.net"):
      // solo la parte antes de "@" / ":".
      const digits = (conn?.phoneNumber ?? "").split(/[@:]/)[0]!.replace(/\D/g, "");
      return digits.length >= 8 ? digits : null;
    } catch (err) {
      this.logger.warn(`whatsapp del negocio no disponible para ${tenantId}: ${err}`);
      return null;
    }
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
    const { order, readOnly } = resolved;
    if (readOnly || (order.status !== "CHECKOUT_OPEN" && order.status !== "AWAITING_PAYMENT")) {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Pedido ${order.status} no aceptable`,
      });
    }
    // Reusa la sesión PENDING vigente del pedido (mismo link de la pasarela)
    // en vez de abrir otra por cada clic en "Pagar ahora"; si hay que crear
    // una, `createCheckout` cancela las anteriores. La versión es la que se
    // acaba de leer: si el pedido cambió entre medio, 409.
    const session = await this.payments.getOrCreateCheckout({
      tenantId: order.tenantId,
      orderId: order.id,
      expectedOrderVersion: order.version,
      amount: order.total.toFixed(2),
      metadata: { source: "public_checkout" },
    });
    // Sin `Location`: el navegador sigue el JSON (`checkoutUrl`), y un 201
    // con Location pierde el cuerpo al pasar por el proxy de Vercel.
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

  /**
   * Seguimiento público y duradero del pedido (no vence, a diferencia del
   * link de pago): estado, líneas y timeline (creado/pagado/entregado o
   * cancelado). Lo trae el aviso automático de pago y de entrega.
   */
  @Public()
  @Get("public/track/:token")
  async publicTracking(@Param("token") token: string) {
    const resolved = await this.orders.resolveTrackingToken(token);
    if (!resolved) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Link inválido" });
    }
    return { data: resolved, requestId: RequestContext.requestId };
  }

  @Public()
  @Get("public/:token/result")
  async publicResult(@Param("token") token: string) {
    const resolved = await this.orders.resolvePublicToken(token);
    if (!resolved) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Link inválido o expirado" });
    }
    const { order } = resolved;
    // FULFILLED es un pedido pagado (y entregado); REFUNDED se informa tal
    // cual. Antes ambos caían en "PENDING" y la página invitaba a pagar de nuevo.
    const status: "PAID" | "FULFILLED" | "REFUNDED" | "EXPIRED" | "CANCELLED" | "PENDING" =
      order.status === "PAID" ||
      order.status === "FULFILLED" ||
      order.status === "REFUNDED" ||
      order.status === "EXPIRED" ||
      order.status === "CANCELLED"
        ? order.status
        : "PENDING";
    return {
      data: {
        status,
        orderId: order.id,
        total: order.total.toString(),
        livemode: false,
      },
      requestId: RequestContext.requestId,
    };
  }

  /**
   * Pide factura desde el checkout público, sin sesión: sube la constancia
   * de situación fiscal (PDF, campo `file`) y con eso basta — RFC, razón
   * social, código postal y régimen se leen de ahí. `cfdiUse` es el único
   * campo que SIEMPRE hay que mandar (el documento no lo trae). `file` es
   * opcional: sin él, hay que mandar `rfc`/`legalName`/`postalCode` a mano
   * (mismo mensaje de error que dice qué falta).
   */
  @Public()
  @Post("public/:token/invoice")
  @UseInterceptors(ConstanciaUploadInterceptor)
  async publicRequestInvoice(
    @Param("token") token: string,
    @Body() body: Record<string, string | undefined>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const resolved = await this.orders.resolvePublicToken(token);
    if (!resolved) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Link inválido o expirado" });
    }
    const cfdiUse = (body.cfdiUse ?? "").trim();
    if (!cfdiUse) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Falta uso de CFDI" });
    }
    const overrides = {
      rfc: body.rfc?.trim() || undefined,
      legalName: body.legalName?.trim() || undefined,
      postalCode: body.postalCode?.trim() || undefined,
      regimenFiscal: body.regimenFiscal?.trim() || undefined,
      cfdiUse,
      notes: body.notes?.trim() || undefined,
    };
    const { order } = resolved;
    const data = file
      ? await this.orders.requestInvoiceFromFile(order.tenantId, order.id, file, overrides)
      : await this.orders.requestInvoice(order.tenantId, order.id, overrides);
    return { data, requestId: RequestContext.requestId };
  }

  private requireTenant(): string {
    const t = RequestContext.tenantId;
    if (!t) throw new NotFoundException({ code: "UNAUTHORIZED", message: "Sin tenant" });
    return t;
  }
}