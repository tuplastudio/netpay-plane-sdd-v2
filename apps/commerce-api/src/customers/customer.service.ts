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
import type { Prisma, Customer } from "@prisma/client";

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, q?: string, includeArchived = false) {
    return this.prisma.customer.findMany({
      where: {
        tenantId,
        ...(includeArchived ? {} : { status: "ACTIVE" }),
        ...(q
          ? {
              OR: [
                { fullName: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { phone: { contains: q } },
                { taxId: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { addresses: true, identities: true, consents: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
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
    return this.prisma.customer.create({
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
        version: { increment: 1 },
      },
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
    if (input.conversationId) {
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

    if (customer) {
      const patch: Prisma.CustomerUpdateInput = {};
      if (!customer.phone && phone) patch.phone = phone;
      if (!customer.email && email) patch.email = email;
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
      customer = await this.prisma.customer.create({ data: { tenantId, fullName, phone, email } });
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