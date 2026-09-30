/**
 * Pedidos: create (direct o desde cotización), checkout, cancel, incidents.
 * Ver docs/08-ord.md T-ORD-01..06.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { PricingService } from "../pricing/pricing.service.js";
import { CustomerService } from "../customers/customer.service.js";
import { QuoteService } from "../quotes/quote.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { pickChannel } from "../notifications/pick-channel.js";
import { createHash } from "node:crypto";
import { assertPublicHttpUrl } from "../integrations/url-guard.js";
import { getOrCreateTrackingToken, trackingUrl } from "./tracking-token.js";
import { extractPdfText } from "../common/pdf-text.js";
import { parseConstancia } from "./constancia-parser.js";
import { writeObject } from "../tenants/logo-storage.js";
import { publicUrlForKey } from "../tenants/logo-storage.js";
import { RFC_RE, POSTAL_CODE_RE, REGIMEN_FISCAL_RE, CFDI_USE_RE } from "./order.dto.js";
import type { Paging } from "../common/pagination.js";

const MAX_CONSTANCIA_BYTES = 8 * 1024 * 1024; // 8 MB, de sobra para un PDF de 1-2 páginas.

/**
 * Formato aceptado para `amountTotal` en el cable: decimal simple, sin signo,
 * sin separador de miles y sin notación científica. Se valida con regex y no
 * con `Number()` porque `Number()` acepta " 116 ", "1e3" y "0x10", y convierte
 * "1,234.50" en `NaN` — un importe malformado tiene que rebotar con un mensaje,
 * no colarse coercionado. La precisión final la sigue fijando la columna
 * Decimal(12,2) vía `toFixed(2)`: aquí no se redondea distinto.
 */
const AMOUNT_TOTAL_RE = /^\d{1,10}(?:\.\d{1,6})?$/;
/** Tope de la columna Decimal(12, 2). */
const AMOUNT_TOTAL_MAX = 9_999_999_999.99;

/**
 * Valida y convierte `amountTotal`. Lanza 400 VALIDATION_FAILED con mensaje en
 * español ante cualquier cosa que no sea un decimal positivo.
 */
export function parseAmountTotal(raw: unknown): number {
  const invalid = () =>
    new BadRequestException({
      code: "VALIDATION_FAILED",
      message:
        "amountTotal inválido: usa un decimal positivo con punto, sin separador de miles ni notación científica (ej. 1234.50)",
    });

  if (typeof raw !== "string" || !AMOUNT_TOTAL_RE.test(raw)) throw invalid();
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw invalid();
  // Un importe que redondea a 0.00 en la columna es tan inválido como un 0.
  if (Math.round(value * 100) < 1) throw invalid();
  if (value > AMOUNT_TOTAL_MAX) {
    throw new BadRequestException({
      code: "VALIDATION_FAILED",
      message: "amountTotal excede el máximo permitido (9999999999.99)",
    });
  }
  return value;
}

/** Totales pactados en una cotización (columnas Decimal de `Quote`). */
export interface QuotedTotals {
  subtotal: { toFixed(dp: number): string };
  discount: { toFixed(dp: number): string };
  taxBase: { toFixed(dp: number): string };
  tax: { toFixed(dp: number): string };
  shipping: { toFixed(dp: number): string };
  total: { toFixed(dp: number): string };
}

function quotedTotalsToStrings(q: QuotedTotals) {
  return {
    subtotal: q.subtotal.toFixed(2),
    discount: q.discount.toFixed(2),
    taxBase: q.taxBase.toFixed(2),
    tax: q.tax.toFixed(2),
    shipping: q.shipping.toFixed(2),
    total: q.total.toFixed(2),
  };
}

/** Estados en los que el pedido ya se cobró: su link se sigue viendo (solo lectura) tras vencer. */
export const SETTLED_ORDER_STATUSES = ["PAID", "FULFILLED", "REFUNDED"] as const;

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly customers: CustomerService,
    private readonly quotes: QuoteService,
    private readonly notifications: NotificationService,
  ) {}

  private async notifyOrderReceived(order: {
    id: string;
    tenantId: string;
    customerId: string;
    total: { toString(): string };
  }): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { id: order.customerId } });
    const target = customer && pickChannel(customer);
    if (!target) return;
    // El aviso lleva el link de seguimiento desde el primer mensaje: es el
    // mismo link que después traen "pago confirmado" y "entregado", así el
    // cliente tiene un solo lugar donde ver su pedido. Best-effort.
    const link = await getOrCreateTrackingToken(this.prisma, order.id)
      .then(trackingUrl)
      .catch(() => "");
    await this.notifications.scheduleFromTemplate({
      tenantId: order.tenantId,
      recipientType: "CUSTOMER",
      recipientId: order.customerId,
      channel: target.channel,
      templateKey: "ORDER_RECEIVED",
      to: target.to,
      vars: { customerName: customer!.fullName, total: order.total.toString(), orderId: order.id.slice(0, 8), link },
    });
  }

  async list(tenantId: string, status: string | undefined, paging: Paging) {
    const where = { tenantId, ...(status ? { status: status as never } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        // Solo lo que pinta el listado. Antes venían TODAS las revisiones y
        // sesiones de pago de cada pedido (y la ficha completa del cliente):
        // varias filas extra por pedido que ningún consumidor del listado
        // usaba; el detalle (`get`) sigue trayéndolas.
        include: { customer: { select: { id: true, fullName: true, email: true, phone: true } } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: paging.limit,
        skip: paging.offset,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total };
  }

  async get(tenantId: string, id: string) {
    const o = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: {
        customer: true,
        revisions: { orderBy: { revisionNumber: "desc" }, include: { lines: true } },
        payments: { orderBy: { createdAt: "desc" }, include: { ledger: { orderBy: { recordedAt: "desc" } } } },
        quote: { select: { id: true, status: true, issuedAt: true, acceptedAt: true } },
      },
    });
    if (!o) throw new NotFoundException({ code: "NOT_FOUND", message: "Pedido no accesible" });

    // Las líneas viven en la revisión y solo guardan variantId+cantidad: sin
    // resolver la variante, el detalle de la venta no dice qué se vendió.
    const variantIds = [...new Set(o.revisions.flatMap((r) => r.lines.map((l) => l.variantId)))];
    const variants = variantIds.length
      ? await this.prisma.productVariant.findMany({
          where: { id: { in: variantIds }, tenantId },
          select: { id: true, sku: true, title: true, price: true, product: { select: { title: true } } },
        })
      : [];
    const byVariant = new Map(variants.map((v) => [v.id, v]));

    const revisions = o.revisions.map((r) => ({
      ...r,
      lines: r.lines.map((l) => {
        const variant = byVariant.get(l.variantId);
        const unitPrice = variant?.price ?? null;
        return {
          ...l,
          sku: variant?.sku ?? null,
          title: variant?.title ?? null,
          productTitle: variant?.product.title ?? null,
          unitPrice: unitPrice?.toString() ?? null,
          lineTotal:
            unitPrice != null ? (Number(unitPrice) * Number(l.quantity)).toFixed(2) : null,
        };
      }),
    }));

    const current = revisions.find((r) => r.id === o.currentRevisionId) ?? revisions[0] ?? null;
    return { ...o, revisions, lines: current?.lines ?? [] };
  }

  /**
   * Pide factura para un pedido con lo que ya se tenga a mano: si falta
   * RFC, razón social, código postal o régimen y viene `constanciaUrl`, la
   * descarga y la lee (`constancia-parser.ts`) para llenar los huecos antes
   * de exigir el dato a mano — subir la constancia de situación fiscal
   * basta, no hace falta dictar cada campo. `cfdiUse` siempre lo elige
   * quien factura (el documento del SAT no lo trae).
   *
   * Guarda un snapshot fiscal en el pedido (independiente de si el cliente
   * cambia sus datos después) y actualiza el "último dato fiscal conocido"
   * del cliente, para que la próxima vez el bot pueda ofrecer reusarlo.
   */
  async requestInvoice(
    tenantId: string,
    orderId: string,
    input: {
      rfc?: string;
      legalName?: string;
      postalCode?: string;
      regimenFiscal?: string;
      cfdiUse: string;
      constanciaUrl?: string;
      notes?: string;
    },
  ) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Pedido no accesible" });
    }

    let { rfc, legalName, postalCode, regimenFiscal } = input;
    let parseWarnings: string[] = [];
    if (input.constanciaUrl && (!rfc || !legalName || !postalCode || !regimenFiscal)) {
      const parsed = await this.tryParseConstanciaUrl(input.constanciaUrl);
      rfc ??= parsed?.rfc ?? undefined;
      legalName ??= parsed?.legalName ?? undefined;
      postalCode ??= parsed?.postalCode ?? undefined;
      regimenFiscal ??= parsed?.regimenFiscal ?? undefined;
      parseWarnings = parsed?.warnings ?? ["No se pudo leer la constancia adjunta"];
    }

    return this.applyInvoiceRequest(tenantId, order, {
      rfc,
      legalName,
      postalCode,
      regimenFiscal,
      cfdiUse: input.cfdiUse,
      constanciaUrl: input.constanciaUrl,
      notes: input.notes,
      parseWarnings,
    });
  }

  /**
   * Variante para SUBIR el PDF directo (checkout público, sin sesión): lee
   * el archivo, lo guarda (mismo storage que el logo del tenant — ver
   * `tenants/logo-storage.ts`), y aplica lo mismo que `requestInvoice`. Los
   * overrides (si el parser se equivocó en algo) ganan sobre lo leído.
   */
  async requestInvoiceFromFile(
    tenantId: string,
    orderId: string,
    file: { buffer: Buffer; mimetype?: string },
    overrides: {
      rfc?: string;
      legalName?: string;
      postalCode?: string;
      regimenFiscal?: string;
      cfdiUse: string;
      notes?: string;
    },
  ) {
    if (file.mimetype && file.mimetype !== "application/pdf") {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "La constancia debe ser un PDF",
      });
    }
    if (file.buffer.length > MAX_CONSTANCIA_BYTES) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "El PDF pesa más de 8 MB",
      });
    }
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Pedido no accesible" });
    }

    const text = await extractPdfText(file.buffer);
    const parsed = text ? parseConstancia(text) : null;
    const warnings = parsed?.warnings ?? ["No se pudo leer el texto del PDF (¿es una foto/escaneo?)"];

    const hash = createHash("sha256").update(file.buffer).digest("hex").slice(0, 16);
    const key = `orders/${tenantId}/${orderId}/constancia-${hash}.pdf`;
    await writeObject(key, file.buffer);
    const constanciaUrl = publicUrlForKey(key);

    return this.applyInvoiceRequest(tenantId, order, {
      rfc: overrides.rfc ?? parsed?.rfc ?? undefined,
      legalName: overrides.legalName ?? parsed?.legalName ?? undefined,
      postalCode: overrides.postalCode ?? parsed?.postalCode ?? undefined,
      regimenFiscal: overrides.regimenFiscal ?? parsed?.regimenFiscal ?? undefined,
      cfdiUse: overrides.cfdiUse,
      constanciaUrl,
      notes: overrides.notes,
      parseWarnings: warnings,
    });
  }

  /** Descarga y lee una constancia por URL; `null` si falla cualquier paso
   * (URL privada, no responde, PDF ilegible) — nunca lanza. */
  private async tryParseConstanciaUrl(
    url: string,
  ): Promise<ReturnType<typeof parseConstancia> | null> {
    try {
      const safe = await assertPublicHttpUrl(url);
      const res = await fetch(safe, { redirect: "manual", signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_CONSTANCIA_BYTES) return null;
      const text = await extractPdfText(buf);
      return text ? parseConstancia(text) : null;
    } catch {
      return null;
    }
  }

  /**
   * Núcleo compartido por `requestInvoice` y `requestInvoiceFromFile`:
   * valida lo que haya quedado tras leer la constancia (si aplicó) y
   * persiste. Si algo sigue faltando, el mensaje de error dice EXACTAMENTE
   * qué falta y si viene de una constancia que no se pudo leer bien.
   */
  private async applyInvoiceRequest(
    tenantId: string,
    order: { id: string; customerId: string },
    input: {
      rfc?: string;
      legalName?: string;
      postalCode?: string;
      regimenFiscal?: string;
      cfdiUse: string;
      constanciaUrl?: string;
      notes?: string;
      parseWarnings: string[];
    },
  ) {
    const missing: string[] = [];
    if (!input.rfc || !RFC_RE.test(input.rfc)) missing.push("RFC");
    if (!input.legalName || input.legalName.trim().length < 2) missing.push("razón social");
    if (!input.postalCode || !POSTAL_CODE_RE.test(input.postalCode)) missing.push("código postal");
    if (input.regimenFiscal && !REGIMEN_FISCAL_RE.test(input.regimenFiscal)) missing.push("régimen fiscal");
    if (!CFDI_USE_RE.test(input.cfdiUse)) missing.push("uso de CFDI");
    if (missing.length > 0) {
      const fromConstancia = input.constanciaUrl
        ? ` La constancia no trajo todo (${input.parseWarnings.join("; ") || "sin detalle"}).`
        : "";
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: `Falta(n): ${missing.join(", ")}.${fromConstancia} Sube una constancia legible o captúralo(s) a mano.`,
      });
    }

    const rfc = input.rfc!.toUpperCase();
    const legalName = input.legalName!.trim();
    const postalCode = input.postalCode!;
    const regimenFiscal = input.regimenFiscal ?? null;
    const cfdiUse = input.cfdiUse.toUpperCase();

    const [updated] = await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: order.id },
        data: {
          requiresInvoice: true,
          invoiceStatus: "DATA_COMPLETE",
          invoiceRfc: rfc,
          invoiceLegalName: legalName,
          invoicePostalCode: postalCode,
          invoiceRegimenFiscal: regimenFiscal,
          invoiceCfdiUse: cfdiUse,
          invoiceConstanciaUrl: input.constanciaUrl,
          invoiceNotes: input.notes,
          invoiceRequestedAt: new Date(),
        },
      }),
      this.prisma.customer.update({
        where: { id: order.customerId },
        data: {
          taxId: rfc,
          legalName,
          fiscalPostalCode: postalCode,
          fiscalRegimenFiscal: regimenFiscal,
          fiscalCfdiUse: cfdiUse,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          tenantId,
          actorId: null,
          action: "order.invoice_requested",
          targetType: "Order",
          targetId: order.id,
          metadata: { rfc, cfdiUse, fromConstancia: Boolean(input.constanciaUrl) },
        },
      }),
    ]);
    return { ...updated, parseWarnings: input.parseWarnings };
  }

  async createDirect(
    tenantId: string,
    actorId: string | null,
    input: {
      customerId: string;
      lines: Array<{ variantId: string; quantity: string; discountPct?: number }>;
      notes?: string;
    },
  ) {
    await this.customers.assertAccess(tenantId, input.customerId);
    const priced = await this.pricing.price(tenantId, input.lines);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant" });

    const order = await this.prisma.order.create({
      data: {
        tenantId,
        customerId: input.customerId,
        createdById: actorId,
        source: "DIRECT",
        status: "DRAFT",
        configVersion: tenant.configVersion,
        subtotal: priced.totals.subtotal,
        discount: priced.totals.discount,
        taxBase: priced.totals.taxBase,
        tax: priced.totals.tax,
        shipping: priced.totals.shipping,
        total: priced.totals.total,
        revisions: {
          create: {
            revisionNumber: 1,
            status: "OPEN",
            total: priced.totals.total,
            deliveryMode: "PICKUP",
            expiresAt: new Date(Date.now() + tenant.checkoutReservationMinutes * 60 * 1000),
          },
        },
      },
      include: { revisions: true },
    });
    await this.notifyOrderReceived(order);
    return order;
  }

  /**
   * Busca el pedido creado por una `idempotencyKey`. El índice único de
   * `Order.idempotencyKey` es global (no compuesto con `tenantId`), así que una
   * clave de otro tenant no se puede reusar ni se puede devolver: se contesta
   * 409 en vez de dejar que el insert reviente con un error crudo de Postgres.
   */
  private async findByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    const existing = await this.prisma.order.findUnique({
      where: { idempotencyKey },
      include: { revisions: true },
    });
    if (!existing) return null;
    if (existing.tenantId !== tenantId) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "La clave de idempotencia ya fue usada por otro cobro",
      });
    }
    return existing;
  }

  /**
   * "Cliente mostrador" del tenant. El upsert compite consigo mismo cuando dos
   * cobros sin cliente entran a la vez y el placeholder aún no existe: ahí
   * Postgres levanta P2002 y basta con releer el que ganó.
   */
  private async walkInCustomerId(tenantId: string): Promise<string> {
    const email = `walkin+${tenantId}@quickcharge.local`;
    try {
      const placeholder = await this.prisma.customer.upsert({
        where: { tenantId_email: { tenantId, email } },
        create: { tenantId, fullName: "Cliente mostrador", email },
        update: {},
      });
      return placeholder.id;
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
      const winner = await this.prisma.customer.findUnique({
        where: { tenantId_email: { tenantId, email } },
      });
      if (!winner) throw err;
      return winner.id;
    }
  }

  /**
   * T-QTE-07: cobro rápido. `amountTotal` es el total incluido (no subtotal);
   * el impuesto se extrae hacia atrás con la tasa del tenant. Cliente
   * opcional (usa un placeholder "Cliente mostrador" por tenant).
   *
   * Idempotente por `idempotencyKey` (opcional pero recomendada): repetir la
   * misma clave devuelve el pedido original sin crear un segundo cobro. La
   * garantía la da el índice único de `Order.idempotencyKey`, no la lectura
   * previa: dos peticiones simultáneas con la misma clave pasan las dos por el
   * `findByIdempotencyKey` inicial en vacío, una gana el insert y la otra
   * recibe P2002 y relee al ganador. El insert y el `currentRevisionId` van en
   * una sola transacción para que el perdedor nunca lea un pedido a medias.
   */
  async quickCharge(
    tenantId: string,
    input: {
      customerId?: string;
      description: string;
      amountTotal: string;
      idempotencyKey?: string;
      actorId?: string | null;
    },
  ) {
    const idempotencyKey = input.idempotencyKey?.trim() || undefined;
    if (idempotencyKey) {
      const replay = await this.findByIdempotencyKey(tenantId, idempotencyKey);
      if (replay) return replay;
    }

    // Antes de tocar la base: un importe malformado no debe llegar a crear el
    // cliente mostrador ni a coercionarse a NaN dentro del cálculo del IVA.
    const total = parseAmountTotal(input.amountTotal);

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant" });

    let customerId = input.customerId;
    if (customerId) {
      await this.customers.assertAccess(tenantId, customerId);
    } else {
      customerId = await this.walkInCustomerId(tenantId);
    }

    const taxRate = Number(tenant.taxRatePct);
    const base = Math.round((total / (1 + taxRate / 100)) * 100) / 100;
    const tax = Math.round((total - base) * 100) / 100;
    const expiresAt = new Date(Date.now() + tenant.checkoutReservationMinutes * 60 * 1000);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            tenantId,
            customerId,
            createdById: input.actorId ?? null,
            source: "QUICK_CHARGE",
            status: "CHECKOUT_OPEN",
            description: input.description,
            idempotencyKey,
            configVersion: tenant.configVersion,
            subtotal: base.toFixed(2),
            discount: "0.00",
            taxBase: base.toFixed(2),
            tax: tax.toFixed(2),
            shipping: "0.00",
            total: total.toFixed(2),
            checkoutRevision: 1,
            expiresAt,
            revisions: {
              create: {
                revisionNumber: 1,
                status: "OPEN",
                total: total.toFixed(2),
                deliveryMode: "PICKUP",
                expiresAt,
              },
            },
          },
          include: { revisions: true },
        });

        return tx.order.update({
          where: { id: created.id },
          data: { currentRevisionId: created.revisions[0]!.id },
          include: { revisions: true },
        });
      });
    } catch (err) {
      // Perdedor de la carrera: el índice único ya garantizó que solo se creó
      // un pedido; queda devolver el del ganador en vez de un 500 con el error
      // crudo de la restricción. Si no aparece, el P2002 era de otra cosa.
      if (idempotencyKey && (err as { code?: string }).code === "P2002") {
        const replay = await this.findByIdempotencyKey(tenantId, idempotencyKey);
        if (replay) return replay;
      }
      throw err;
    }
  }

  async createFromQuote(
    tenantId: string,
    quoteId: string,
    actorId: string | null = null,
    opts: { notify?: boolean } = {},
  ) {
    // Idempotente (AC-AIA-04): repetir la aceptación devuelve el mismo pedido.
    const existing = await this.prisma.order.findFirst({
      where: { tenantId, quoteId },
      include: { revisions: true },
    });
    if (existing) return existing;

    const q = await this.quotes.get(tenantId, quoteId);
    if (q.status !== "ISSUED" && q.status !== "ACCEPTED") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Quote en estado ${q.status} no se puede convertir`,
      });
    }
    if (q.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "Cotización vencida",
      });
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant" });

    // Aceptación y creación del pedido en UNA transacción. Antes se marcaba
    // ACCEPTED primero (fuera de transacción) y luego se insertaba el pedido:
    // si el insert fallaba, la cotización quedaba ACCEPTED sin pedido y ya no
    // se podía convertir nunca, porque `markAccepted` exige ISSUED. Ahora una
    // ACCEPTED huérfana también se convierte (solo se transiciona si sigue en
    // ISSUED), y `Order.quoteId` es único: dos aceptaciones simultáneas
    // dejan un solo pedido y la perdedora relee al ganador.
    let order: Awaited<ReturnType<typeof this.prisma.order.create>>;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        if (q.status === "ISSUED") {
          const moved = await tx.quote.updateMany({
            where: { id: q.id, tenantId, status: "ISSUED" },
            data: { status: "ACCEPTED", acceptedAt: new Date(), version: { increment: 1 } },
          });
          if (moved.count === 0) {
            // Otra transacción la movió mientras tanto. Si la aceptó (dos
            // aceptaciones a la vez), se sigue al insert y el índice único
            // de quoteId decide; si la canceló/venció, se rechaza.
            const now = await tx.quote.findFirst({ where: { id: q.id, tenantId }, select: { status: true } });
            if (now?.status !== "ACCEPTED") {
              throw new ConflictException({
                code: "CONFLICT",
                message: "La cotización cambió de estado; vuelve a cargarla",
              });
            }
          }
        }
        return tx.order.create({
          data: {
            tenantId,
            customerId: q.customerId,
            createdById: actorId,
            quoteId: q.id,
            source: "QUOTE",
            status: "DRAFT",
            configVersion: q.configVersion,
            subtotal: q.subtotal,
            discount: q.discount,
            taxBase: q.taxBase,
            tax: q.tax,
            shipping: q.shipping,
            total: q.total,
            revisions: {
              create: {
                revisionNumber: 1,
                status: "OPEN",
                total: q.total,
                deliveryMode: "PICKUP",
                expiresAt: new Date(Date.now() + tenant.checkoutReservationMinutes * 60 * 1000),
              },
            },
          },
        });
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        const winner = await this.prisma.order.findFirst({
          where: { tenantId, quoteId },
          include: { revisions: true },
        });
        if (winner) return winner;
      }
      throw err;
    }
    if (opts.notify !== false) {
      await this.notifyOrderReceived(order);
    }
    return order;
  }

  /**
   * Autoservicio del cliente desde el link público de la cotización: acepta
   * (si hace falta), crea el pedido y abre el checkout con las líneas de la
   * cotización. Idempotente sobre un checkout ya abierto: sólo extiende la
   * ventana (mismo comportamiento que "reenviar link de pago" del portal).
   * Devuelve lo necesario para emitir el token de acceso al checkout.
   */
  async checkoutFromShareToken(shareToken: string): Promise<{
    tenantId: string;
    orderId: string;
    revisionId: string;
    expiresAt: Date;
  }> {
    const q = await this.quotes.resolveShareToken(shareToken);
    if (!q) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Link inválido o expirado" });
    }
    const tenantId = q.tenantId;
    if (q.status === "CANCELLED" || q.status === "EXPIRED") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "La cotización ya no está disponible",
      });
    }
    if (q.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({ code: "RULE_VIOLATION", message: "Cotización vencida" });
    }
    const existing = q.order;
    if (existing) {
      if (["PAID", "FULFILLED", "REFUNDED"].includes(existing.status)) {
        throw new BadRequestException({
          code: "RULE_VIOLATION",
          message: "Esta cotización ya está pagada",
        });
      }
      if (existing.status === "CANCELLED" || existing.status === "EXPIRED") {
        throw new BadRequestException({
          code: "RULE_VIOLATION",
          message: "El pedido de esta cotización se cerró. Pide a tu asesor un link nuevo.",
        });
      }
      if (existing.status === "CHECKOUT_OPEN" || existing.status === "AWAITING_PAYMENT") {
        const resumed = await this.resumeCheckout(tenantId, existing.id);
        return { tenantId, orderId: existing.id, ...resumed };
      }
    }

    const order = existing ?? (await this.createFromQuote(tenantId, q.id, null));
    // Se cobra lo cotizado: las líneas reservan stock, pero los totales son
    // los de la cotización (antes se repreciaba con el catálogo vigente y el
    // cliente pagaba un total distinto del que aceptó).
    const opened = await this.startCheckout(
      tenantId,
      order.id,
      {
        lines: q.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity.toFixed(3),
          discountPct: Number(l.discountPct),
        })),
        deliveryMode: "PICKUP",
      },
      { quotedTotals: q },
    );
    const revision =
      opened.revisions.find((r) => r.id === opened.currentRevisionId) ??
      opened.revisions[opened.revisions.length - 1];
    if (!revision) {
      throw new BadRequestException({ code: "RULE_VIOLATION", message: "Pedido sin revisión" });
    }
    return {
      tenantId,
      orderId: order.id,
      revisionId: revision.id,
      expiresAt: opened.expiresAt ?? revision.expiresAt,
    };
  }

  /**
   * Totales de la cotización de origen si sigue vigente y el pedido lleva
   * exactamente sus mismas líneas (variante, cantidad, descuento); si no, null.
   */
  private async matchingQuotedTotals(
    tenantId: string,
    quoteId: string | null | undefined,
    lines: Array<{ variantId: string; quantity: string; discountPct?: number }>,
  ): Promise<QuotedTotals | null> {
    if (!quoteId) return null;
    const q = await this.prisma.quote.findFirst({
      where: { id: quoteId, tenantId },
      include: { lines: true },
    });
    if (!q || q.expiresAt.getTime() < Date.now()) return null;
    const key = (variantId: string, qty: string | number, disc: string | number) =>
      `${variantId}|${Number(qty).toFixed(3)}|${Number(disc ?? 0).toFixed(2)}`;
    const want = q.lines.map((l) => key(l.variantId, l.quantity.toString(), l.discountPct.toString())).sort();
    const got = lines.map((l) => key(l.variantId, l.quantity, l.discountPct ?? 0)).sort();
    if (want.length !== got.length || want.some((k, i) => k !== got[i])) return null;
    return q;
  }

  /**
   * Inicia checkout: reserva stock, crea OrderRevision si hay cambios,
   * transiciona a CHECKOUT_OPEN.
   *
   * `opts.quotedTotals`: pedido que viene de una cotización aceptada. Los
   * totales se toman tal cual de la cotización (precio pactado) en vez de
   * repreciar con el catálogo actual; las líneas solo reservan stock.
   */
  async startCheckout(
    tenantId: string,
    orderId: string,
    input: {
      lines: Array<{ variantId: string; quantity: string; discountPct?: number }>;
      deliveryMode: "PICKUP" | "LOCAL_DELIVERY";
      addressId?: string;
    },
    opts: { quotedTotals?: QuotedTotals } = {},
  ) {
    const o = await this.get(tenantId, orderId);
    if (o.status !== "DRAFT" && o.status !== "CHECKOUT_OPEN") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Pedido ${o.status} no puede iniciar checkout`,
      });
    }
    // Reintentar checkout (p. ej. cambiar líneas) no debe apilar reservas:
    // se libera lo reservado por la revisión vigente antes de reservar de nuevo.
    if (o.currentRevisionId) {
      await this.releaseRevisionStock(tenantId, o.currentRevisionId);
    }
    // Cualquier caller (panel, agente vía POST /orders/:id/checkout, link
    // público) cobra lo cotizado si el pedido viene de una cotización vigente
    // y las líneas son las mismas: la regla no puede depender de que cada
    // caller se acuerde de pasar `quotedTotals`. Si cambió el carrito o la
    // cotización venció, se reprecia (es otra venta).
    const quoted = opts.quotedTotals ?? (await this.matchingQuotedTotals(tenantId, o.quoteId, input.lines));
    const totals = quoted
      ? quotedTotalsToStrings(quoted)
      : (await this.pricing.price(tenantId, input.lines)).totals;
    if (quoted && input.lines.length === 0) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "Al menos una línea" });
    }
    const reserveResult = await this.pricing.reserveStock(tenantId, input.lines);
    if ("conflict" in reserveResult) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "Stock insuficiente",
        metadata: reserveResult.conflict,
      });
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant" });

    return this.prisma.$transaction(async (tx) => {
      // Calcular el siguiente revisionNumber basado en las revisiones existentes
      const existing = await tx.orderRevision.findMany({
        where: { orderId: o.id },
        orderBy: { revisionNumber: "desc" },
        take: 1,
        select: { revisionNumber: true },
      });
      const nextNumber = (existing[0]?.revisionNumber ?? 0) + 1;
      const newRev = await tx.orderRevision.create({
        data: {
          orderId: o.id,
          revisionNumber: nextNumber,
          status: "OPEN",
          total: totals.total,
          deliveryMode: input.deliveryMode,
          addressId: input.addressId,
          expiresAt: new Date(
            Date.now() + tenant.checkoutReservationMinutes * 60 * 1000,
          ),
          lines: {
            create: input.lines.map((l) => ({
              variantId: l.variantId,
              quantity: l.quantity,
            })),
          },
        },
      });
      const updated = await tx.order.update({
        where: { id: o.id },
        data: {
          status: "CHECKOUT_OPEN",
          checkoutRevision: nextNumber,
          currentRevisionId: newRev.id,
          subtotal: totals.subtotal,
          discount: totals.discount,
          taxBase: totals.taxBase,
          tax: totals.tax,
          shipping: totals.shipping,
          total: totals.total,
          expiresAt: newRev.expiresAt,
          version: { increment: 1 },
        },
        include: { revisions: true },
      });
      return updated;
    });
  }

  /**
   * Extiende la ventana de un checkout ya abierto (CHECKOUT_OPEN/AWAITING_PAYMENT)
   * para reemitir un link de pago. No repite reserveStock: la reserva ya existe.
   */
  async resumeCheckout(tenantId: string, orderId: string) {
    const o = await this.get(tenantId, orderId);
    if (o.status !== "CHECKOUT_OPEN" && o.status !== "AWAITING_PAYMENT") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Pedido ${o.status} no tiene checkout activo`,
      });
    }
    if (!o.currentRevisionId) {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "Pedido sin revisión de checkout vigente",
      });
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant" });

    const expiresAt = new Date(Date.now() + tenant.checkoutReservationMinutes * 60 * 1000);
    await this.prisma.order.update({
      where: { id: o.id },
      data: { expiresAt, version: { increment: 1 } },
    });
    return { revisionId: o.currentRevisionId, expiresAt };
  }

  /** Marca como pagado (llamado por el payment provider tras CAPTURED). */
  async markPaid(tenantId: string, orderId: string) {
    return this.prisma.order.updateMany({
      where: { id: orderId, tenantId, status: { in: ["CHECKOUT_OPEN", "AWAITING_PAYMENT"] } },
      data: { status: "PAID", paidAt: new Date(), version: { increment: 1 } },
    });
  }

  async cancel(
    tenantId: string,
    orderId: string,
    actorId: string | null,
    reason?: string,
    opts?: { requireOwnership?: boolean },
  ) {
    const o = await this.get(tenantId, orderId);
    if (opts?.requireOwnership && o.createdById !== actorId) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Solo puedes cancelar pedidos que tú creaste",
      });
    }
    if (o.status === "PAID" || o.status === "FULFILLED" || o.status === "REFUNDED") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Pedido ${o.status} no puede cancelarse desde aquí`,
      });
    }
    if (o.status === "CANCELLED" || o.status === "EXPIRED") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Pedido ya en estado ${o.status}`,
      });
    }
    if (o.currentRevisionId) {
      await this.releaseRevisionStock(tenantId, o.currentRevisionId);
    }
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId,
        action: "order.cancelled",
        targetType: "Order",
        targetId: orderId,
        metadata: { reason },
      },
    });
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        version: { increment: 1 },
      },
    });
  }

  async expireCheckout(tenantId: string, orderId: string) {
    const o = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        tenantId,
        status: { in: ["CHECKOUT_OPEN", "AWAITING_PAYMENT"] },
        expiresAt: { lt: new Date() },
      },
    });
    if (!o) return { count: 0 };
    if (o.currentRevisionId) {
      await this.releaseRevisionStock(tenantId, o.currentRevisionId);
    }
    return this.prisma.order.updateMany({
      where: { id: o.id, tenantId, version: o.version },
      data: { status: "EXPIRED", version: { increment: 1 } },
    });
  }

  /** Revierte a stock las líneas reservadas por una revisión de checkout. */
  private async releaseRevisionStock(tenantId: string, revisionId: string): Promise<void> {
    const lines = await this.prisma.orderRevisionLine.findMany({
      where: { revisionId },
      select: { variantId: true, quantity: true },
    });
    if (lines.length === 0) return;
    await this.pricing.releaseStock(
      tenantId,
      lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity.toString() })),
    );
  }

  async resolvePublicToken(token: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = this.prisma as any;
    const t = await prisma.checkoutAccessToken.findUnique({
      where: { token },
      include: {
        revision: {
          include: {
            order: { include: { customer: true, tenant: true } },
            lines: true,
          },
        },
      },
    });
    if (!t) return null;
    // Un pedido ya cobrado se sigue mostrando (solo lectura) aunque el link
    // haya vencido: antes el cliente que ya pagó veía "este enlace ya no
    // sirve". Para uno sin pagar, vencido/usado sigue siendo 404.
    const settled = (SETTLED_ORDER_STATUSES as readonly string[]).includes(t.revision.order.status);
    const expired = t.expiresAt.getTime() <= Date.now() || Boolean(t.usedAt);
    if (expired && !settled) return null;

    // Pedido de cotización: se muestra el precio pactado de cada línea (lo
    // que efectivamente se cobra), no el del catálogo de hoy.
    const quoteLines: Array<{ variantId: string; unitPrice: { toFixed(dp: number): string }; lineSubtotal: { toFixed(dp: number): string } }> =
      t.revision.order.quoteId
        ? await this.prisma.quoteLine.findMany({
            where: { quoteId: t.revision.order.quoteId },
            select: { variantId: true, unitPrice: true, lineSubtotal: true },
          })
        : [];
    const quotedByVariant = new Map(quoteLines.map((ql) => [ql.variantId, ql]));

    const variantIds = t.revision.lines.map((l: { variantId: string }) => l.variantId);
    // Precio y producto padre: el checkout público muestra el detalle de lo
    // que se paga sin sesión, así que todo lo que necesita viaja aquí.
    const variants = variantIds.length
      ? await this.prisma.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: {
            id: true,
            sku: true,
            title: true,
            price: true,
            product: {
              select: {
                id: true,
                sku: true,
                title: true,
                description: true,
                variants: {
                  where: { status: "ACTIVE" },
                  select: { id: true, sku: true, title: true, price: true, stock: true },
                  orderBy: { price: "asc" },
                },
              },
            },
          },
        })
      : [];
    const lines = t.revision.lines.map((l: { variantId: string; quantity: { toString(): string } }) => {
      const v = variants.find((x) => x.id === l.variantId);
      const quoted = quotedByVariant.get(l.variantId);
      const qty = Number(l.quantity.toString());
      const unitPrice = v ? Number(v.price) : null;
      return {
        variantId: l.variantId,
        sku: v?.sku ?? l.variantId.slice(0, 8),
        title: v?.title ?? "Producto",
        quantity: l.quantity.toString(),
        unitPrice: quoted ? quoted.unitPrice.toFixed(2) : unitPrice != null ? unitPrice.toFixed(2) : null,
        lineTotal: quoted
          ? quoted.lineSubtotal.toFixed(2)
          : unitPrice != null && Number.isFinite(qty)
            ? (unitPrice * qty).toFixed(2)
            : null,
        product: v
          ? {
              id: v.product.id,
              sku: v.product.sku,
              title: v.product.title,
              description: v.product.description,
              variants: v.product.variants.map((pv) => ({
                id: pv.id,
                sku: pv.sku,
                title: pv.title,
                price: pv.price.toFixed(2),
                stock: pv.stock == null ? null : pv.stock.toString(),
              })),
            }
          : null,
      };
    });

    return {
      order: t.revision.order,
      lines,
      revisionExpiresAt: t.revision.expiresAt,
      /** true = link vencido de un pedido ya cobrado: solo lectura, no se puede volver a pagar. */
      readOnly: expired,
    };
  }

  /**
   * Token público y duradero de seguimiento (ver modelo OrderTrackingToken).
   * Mint-once: si el pedido ya tiene uno, se reusa el mismo link siempre —
   * generar uno nuevo cada vez invalidaría el que el cliente ya guardó.
   */
  async getOrCreateTrackingToken(tenantId: string, orderId: string): Promise<string> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Pedido no accesible" });
    }
    return getOrCreateTrackingToken(this.prisma, orderId);
  }

  /**
   * Número de WhatsApp del negocio (conexión ACTIVE con número conocido),
   * normalizado a dígitos para armar `https://wa.me/<n>`. Best-effort: sin
   * conexión o ante cualquier error devuelve null. Lo usan el checkout
   * público y el link de seguimiento ("Escribir al negocio").
   */
  async merchantWhatsappNumber(tenantId: string): Promise<string | null> {
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
    } catch {
      return null;
    }
  }

  /**
   * Resuelve el link público de seguimiento. A diferencia de
   * resolvePublicToken (CheckoutAccessToken), este no vence ni se marca usado.
   *
   * Lista blanca explícita: es una URL portadora que el cliente reenvía. No
   * sale el id interno del pedido (solo el folio de 8 caracteres que ya usan
   * los avisos de WhatsApp), ni email/teléfono del cliente, ni ids de
   * variante. Sí sale lo que el cliente necesita para saber en qué va su
   * pedido: etapa, fechas, qué lleva y cuánto, cómo se entrega, si ya pagó
   * (o el link para pagar), y cómo contactar al negocio.
   */
  async resolveTrackingToken(token: string) {
    const t = await this.prisma.orderTrackingToken.findUnique({
      where: { token },
      include: {
        order: {
          include: {
            customer: { select: { fullName: true } },
            tenant: { select: { name: true, logoUrl: true, primaryColor: true } },
            revisionsRel: { include: { lines: true } },
            payments: {
              where: { status: { not: "CANCELLED" } },
              orderBy: { createdAt: "desc" },
              select: {
                status: true,
                amount: true,
                refundedTotal: true,
                paymentMethod: true,
                capturedAt: true,
                expiresAt: true,
              },
            },
          },
        },
      },
    });
    if (!t) return null;
    const order = t.order;
    const revision = order.revisionsRel;
    const revisionLines = revision?.lines ?? [];

    // Precio unitario: el pactado en la cotización si el pedido viene de una;
    // si no, el del catálogo. Igual que el checkout público.
    const [variants, quoteLines, address] = await Promise.all([
      revisionLines.length
        ? this.prisma.productVariant.findMany({
            where: { id: { in: revisionLines.map((l) => l.variantId) } },
            select: { id: true, sku: true, title: true, price: true, product: { select: { title: true } } },
          })
        : Promise.resolve([]),
      order.quoteId
        ? this.prisma.quoteLine.findMany({
            where: { quoteId: order.quoteId },
            select: { variantId: true, unitPrice: true, lineSubtotal: true },
          })
        : Promise.resolve([]),
      revision?.deliveryMode === "LOCAL_DELIVERY" && revision.addressId
        ? this.prisma.customerAddress.findFirst({
            where: { id: revision.addressId, customerId: order.customerId },
            select: { label: true, line1: true, line2: true, city: true, state: true, postalCode: true },
          })
        : Promise.resolve(null),
    ]);
    const byVariant = new Map(variants.map((v) => [v.id, v]));
    const quotedByVariant = new Map(quoteLines.map((q) => [q.variantId, q]));

    let lines = revisionLines.map((l, i) => {
      const v = byVariant.get(l.variantId);
      const quoted = quotedByVariant.get(l.variantId);
      const qty = Number(l.quantity.toString());
      const unitPrice = quoted ? quoted.unitPrice : (v?.price ?? null);
      return {
        key: `line-${i}`,
        sku: v?.sku ?? null,
        title: v ? (v.product.title === v.title ? v.title : `${v.product.title} — ${v.title}`) : "Producto",
        quantity: l.quantity.toString(),
        unitPrice: unitPrice ? unitPrice.toFixed(2) : null,
        lineTotal: quoted
          ? quoted.lineSubtotal.toFixed(2)
          : unitPrice && Number.isFinite(qty)
            ? unitPrice.mul(l.quantity).toFixed(2)
            : null,
      };
    });
    // Cobro rápido: no hay líneas, el concepto es la descripción.
    if (lines.length === 0 && order.description) {
      lines = [
        {
          key: "line-0",
          sku: null,
          title: order.description,
          quantity: "1",
          unitPrice: order.subtotal.toFixed(2),
          lineTotal: order.subtotal.toFixed(2),
        },
      ];
    }

    // Último intento de pago (sin las sesiones reemplazadas) y acumulado
    // reembolsado sobre las cobradas, para que la página diga "reembolso
    // parcial" cuando aplica aunque el pedido siga PAID.
    const last = order.payments[0] ?? null;
    const refunded = order.payments
      .filter((p) => ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status))
      .reduce((acc, p) => acc.add(p.refundedTotal), new Prisma.Decimal(0));
    const captured = order.payments.find((p) =>
      ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status),
    );

    const payable = order.status === "CHECKOUT_OPEN" || order.status === "AWAITING_PAYMENT";
    const checkoutToken = payable
      ? await this.quotes.activeCheckoutToken({
          status: order.status,
          currentRevisionId: order.currentRevisionId,
          expiresAt: order.expiresAt,
        })
      : null;

    return {
      folio: order.id.slice(0, 8).toUpperCase(),
      status: order.status,
      source: order.source,
      currency: "MXN",
      livemode: false,
      subtotal: order.subtotal.toFixed(2),
      discount: order.discount.toFixed(2),
      tax: order.tax.toFixed(2),
      shipping: order.shipping.toFixed(2),
      total: order.total.toFixed(2),
      merchant: {
        name: order.tenant.name,
        logoUrl: order.tenant.logoUrl ?? null,
        primaryColor: order.tenant.primaryColor ?? null,
      },
      customer: { fullName: order.customer.fullName },
      lines,
      delivery: revision
        ? {
            mode: revision.deliveryMode,
            address: address
              ? {
                  label: address.label,
                  line1: address.line1,
                  line2: address.line2,
                  city: address.city,
                  state: address.state,
                  postalCode: address.postalCode,
                }
              : null,
          }
        : null,
      payment: {
        /** Resultado del último intento: PENDING | CAPTURED | FAILED | null. */
        lastStatus: last
          ? last.status === "PENDING"
            ? last.expiresAt.getTime() > Date.now()
              ? "PENDING"
              : null
            : ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "AUTHORIZED"].includes(last.status)
              ? "CAPTURED"
              : last.status === "FAILED"
                ? "FAILED"
                : null
          : null,
        method: captured?.paymentMethod ?? null,
        capturedAt: captured?.capturedAt ?? order.paidAt,
        refundedTotal: refunded.toFixed(2),
        /** Link de pago vigente para "Pagar ahora"; null si no hay checkout abierto. */
        checkoutToken,
        checkoutExpiresAt: checkoutToken ? order.expiresAt : null,
      },
      timeline: {
        createdAt: order.createdAt,
        placedAt: order.placedAt,
        paidAt: order.paidAt,
        fulfilledAt: order.fulfilledAt,
        cancelledAt: order.cancelledAt,
        updatedAt: order.updatedAt,
      },
    };
  }

  /**
   * Marca un pedido pagado como entregado/completado. Único avance manual de
   * estado que existe hoy (el resto lo maneja el pago o la cancelación): el
   * enum no tiene etapas intermedias (preparando, enviado) — ver
   * docs/ARCHITECTURE si se necesita ese detalle más fino.
   */
  async fulfill(tenantId: string, orderId: string, actorId: string | null) {
    const o = await this.get(tenantId, orderId);
    if (o.status !== "PAID") {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Pedido ${o.status} no se puede marcar como entregado (debe estar PAID)`,
      });
    }
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId,
        action: "order.fulfilled",
        targetType: "Order",
        targetId: orderId,
      },
    });
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: "FULFILLED", fulfilledAt: new Date(), version: { increment: 1 } },
    });
    const trackingLink = await this.notifyFulfilled(tenantId, updated);
    return { order: updated, trackingLink };
  }

  /**
   * Avisa al cliente que su pedido quedó entregado/completado, con su link
   * de seguimiento (se genera aquí si todavía no existe). Best-effort: si
   * falla, el pedido ya quedó marcado igual — se puede reenviar el link a
   * mano desde GET :id/tracking-link.
   */
  private async notifyFulfilled(
    tenantId: string,
    order: { id: string; customerId: string; total: { toString(): string } },
  ): Promise<string | null> {
    const token = await this.getOrCreateTrackingToken(tenantId, order.id);
    const link = trackingUrl(token);
    const customer = await this.prisma.customer.findUnique({ where: { id: order.customerId } });
    const target = customer && pickChannel(customer);
    if (target) {
      await this.notifications.scheduleFromTemplate({
        tenantId,
        recipientType: "CUSTOMER",
        recipientId: order.customerId,
        channel: target.channel,
        templateKey: "ORDER_FULFILLED",
        to: target.to,
        vars: { customerName: customer!.fullName, orderId: order.id.slice(0, 8), link },
      });
    }
    return link;
  }
}