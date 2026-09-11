/**
 * PaymentProvider abstraction. Único proveedor en V2: DUMMY.
 * Ver docs/09-pay.md T-PAY-01..07.
 *
 * Esta capa orquesta:
 *   1. Llamada HTTP al gateway dummy con API key de servicio.
 *   2. Recepción de webhooks firmados.
 *   3. Ledger de movimientos (CHARGE/REFUND/FEE/ADJUSTMENT).
 *   4. Transiciones de CheckoutSession.
 *
 * Restricciones V2 (ADR-005): PAYMENT_PROVIDER=DUMMY único. Cualquier
 * cambio en start.ts bloquea el arranque.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { pickChannel } from "../notifications/pick-channel.js";
import { decideRefund, parseMoney, remainingRefundable, ZERO } from "./refund-math.js";

/**
 * Secreto HMAC del webhook del gateway dummy.
 *
 * Los despliegues definen `DUMMY_WEBHOOK_SECRET_REF` (ver .env / .env.example),
 * que es la convención del repo para secretos — la misma que usa
 * PrincipalGuard con AGENT_INTERNAL_KEY_REF. El código leía SOLO
 * `DUMMY_WEBHOOK_SECRET`, que no lo define nadie, así que caía siempre al
 * literal "dev-webhook-secret" que está commiteado: cualquiera podía firmar un
 * webhook válido y marcar como PAGADA la orden de cualquier empresa.
 * `validateStartupConfig()` ahora exige el secreto fuera de local.
 */
function dummyWebhookSecret(): string {
  return (
    process.env.DUMMY_WEBHOOK_SECRET_REF ??
    process.env.DUMMY_WEBHOOK_SECRET ??
    "dev-webhook-secret"
  );
}

export interface CreateCheckoutInput {
  tenantId: string;
  orderId: string;
  expectedOrderVersion: number;
  amount: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSessionResult {
  sessionId: string;
  checkoutUrl: string;
  expiresAt: Date;
}

/**
 * Lo que la página hosted del gateway necesita para parecerse a un checkout
 * real. Todo es presentación: el importe que se cobra sigue siendo `amount`.
 */
export interface CheckoutPresentation {
  merchantName: string;
  customer: { fullName: string; email?: string };
  requiresInvoice: boolean;
  /** Factura pedida o entrega a domicilio: la dirección de facturación es obligatoria. */
  billingRequired: boolean;
  lineItems: Array<{ title: string; quantity: string; unitPrice: string | null }>;
  totals: { subtotal: string; discount: string; tax: string; shipping: string; total: string };
  successUrl?: string;
  cancelUrl?: string;
}

/** Dirección de facturación capturada en la página hosted (llega por webhook). */
export interface WebhookBilling {
  name: string;
  rfc?: string;
  street: string;
  neighborhood?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface WebhookCard {
  brand: string;
  last4: string;
  holder?: string;
}

interface WebhookExtras {
  billing?: WebhookBilling;
  card?: WebhookCard;
  email?: string;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  private async notifyPaymentResult(
    orderId: string,
    tenantId: string,
    templateKey: "PAYMENT_SIMULATED_SUCCESS" | "PAYMENT_SIMULATED_FAILED",
    total: string,
  ): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true },
    });
    const target = order && pickChannel(order.customer);
    if (!order || !target) return;
    await this.notifications.scheduleFromTemplate({
      tenantId,
      recipientType: "CUSTOMER",
      recipientId: order.customerId,
      channel: target.channel,
      templateKey,
      to: target.to,
      vars: { customerName: order.customer.fullName, total },
    });
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSessionResult> {
    // Verifica que el pedido esté en estado correcto. Se traen comercio,
    // cliente y revisión vigente porque la página hosted del gateway los
    // muestra (nombre del comercio, líneas, totales) y decide con ellos si
    // la dirección de facturación es obligatoria.
    const order = await this.prisma.order.findFirst({
      where: { id: input.orderId, tenantId: input.tenantId },
      include: {
        tenant: { select: { name: true } },
        customer: { select: { fullName: true, email: true } },
        revisions: { orderBy: { revisionNumber: "desc" }, take: 1, include: { lines: true } },
      },
    });
    if (!order) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Pedido no accesible" });
    }
    if (input.expectedOrderVersion !== 0 && order.version !== input.expectedOrderVersion) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "Versión del pedido desactualizada",
      });
    }
    const presentation = await this.buildCheckoutPresentation(order);

    // `baseUrl` es la dirección servidor-a-servidor (p. ej. dentro de Docker,
    // "http://dummy-gateway:4100"). `publicBaseUrl` es lo que el navegador
    // del cliente puede resolver (p. ej. "http://localhost:4100") — casi
    // siempre son el mismo host fuera de contenedores, pero no dentro.
    const baseUrl = process.env.DUMMY_BASE_URL ?? "http://localhost:4100";
    const publicBaseUrl = process.env.DUMMY_PUBLIC_URL ?? baseUrl;
    const apiKey = process.env.DUMMY_SERVICE_KEY ?? "npk_test_local";
    const webhookSecret = dummyWebhookSecret();
    // Dirección propia alcanzable por el dummy-gateway para el callback del
    // webhook — NUNCA la URL pública del navegador (dentro de Docker
    // "http://commerce-api:4000" ≠ "http://localhost:3001").
    const selfUrl = process.env.API_SELF_URL ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:4000";

    // Llama al dummy para crear la sesión.
    const res = await fetch(`${baseUrl}/checkout/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        amount: input.amount,
        currency: "MXN",
        orderId: input.orderId,
        // `metadata` sigue siendo Record<string,string> (contrato original);
        // lo estructurado (líneas, totales, cliente) va en campos propios.
        metadata: {
          ...(input.metadata ?? {}),
          merchantName: presentation.merchantName,
          requiresInvoice: String(presentation.requiresInvoice),
          billingRequired: String(presentation.billingRequired),
        },
        webhookUrl: `${selfUrl}/api/v1/payments/webhook`,
        secret: webhookSecret,
        ...presentation,
      }),
    });
    if (!res.ok) {
      this.logger.error(`Dummy createCheckout failed: ${res.status}`);
      throw new BadRequestException({
        code: "DEPENDENCY_UNAVAILABLE",
        message: "Pasarela no disponible",
      });
    }
    const body = (await res.json()) as { data: { id: string; hostedUrl: string; expiresAt: string } };
    const expiresAt = new Date(body.data.expiresAt);

    // Persistir CheckoutSession con referencia al dummy.
    const session = await this.prisma.checkoutSession.create({
      data: {
        tenantId: input.tenantId,
        orderId: input.orderId,
        amount: input.amount,
        status: "PENDING",
        expiresAt,
        capturedAt: null,
      },
    });

    await this.prisma.order.update({
      where: { id: input.orderId },
      data: { status: "AWAITING_PAYMENT" },
    });

    return {
      sessionId: session.id,
      checkoutUrl: `${publicBaseUrl}${body.data.hostedUrl}`,
      expiresAt,
    };
  }

  /**
   * Arma comercio, cliente, líneas, totales y URLs de retorno para la página
   * hosted. Los precios salen de la variante (las líneas de revisión solo
   * guardan variantId+quantity); un cobro rápido sin líneas se presenta como
   * una sola línea con su concepto.
   */
  private async buildCheckoutPresentation(order: {
    id: string;
    tenantId: string;
    currentRevisionId: string | null;
    description: string | null;
    requiresInvoice: boolean;
    subtotal: Prisma.Decimal;
    discount: Prisma.Decimal;
    tax: Prisma.Decimal;
    shipping: Prisma.Decimal;
    total: Prisma.Decimal;
    tenant: { name: string };
    customer: { fullName: string; email: string | null };
    revisions: Array<{
      id: string;
      deliveryMode: string;
      lines: Array<{ variantId: string; quantity: Prisma.Decimal }>;
    }>;
  }): Promise<CheckoutPresentation> {
    const latest = order.revisions[0] ?? null;
    const current =
      order.currentRevisionId && order.currentRevisionId !== latest?.id
        ? await this.prisma.orderRevision.findUnique({
            where: { id: order.currentRevisionId },
            include: { lines: true },
          })
        : latest;

    const variantIds = current?.lines.map((l) => l.variantId) ?? [];
    const variants = variantIds.length
      ? await this.prisma.productVariant.findMany({
          where: { id: { in: variantIds }, tenantId: order.tenantId },
          select: { id: true, title: true, price: true, product: { select: { title: true } } },
        })
      : [];
    const byVariant = new Map(variants.map((v) => [v.id, v]));

    let lineItems = (current?.lines ?? []).map((l) => {
      const v = byVariant.get(l.variantId);
      return {
        title: v?.title ?? v?.product.title ?? "Producto",
        quantity: l.quantity.toString(),
        unitPrice: v?.price.toFixed(2) ?? null,
      };
    });
    if (lineItems.length === 0 && order.description) {
      lineItems = [{ title: order.description, quantity: "1", unitPrice: order.subtotal.toFixed(2) }];
    }

    // Token público vigente de la revisión: es el mismo que el navegador usa
    // en /checkout/<token>, así que las URLs de retorno vuelven a esa página.
    const token = current
      ? await this.prisma.checkoutAccessToken.findFirst({
          where: { revisionId: current.id, usedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          select: { token: true },
        })
      : null;
    const webBase = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

    return {
      merchantName: order.tenant.name,
      customer: {
        fullName: order.customer.fullName,
        ...(order.customer.email ? { email: order.customer.email } : {}),
      },
      requiresInvoice: order.requiresInvoice,
      billingRequired: order.requiresInvoice || current?.deliveryMode === "LOCAL_DELIVERY",
      lineItems,
      totals: {
        subtotal: order.subtotal.toFixed(2),
        discount: order.discount.toFixed(2),
        tax: order.tax.toFixed(2),
        shipping: order.shipping.toFixed(2),
        total: order.total.toFixed(2),
      },
      ...(token
        ? {
            successUrl: `${webBase}/checkout/${token.token}/gracias`,
            cancelUrl: `${webBase}/checkout/${token.token}`,
          }
        : {}),
    };
  }

  /** Recibe y verifica webhook firmado por el dummy. */
  async handleWebhook(rawBody: string, signature: string | undefined): Promise<void> {
    const secret = dummyWebhookSecret();
    if (!signature) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Firma requerida" });
    }
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (expected.length !== signature.length) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Firma inválida" });
    }
    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Firma inválida" });
    }
    const event = JSON.parse(rawBody) as {
      sessionId?: string;
      orderId?: string;
      amount?: string;
      status?: string;
      eventName?: string;
      billing?: Partial<WebhookBilling>;
      card?: Partial<WebhookCard>;
      email?: string;
    };
    if (!event.sessionId || !event.orderId) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Payload incompleto" });
    }
    await this.applyStatus(event.sessionId, event.orderId, event.status ?? "PENDING", event.amount, {
      billing: this.parseWebhookBilling(event.billing),
      card: this.parseWebhookCard(event.card),
      email: typeof event.email === "string" && event.email.trim() ? event.email.trim() : undefined,
    });
  }

  private parseWebhookBilling(raw: Partial<WebhookBilling> | undefined): WebhookBilling | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const billing: WebhookBilling = {
      name: str(raw.name),
      street: str(raw.street),
      city: str(raw.city, 120),
      state: str(raw.state, 120),
      postalCode: str(raw.postalCode, 10),
      country: str(raw.country, 2).toUpperCase() || "MX",
    };
    const rfc = str(raw.rfc, 13).toUpperCase();
    if (rfc) billing.rfc = rfc;
    const neighborhood = str(raw.neighborhood);
    if (neighborhood) billing.neighborhood = neighborhood;
    // Sin nombre ni calle no hay nada que guardar.
    return billing.name || billing.street ? billing : undefined;
  }

  private parseWebhookCard(raw: Partial<WebhookCard> | undefined): WebhookCard | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const last4 = typeof raw.last4 === "string" ? raw.last4.replace(/\D/g, "").slice(-4) : "";
    if (last4.length !== 4) return undefined;
    return {
      brand: typeof raw.brand === "string" && raw.brand ? raw.brand.slice(0, 20) : "unknown",
      last4,
      ...(typeof raw.holder === "string" && raw.holder.trim() ? { holder: raw.holder.trim().slice(0, 120) } : {}),
    };
  }

  /** "Visa •••• 4242" para descripciones de ledger; nunca el PAN completo. */
  private describeCard(card: WebhookCard | undefined): string {
    if (!card) return "";
    const label =
      card.brand === "visa" ? "Visa" : card.brand === "mastercard" ? "Mastercard" : card.brand === "amex" ? "Amex" : "Tarjeta";
    return ` · ${label} •••• ${card.last4}`;
  }

  /**
   * Cambios sobre el pedido con la dirección de facturación que capturó la
   * página hosted. Snapshot fiscal (`invoiceRfc`/`invoiceLegalName`/
   * `invoicePostalCode`) solo cuando se pidió factura y el campo está vacío:
   * lo que el asesor ya capturó manda. La dirección completa se anexa a
   * `invoiceNotes` (no hay columna JSON en CheckoutSession), sin duplicar si
   * el webhook se reintenta.
   */
  private billingOrderData(
    order: {
      requiresInvoice: boolean;
      invoiceStatus: string;
      invoiceRfc: string | null;
      invoiceLegalName: string | null;
      invoicePostalCode: string | null;
      invoiceCfdiUse: string | null;
      invoiceNotes: string | null;
    },
    billing: WebhookBilling | undefined,
    dummySessionId: string,
  ): Prisma.OrderUpdateInput {
    if (!billing) return {};
    const data: Prisma.OrderUpdateInput = {};

    if (order.requiresInvoice) {
      if (!order.invoiceRfc && billing.rfc) data.invoiceRfc = billing.rfc;
      if (!order.invoiceLegalName && billing.name) data.invoiceLegalName = billing.name;
      if (!order.invoicePostalCode && billing.postalCode) data.invoicePostalCode = billing.postalCode;
      const complete =
        (order.invoiceRfc || data.invoiceRfc) &&
        (order.invoiceLegalName || data.invoiceLegalName) &&
        (order.invoicePostalCode || data.invoicePostalCode) &&
        order.invoiceCfdiUse;
      if (complete && order.invoiceStatus === "REQUESTED") data.invoiceStatus = "DATA_COMPLETE";
    }

    const marker = `[checkout ${dummySessionId}]`;
    if (!(order.invoiceNotes ?? "").includes(marker)) {
      const address = [
        billing.street,
        billing.neighborhood,
        [billing.postalCode, billing.city].filter(Boolean).join(" "),
        billing.state,
        billing.country,
      ]
        .filter(Boolean)
        .join(", ");
      const line =
        `Dirección de facturación ${marker}: ${billing.name}` +
        (billing.rfc ? ` (RFC ${billing.rfc})` : "") +
        ` — ${address}`;
      data.invoiceNotes = order.invoiceNotes ? `${order.invoiceNotes}\n${line}` : line;
    }
    return data;
  }

  private async applyStatus(
    dummySessionId: string,
    orderId: string,
    rawStatus: string,
    amount?: string,
    extras: WebhookExtras = {},
  ) {
    this.logger.log(
      `applyStatus called dummy=${dummySessionId} order=${orderId} status=${rawStatus}`,
    );
    // dummySessionId es el id del gateway (32 hex). En nuestra BD
    // guardamos por orderId + amount (más fácil porque el cliente
    // no recibe el id externo; lo gestiona internamente).
    const order = await this.prisma.order.findFirst({ where: { id: orderId } });
    if (!order) {
      this.logger.warn(`Webhook para order ${orderId} no encontrada`);
      return;
    }

    const upper = rawStatus.toUpperCase();

    // Un reembolso del gateway no llega nunca sobre una sesión PENDING: cae
    // sobre la que ya se cobró. Antes se buscaba igualmente por PENDING, así
    // que este webhook no encontraba sesión y no hacía nada; ahora entra por
    // la misma máquina de estados que `refund()` y por tanto sí puede dejar
    // la sesión en PARTIALLY_REFUNDED.
    if (upper === "REFUNDED") {
      const captured = await this.prisma.checkoutSession.findFirst({
        where: { orderId, status: { in: ["CAPTURED", "PARTIALLY_REFUNDED"] } },
        orderBy: { createdAt: "desc" },
      });
      if (!captured) {
        this.logger.warn(`Webhook de reembolso sin sesión cobrada para order ${orderId}`);
        return;
      }
      const remaining = remainingRefundable(captured.amount, captured.refundedTotal);
      const requested = parseMoney(amount) ?? remaining;
      const toRefund = requested.greaterThan(remaining) ? remaining : requested;
      if (toRefund.lessThanOrEqualTo(ZERO)) {
        this.logger.warn(`Webhook de reembolso sin saldo pendiente en sesión ${captured.id}`);
        return;
      }
      await this.refund(
        captured.tenantId,
        captured.id,
        toRefund.toFixed(2),
        `Reembolso simulado: dummy session ${dummySessionId}`,
      );
      return;
    }

    const session = await this.prisma.checkoutSession.findFirst({
      where: { orderId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    if (!session) {
      this.logger.warn(`Webhook sin sesión pendiente para order ${orderId}`);
      return;
    }
    this.logger.log(`applyStatus found session=${session.id}`);

    if (upper === "CAPTURED" || upper === "AUTHORIZED") {
      await this.prisma.$transaction(async (tx) => {
        await tx.checkoutSession.update({
          where: { id: session.id },
          data: { status: "CAPTURED", capturedAt: new Date(), version: { increment: 1 } },
        });
        await tx.ledgerEntry.create({
          data: {
            tenantId: session.tenantId,
            sessionId: session.id,
            entryType: "CHARGE",
            amount: amount ?? session.amount.toString(),
            balanceAfter: amount ?? session.amount.toString(),
            description: `Pago simulado: dummy session ${dummySessionId}${this.describeCard(extras.card)}`,
          },
        });
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: "PAID",
            paidAt: new Date(),
            version: { increment: 1 },
            ...this.billingOrderData(order, extras.billing, dummySessionId),
          },
        });
      });
      this.logger.log(`Order ${orderId} PAID via dummy ${dummySessionId}`);
      await this.notifyPaymentResult(
        orderId,
        session.tenantId,
        "PAYMENT_SIMULATED_SUCCESS",
        amount ?? session.amount.toString(),
      );
    } else if (upper === "FAILED") {
      await this.prisma.checkoutSession.update({
        where: { id: session.id },
        data: { status: "FAILED", failedAt: new Date(), version: { increment: 1 } },
      });
      await this.notifyPaymentResult(
        orderId,
        session.tenantId,
        "PAYMENT_SIMULATED_FAILED",
        amount ?? session.amount.toString(),
      );
    }
  }

  /**
   * Registra un reembolso (total o parcial) contra una sesión cobrada.
   *
   * Máquina de estados (única en el sistema, ver `refund-math.ts`):
   *
   *   CAPTURED | PARTIALLY_REFUNDED  --refund-->
   *       refundedTotal + monto <  amount  →  PARTIALLY_REFUNDED
   *       refundedTotal + monto == amount  →  REFUNDED
   *       refundedTotal + monto >  amount  →  rechazado (RULE_VIOLATION)
   *
   * `amount` de la sesión NUNCA se modifica: el bruto cobrado sigue siendo
   * recuperable después del reembolso.
   *
   * CONCURRENCIA. La comprobación "¿me paso del importe?" y la escritura del
   * acumulado son **una sola sentencia UPDATE** con la condición en el WHERE
   * (`"refundedTotal" + monto <= "amount"`). Postgres toma el lock de fila al
   * actualizar; bajo READ COMMITTED la segunda transacción que llega se
   * bloquea, y al despertar reevalúa su WHERE contra la versión ya
   * actualizada (EvalPlanQual). Dos reembolsos que se pisen NO pueden pasar
   * los dos: el segundo no encuentra fila y se rechaza. No hace falta
   * SERIALIZABLE ni un SELECT ... FOR UPDATE previo, y no hay ventana entre
   * leer y escribir.
   *
   * El asiento del ledger y el cambio de estado del pedido van en la MISMA
   * transacción que el UPDATE, así que `Σ LedgerEntry(REFUND)` y
   * `CheckoutSession.refundedTotal` no pueden divergir.
   */
  async refund(tenantId: string, sessionId: string, amount: string, reason: string) {
    const refundAmount = parseMoney(amount);
    if (!refundAmount || refundAmount.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "El monto a reembolsar debe ser un importe positivo con hasta 2 decimales",
      });
    }
    const money = refundAmount.toFixed(2);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.$queryRaw<
        Array<{
          id: string;
          orderId: string;
          amount: Prisma.Decimal;
          refundedTotal: Prisma.Decimal;
          status: string;
        }>
      >(Prisma.sql`
        UPDATE "CheckoutSession"
           SET "refundedTotal" = "refundedTotal" + ${money}::decimal(12,2),
               "status" = CASE
                 WHEN "refundedTotal" + ${money}::decimal(12,2) >= "amount"
                   THEN 'REFUNDED'::"PaymentStatus"
                 ELSE 'PARTIALLY_REFUNDED'::"PaymentStatus"
               END,
               "version" = "version" + 1,
               "updatedAt" = now()
         WHERE "id" = ${sessionId}::uuid
           AND "tenantId" = ${tenantId}::uuid
           AND "status" IN ('CAPTURED'::"PaymentStatus", 'PARTIALLY_REFUNDED'::"PaymentStatus")
           AND "refundedTotal" + ${money}::decimal(12,2) <= "amount"
        RETURNING "id", "orderId", "amount", "refundedTotal", "status"
      `);

      // Sin fila: o la sesión no es de este tenant, o su estado no admite
      // reembolso, o el acumulado se pasaría. Se relee para poder decir cuál
      // de las tres, sin que el diagnóstico afecte a la garantía de arriba.
      if (updated.length === 0) {
        await this.explainRefundRejection(tx, tenantId, sessionId, refundAmount);
      }

      const row = updated[0]!;
      const netTotal = row.amount.minus(row.refundedTotal);

      await tx.ledgerEntry.create({
        data: {
          tenantId,
          sessionId,
          entryType: "REFUND",
          amount: money,
          // Saldo vivo de la sesión tras el movimiento, coherente con el
          // asiento CHARGE (antes se escribía "0.00" fijo, que mentía en
          // cuanto el reembolso era parcial).
          balanceAfter: netTotal.toFixed(2),
          description: reason,
        },
      });

      // El pedido solo pasa a REFUNDED cuando la sesión queda saldada por
      // completo; con un reembolso parcial sigue siendo un pedido pagado.
      if (row.status === "REFUNDED") {
        await tx.order.updateMany({
          where: { id: row.orderId, tenantId, status: "PAID" },
          data: { status: "REFUNDED", version: { increment: 1 } },
        });
      }

      return {
        ok: true,
        sessionId: row.id,
        status: row.status,
        amount: row.amount.toFixed(2),
        refundedTotal: row.refundedTotal.toFixed(2),
        netTotal: netTotal.toFixed(2),
      };
    });
  }

  /**
   * Traduce un UPDATE condicional que no afectó a ninguna fila en el error
   * concreto. Siempre lanza. Se separa para que `refund()` se lea como el
   * camino feliz que es.
   */
  private async explainRefundRejection(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sessionId: string,
    refundAmount: Prisma.Decimal,
  ): Promise<never> {
    const session = await tx.checkoutSession.findFirst({
      where: { id: sessionId, tenantId },
      select: { status: true, amount: true, refundedTotal: true },
    });
    if (!session) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Sesión no accesible" });
    }
    const decision = decideRefund({
      status: session.status,
      amount: session.amount,
      refundedTotal: session.refundedTotal,
      refund: refundAmount,
    });
    if (!decision.ok && decision.reason === "EXCEEDS_AMOUNT") {
      const remaining = remainingRefundable(session.amount, session.refundedTotal);
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message:
          `El reembolso excede lo cobrado: quedan ${remaining.toFixed(2)} ` +
          `de ${session.amount.toFixed(2)} por reembolsar`,
      });
    }
    throw new BadRequestException({
      code: "RULE_VIOLATION",
      message: `Sesión en estado ${session.status} no permite reembolso`,
    });
  }

  async listSessions(tenantId: string) {
    const sessions = await this.prisma.checkoutSession.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const orderIds = [...new Set(sessions.map((s) => s.orderId))];
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: { customer: true },
    });
    const byId = new Map(orders.map((o) => [o.id, o]));
    return sessions.map((s) => ({
      ...s,
      customerName: byId.get(s.orderId)?.customer.fullName ?? null,
    }));
  }

  /** Detalle de una sesión de pago: pedido, cliente, qué se vendió y su ledger. */
  async getSession(tenantId: string, id: string) {
    const session = await this.prisma.checkoutSession.findFirst({
      where: { id, tenantId },
      include: {
        ledger: { orderBy: { recordedAt: "asc" } },
        order: {
          include: {
            customer: true,
            revisions: {
              orderBy: { revisionNumber: "desc" },
              take: 1,
              include: { lines: true },
            },
          },
        },
      },
    });
    if (!session) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Sesión de pago no accesible" });
    }

    const revision = session.order.revisions[0] ?? null;
    const variantIds = revision?.lines.map((l) => l.variantId) ?? [];
    const variants = variantIds.length
      ? await this.prisma.productVariant.findMany({
          where: { id: { in: variantIds }, tenantId },
          select: { id: true, sku: true, title: true, price: true, product: { select: { title: true } } },
        })
      : [];
    const byVariant = new Map(variants.map((v) => [v.id, v]));

    // Aritmética exacta con `Decimal`, nunca `Number(...)`: estos importes son
    // `Decimal(12,2)` y sumarlos en punto flotante hace aparecer y desaparecer
    // centavos (0.1 + 0.2 = 0.30000000000000004).
    //
    // El acumulado sale de la columna `refundedTotal` de la propia sesión, que
    // `refund()` escribe en la misma transacción que el asiento del ledger: es
    // el mismo número que sumar los REFUND del ledger, pero acotado por la
    // invariante 0 <= refundedTotal <= amount, así que `netTotal` nunca es
    // negativo.
    const refunded = session.refundedTotal;
    const netTotal = session.amount.minus(refunded);

    return {
      ...session,
      refundedTotal: refunded.toFixed(2),
      netTotal: netTotal.toFixed(2),
      lines: (revision?.lines ?? []).map((l) => {
        const variant = byVariant.get(l.variantId);
        const unitPrice = variant?.price ?? null;
        return {
          variantId: l.variantId,
          quantity: l.quantity.toString(),
          sku: variant?.sku ?? null,
          title: variant?.title ?? null,
          productTitle: variant?.product.title ?? null,
          unitPrice: unitPrice?.toString() ?? null,
          lineTotal: unitPrice != null ? unitPrice.mul(l.quantity).toFixed(2) : null,
        };
      }),
    };
  }

  async getLedger(tenantId: string, sessionId?: string) {
    return this.prisma.ledgerEntry.findMany({
      where: { tenantId, ...(sessionId ? { sessionId } : {}) },
      orderBy: { recordedAt: "desc" },
      take: 100,
    });
  }
}