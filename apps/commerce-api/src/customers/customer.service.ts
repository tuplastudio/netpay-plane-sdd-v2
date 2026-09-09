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