/**
 * CRM: clientes, direcciones, identidades (WhatsApp), consentimientos.
 * Ver docs/06-crm.md T-CRM-01..05.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { Prisma, type Customer } from "@prisma/client";
import type { Paging } from "../common/pagination.js";
import { domainEvents } from "../hooks/domain-event-bus.js";
import { customerEventData } from "../hooks/event-data.js";
import {
  PAID_ORDER_STATUSES,
  PENDING_ORDER_STATUSES,
  csvCell,
  normalizeTags,
} from "./customer-profile.service.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tope de filas de la exportación CSV. */
const EXPORT_MAX_ROWS = 5000;

export interface CustomerListFilters {
  q?: string;
  includeArchived?: boolean;
  /** Etiqueta exacta (se normaliza en minúsculas). */
  tag?: string;
  /** Solo clientes con al menos un pedido esperando pago. */
  hasPendingPayment?: boolean;
}

/** Cifras de por vida que acompañan a cada fila del listado. */
export interface CustomerListStats {
  totalPaid: string;
  paidOrdersCount: number;
  lastPurchaseAt: string | null;
  pendingPaymentsCount: number;
}

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  private listWhere(tenantId: string, filters: CustomerListFilters): Prisma.CustomerWhereInput {
    const q = filters.q?.trim();
    return {
      tenantId,
      ...(filters.includeArchived ? {} : { status: "ACTIVE" }),
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { taxId: { contains: q, mode: "insensitive" } },
              { legalName: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(filters.tag ? { tags: { has: filters.tag.trim().toLowerCase() } } : {}),
      ...(filters.hasPendingPayment
        ? { orders: { some: { status: PENDING_ORDER_STATUSES } } }
        : {}),
    };
  }

  /**
   * Cifras de por vida por cliente para el listado (última compra, total
   * pagado, cobros pendientes). Dos `groupBy` sobre los ids de la página en
   * vez de un `include` de todos los pedidos: la fila no carga el historial.
   */
  private async listStats(
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, CustomerListStats>> {
    const stats = new Map<string, CustomerListStats>();
    if (ids.length === 0) return stats;
    for (const id of ids) {
      stats.set(id, {
        totalPaid: "0.00",
        paidOrdersCount: 0,
        lastPurchaseAt: null,
        pendingPaymentsCount: 0,
      });
    }
    const [paid, pending] = await Promise.all([
      this.prisma.order.groupBy({
        by: ["customerId"],
        where: { tenantId, customerId: { in: ids }, status: PAID_ORDER_STATUSES },
        _sum: { total: true },
        _count: { _all: true },
        _max: { paidAt: true, createdAt: true },
      }),
      this.prisma.order.groupBy({
        by: ["customerId"],
        where: { tenantId, customerId: { in: ids }, status: PENDING_ORDER_STATUSES },
        _count: { _all: true },
      }),
    ]);
    for (const g of paid) {
      const s = stats.get(g.customerId);
      if (!s) continue;
      s.totalPaid = new Prisma.Decimal(g._sum.total ?? 0).toFixed(2);
      s.paidOrdersCount = g._count._all;
      const last = g._max.paidAt ?? g._max.createdAt;
      s.lastPurchaseAt = last ? last.toISOString() : null;
    }
    for (const g of pending) {
      const s = stats.get(g.customerId);
      if (s) s.pendingPaymentsCount = g._count._all;
    }
    return stats;
  }

  async list(tenantId: string, filters: CustomerListFilters, paging: Paging) {
    const where = this.listWhere(tenantId, filters);
    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: { addresses: true, identities: true, consents: true },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: paging.limit,
        skip: paging.offset,
      }),
      this.prisma.customer.count({ where }),
    ]);
    const stats = await this.listStats(
      tenantId,
      rows.map((r) => r.id),
    );
    const items = rows.map((r) => ({ ...r, stats: stats.get(r.id) }));
    return { items, total };
  }

  /**
   * Exportación CSV del listado con los mismos filtros (tope de filas para
   * no armar un archivo gigante en memoria). BOM al inicio para que Excel
   * abra los acentos bien.
   */
  async exportCsv(tenantId: string, filters: CustomerListFilters): Promise<string> {
    const where = this.listWhere(tenantId, filters);
    const rows = await this.prisma.customer.findMany({
      where,
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      take: EXPORT_MAX_ROWS,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        taxId: true,
        legalName: true,
        tags: true,
        status: true,
        createdAt: true,
      },
    });
    const stats = await this.listStats(
      tenantId,
      rows.map((r) => r.id),
    );
    const header = [
      "Nombre",
      "Correo",
      "Teléfono",
      "RFC",
      "Razón social",
      "Etiquetas",
      "Estado",
      "Alta",
      "Última compra",
      "Total pagado",
      "Pedidos pagados",
      "Cobros pendientes",
      "ID",
    ];
    const lines = [header.map(csvCell).join(",")];
    for (const r of rows) {
      const s = stats.get(r.id);
      lines.push(
        [
          r.fullName,
          r.email,
          r.phone,
          r.taxId,
          r.legalName,
          r.tags.join("|"),
          r.status,
          r.createdAt.toISOString(),
          s?.lastPurchaseAt ?? "",
          s?.totalPaid ?? "0.00",
          s?.paidOrdersCount ?? 0,
          s?.pendingPaymentsCount ?? 0,
          r.id,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    return `\uFEFF${lines.join("\r\n")}\r\n`;
  }

  async get(tenantId: string, id: string) {
    const c = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      include: { addresses: true, identities: true, consents: true },
    });
    if (!c) throw new NotFoundException({ code: "NOT_FOUND", message: "Cliente no accesible" });
    return c;
  }

  async create(
    tenantId: string,
    input: {
      fullName: string;
      email?: string;
      phone?: string;
      taxId?: string;
      addresses?: Array<{
        label: string;
        line1: string;
        line2?: string;
        city: string;
        state: string;
        postalCode: string;
        country?: string;
        isDefault?: boolean;
      }>;
    },
  ) {
    if (!input.fullName?.trim()) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "fullName requerido",
      });
    }
    const created = await this.prisma.customer.create({
      data: {
        tenantId,
        fullName: input.fullName,
        email: input.email?.toLowerCase(),
        phone: input.phone,
        taxId: input.taxId?.toUpperCase(),
        addresses: input.addresses
          ? {
              create: input.addresses.map((a) => ({
                label: a.label,
                line1: a.line1,
                line2: a.line2,
                city: a.city,
                state: a.state,
                postalCode: a.postalCode,
                country: a.country ?? "MX",
                isDefault: a.isDefault ?? false,
              })),
            }
          : undefined,
      },
      include: { addresses: true },
    });
    await domainEvents.emit(tenantId, "customer.created", customerEventData(created, "panel"));
    return created;
  }

  async update(
    tenantId: string,
    id: string,
    input: {
      expectedVersion: number;
      fullName?: string;
      email?: string;
      phone?: string;
      taxId?: string;
      notes?: string;
      legalName?: string;
      fiscalPostalCode?: string;
      fiscalCfdiUse?: string;
      fiscalRegimenFiscal?: string;
      tags?: string[];
    },
  ) {
    const c = await this.prisma.customer.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException({ code: "NOT_FOUND", message: "Cliente no accesible" });
    if (c.version !== input.expectedVersion) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "Versión esperada no coincide",
      });
    }
    return this.prisma.customer.update({
      where: { id },
      data: {
        fullName: input.fullName,
        email: input.email?.toLowerCase(),
        phone: input.phone,
        taxId: input.taxId?.toUpperCase(),
        notes: input.notes,
        legalName: input.legalName,
        fiscalPostalCode: input.fiscalPostalCode,
        fiscalCfdiUse: input.fiscalCfdiUse?.toUpperCase(),
        fiscalRegimenFiscal: input.fiscalRegimenFiscal,
        tags: normalizeTags(input.tags),
        version: { increment: 1 },
      },
      include: { addresses: true, identities: true, consents: true },
    });
  }

  async addAddress(
    tenantId: string,
    customerId: string,
    input: {
      label: string;
      line1: string;
      line2?: string;
      city: string;
      state: string;
      postalCode: string;
      country?: string;
      isDefault?: boolean;
    },
  ) {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!c) throw new NotFoundException({ code: "NOT_FOUND", message: "Cliente no accesible" });
    if (input.isDefault) {
      await this.prisma.customerAddress.updateMany({
        where: { customerId },
        data: { isDefault: false },
      });
    }
    return this.prisma.customerAddress.create({
      data: {
        customerId,
        label: input.label,
        line1: input.line1,
        line2: input.line2,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        country: input.country ?? "MX",
        isDefault: input.isDefault ?? false,
      },
    });
  }

  /**
   * Nombres genéricos que la conversación deja cuando todavía no se sabe
   * quién escribe. Una ficha con uno de estos nombres se considera "sin
   * nombre real" y se puede renombrar cuando el chat por fin lo consigue;
   * un nombre real que un humano ya cargó nunca se pisa desde aquí.
   */
  private isPlaceholderName(fullName: string): boolean {
    const normalized = fullName.trim().toLowerCase();
    return (
      normalized.length === 0 ||
      normalized === "cliente de whatsapp" ||
      normalized === "cliente sin nombre" ||
      normalized === "cliente" ||
      /^\+?\d{7,}$/.test(normalized)
    );
  }

  /**
   * Resuelve (o crea) el cliente detrás de un contacto de canal —hoy solo
   * WhatsApp— y lo deja completo y ligado:
   *
   *  1. Si `conversationId` viene, se lee la conversación real (no lo que
   *     mande el agente) para saber el canal (META/EVOLUTION) y el teléfono
   *     exacto: son datos de la propia BD, no hay que confiar en el modelo.
   *  2. Se busca el cliente por esa `CustomerIdentity` primero (vínculo
   *     fuerte), y si no existe, por teléfono/correo exacto (nunca
   *     `contains`: eso es para el buscador, no para decidir si dos
   *     contactos son la misma persona).
   *  3. Si existe, se completan los campos que falten (teléfono, correo, o
   *     el nombre si el que tiene es un placeholder) sin pisar nada que un
   *     humano ya haya cargado. Si no existe, se crea.
   *  4. Se deja (o confirma) la `CustomerIdentity` de este canal, y si la
   *     conversación todavía no tenía cliente asignado, se le asigna éste.
   *     Nunca se sobreescribe un vínculo manual ya hecho desde el panel.
   *
   * Antes de esto, el agente creaba el cliente con `POST /customers` a
   * secas: quedaba real y con nombre, pero la conversación seguía marcada
   * "Cliente sin ficha" para siempre (nada la vinculaba), y una ficha vieja
   * con el nombre placeholder nunca se corregía aunque el cliente ya
   * hubiera dado su nombre real en un mensaje posterior.
   */
  async resolveChannelContact(
    tenantId: string,
    input: { fullName: string; phone?: string; email?: string; conversationId?: string },
  ): Promise<Customer> {
    const fullName = input.fullName.trim();
    if (!fullName) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", message: "fullName requerido" });
    }
    const email = input.email?.trim().toLowerCase() || undefined;
    let phone = input.phone?.trim() || undefined;

    let channel: "WHATSAPP_META" | "WHATSAPP_EVOLUTION" | undefined;
    // El chat web manda ids de conversación que no son UUID; Prisma lanza
    // un 500 al castearlos, así que solo se consulta el hilo cuando de
    // verdad puede ser una conversación de WhatsApp.
    if (input.conversationId && UUID_RE.test(input.conversationId)) {
      const conv = await this.prisma.whatsAppConversation.findFirst({
        where: { id: input.conversationId, tenantId },
        include: { connection: { select: { provider: true } } },
      });
      if (conv) {
        channel = conv.connection.provider === "META" ? "WHATSAPP_META" : "WHATSAPP_EVOLUTION";
        phone = phone ?? conv.externalPhone;
      }
    }

    let customer =
      channel && phone
        ? await this.prisma.customer.findFirst({
            where: { tenantId, identities: { some: { channel, externalId: phone } } },
          })
        : null;

    if (!customer && (phone || email)) {
      customer = await this.prisma.customer.findFirst({
        where: {
          tenantId,
          OR: [
            ...(phone ? [{ phone }] : []),
            ...(email ? [{ email }] : []),
          ] as Prisma.CustomerWhereInput[],
        },
      });
    }

    // `email` es único por tenant: si otra ficha ya lo tiene (el mismo
    // cliente creado antes desde el panel o el chat web), completar o crear
    // con ese correo lanzaba P2002 y el agente recibía un 500 en plena
    // cotización. En ese caso el correo no se toca; la ficha del canal
    // (teléfono) sigue siendo la que se liga.
    const emailTakenByOther = async (customerId: string | null): Promise<boolean> => {
      if (!email) return false;
      const other = await this.prisma.customer.findFirst({
        where: { tenantId, email, ...(customerId ? { id: { not: customerId } } : {}) },
        select: { id: true },
      });
      return Boolean(other);
    };

    if (customer) {
      const patch: Prisma.CustomerUpdateInput = {};
      if (!customer.phone && phone) patch.phone = phone;
      if (!customer.email && email && !(await emailTakenByOther(customer.id))) patch.email = email;
      if (this.isPlaceholderName(customer.fullName) && !this.isPlaceholderName(fullName)) {
        patch.fullName = fullName;
      }
      if (Object.keys(patch).length > 0) {
        customer = await this.prisma.customer.update({
          where: { id: customer.id },
          data: { ...patch, version: { increment: 1 } },
        });
      }
    } else {
      const safeEmail = (await emailTakenByOther(null)) ? undefined : email;
      customer = await this.prisma.customer.create({
        data: { tenantId, fullName, phone, email: safeEmail },
      });
      await domainEvents.emit(
        tenantId,
        "customer.created",
        customerEventData(customer, channel ? "whatsapp" : "panel"),
      );
    }

    if (channel && phone) {
      await this.prisma.customerIdentity.upsert({
        where: { channel_externalId: { channel, externalId: phone } },
        create: { customerId: customer.id, channel, externalId: phone, verifiedAt: new Date() },
        update: { verifiedAt: new Date() },
      });
    }

    if (input.conversationId) {
      // `customerId: null` en el where: si el hilo ya tiene un cliente
      // (vinculado a mano o por una llamada anterior) no se toca.
      await this.prisma.whatsAppConversation.updateMany({
        where: { id: input.conversationId, tenantId, customerId: null },
        data: { customerId: customer.id },
      });
    }

    // Consentimiento implícito (docs/06-crm.md, migración 0010): si nos
    // escribió por WhatsApp, aceptó que le respondamos por ese canal.
    if (channel) {
      await this.autoGrantWhatsAppConsent(customer.id);
    }

    return customer;
  }

  /**
   * Otorga WHATSAPP una sola vez, solo si el cliente no tiene ninguna
   * decisión registrada todavía para ese scope. Si alguien ya la otorgó o
   * la REVOCÓ a mano, esto nunca la toca — un cliente que pidió que no le
   * escribamos y vuelve a mandar un mensaje no queda re-suscrito solo por
   * escribir.
   */
  private async autoGrantWhatsAppConsent(customerId: string): Promise<void> {
    const existing = await this.prisma.customerConsent.findUnique({
      where: { customerId_scope: { customerId, scope: "WHATSAPP" } },
    });
    if (existing) return;
    await this.prisma.customerConsent.create({
      data: {
        customerId,
        scope: "WHATSAPP",
        granted: true,
        grantedAt: new Date(),
        note: "Auto-otorgado: el cliente envió un mensaje por WhatsApp.",
        source: "auto",
      },
    });
  }

  async linkIdentity(
    tenantId: string,
    customerId: string,
    channel: "WHATSAPP_META" | "WHATSAPP_EVOLUTION",
    externalId: string,
  ) {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!c) throw new NotFoundException({ code: "NOT_FOUND", message: "Cliente no accesible" });
    try {
      return await this.prisma.customerIdentity.create({
        data: { customerId, channel, externalId, verifiedAt: new Date() },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw new ConflictException({
          code: "CONFLICT",
          message: "Identidad ya vinculada a otro cliente",
        });
      }
      throw err;
    }
  }

  async grantConsent(
    tenantId: string,
    customerId: string,
    scope: "WHATSAPP" | "MARKETING" | "DATA_PROCESSING",
  ) {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!c) throw new NotFoundException({ code: "NOT_FOUND", message: "Cliente no accesible" });
    return this.prisma.customerConsent.upsert({
      where: { customerId_scope: { customerId, scope } },
      create: { customerId, scope, granted: true, grantedAt: new Date() },
      update: { granted: true, grantedAt: new Date(), revokedAt: null },
    });
  }

  async revokeConsent(
    tenantId: string,
    customerId: string,
    scope: "WHATSAPP" | "MARKETING" | "DATA_PROCESSING",
  ) {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!c) throw new NotFoundException({ code: "NOT_FOUND", message: "Cliente no accesible" });
    return this.prisma.customerConsent.upsert({
      where: { customerId_scope: { customerId, scope } },
      create: { customerId, scope, granted: false, revokedAt: new Date() },
      update: { granted: false, revokedAt: new Date() },
    });
  }

  /** Archiva (no borra físicamente): oculta de listados activos, conserva historial. */
  async archive(tenantId: string, id: string) {
    const c = await this.prisma.customer.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException({ code: "NOT_FOUND", message: "Cliente no accesible" });
    if (c.status === "ARCHIVED") {
      throw new BadRequestException({ code: "RULE_VIOLATION", message: "Cliente ya archivado" });
    }
    return this.prisma.customer.update({
      where: { id },
      data: { status: "ARCHIVED", version: { increment: 1 } },
    });
  }

  async unarchive(tenantId: string, id: string) {
    const c = await this.prisma.customer.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException({ code: "NOT_FOUND", message: "Cliente no accesible" });
    return this.prisma.customer.update({
      where: { id },
      data: { status: "ACTIVE", version: { increment: 1 } },
    });
  }

  /** Historial agregado: cotizaciones + pedidos del cliente, más recientes primero. */
  async history(tenantId: string, id: string) {
    await this.assertAccess(tenantId, id);
    const [quotes, orders] = await Promise.all([
      this.prisma.quote.findMany({
        where: { tenantId, customerId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, status: true, total: true, createdAt: true },
      }),
      this.prisma.order.findMany({
        where: { tenantId, customerId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, status: true, total: true, source: true, createdAt: true },
      }),
    ]);
    return { quotes, orders };
  }

  async findByIdentity(
    tenantId: string,
    channel: "WHATSAPP_META" | "WHATSAPP_EVOLUTION",
    externalId: string,
  ) {
    const identity = await this.prisma.customerIdentity.findUnique({
      where: { channel_externalId: { channel, externalId } },
      include: { customer: true },
    });
    if (!identity || identity.customer.tenantId !== tenantId) return null;
    return identity.customer;
  }

  async assertAccess(tenantId: string, customerId: string): Promise<void> {
    const exists = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!exists) {
      throw new ForbiddenException({ code: "NOT_FOUND", message: "Cliente no accesible" });
    }
  }
}