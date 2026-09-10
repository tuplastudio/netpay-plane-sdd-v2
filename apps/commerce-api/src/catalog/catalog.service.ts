import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";

export interface ListProductsInput {
  q?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  cursor?: string;
  limit?: number;
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listProducts(tenantId: string, input: ListProductsInput) {
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
    const where: Prisma.ProductWhereInput = { tenantId };
    if (input.status) where.status = input.status;
    if (input.q) {
      where.OR = [
        { title: { contains: input.q, mode: "insensitive" } },
        { sku: { contains: input.q, mode: "insensitive" } },
        { tags: { has: input.q } },
        { synonyms: { has: input.q } },
        { variants: { some: { sku: { contains: input.q, mode: "insensitive" } } } },
      ];
    }
    const rows = await this.prisma.product.findMany({
      where,
      include: { variants: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items,
      pageInfo: {
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
        size: items.length,
      },
    };
  }

  async getProduct(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      include: { variants: { orderBy: { createdAt: "asc" } } },
    });
    if (!product) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Producto no accesible",
      });
    }
    return product;
  }

  async createProduct(
    tenantId: string,
    actorId: string,
    input: {
      sku: string;
      title: string;
      description?: string;
      tags?: string[];
      synonyms?: string[];
      satProductCode?: string;
      satUnitCode?: string;
      variants: Array<{
        sku: string;
        title: string;
        price: string;
        satProductCode?: string;
        satUnitCode?: string;
      }>;
    },
  ) {
    if (input.variants.length === 0) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Al menos una variante requerida",
      });
    }

    return this.prisma.product.create({
      data: {
        tenantId,
        sku: input.sku,
        title: input.title,
        description: input.description,
        tags: input.tags ?? [],
        synonyms: input.synonyms ?? [],
        status: "DRAFT",
        createdById: actorId,
        variants: {
          create: input.variants.map((v) => ({
            tenantId,
            sku: v.sku,
            title: v.title,
            price: v.price,
            satProductCode: v.satProductCode ?? input.satProductCode ?? "01010101",
            satUnitCode: v.satUnitCode ?? input.satUnitCode ?? "H87",
            status: "DRAFT",
          })),
        },
      },
      include: { variants: true },
    });
  }

  async updateProduct(
    tenantId: string,
    id: string,
    input: {
      expectedVersion: number;
      title?: string;
      description?: string;
      tags?: string[];
      synonyms?: string[];
      status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
    },
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
    });
    if (!product) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Producto no accesible" });
    }
    if (product.version !== input.expectedVersion) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "Versión esperada no coincide",
      });
    }
    return this.prisma.product.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        tags: input.tags,
        synonyms: input.synonyms,
        status: input.status,
        version: { increment: 1 },
      },
      include: { variants: true },
    });
  }

  async addVariant(
    tenantId: string,
    productId: string,
    input: {
      sku: string;
      title: string;
      price: string;
      satProductCode?: string;
      satUnitCode?: string;
    },
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });
    if (!product) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Producto no accesible" });
    }
    return this.prisma.productVariant.create({
      data: {
        tenantId,
        productId,
        sku: input.sku,
        title: input.title,
        price: input.price,
        satProductCode: input.satProductCode ?? "01010101",
        satUnitCode: input.satUnitCode ?? "H87",
        status: "DRAFT",
      },
    });
  }

  async updateVariant(
    tenantId: string,
    id: string,
    input: {
      expectedVersion: number;
      title?: string;
      price?: string;
      satProductCode?: string;
      satUnitCode?: string;
      status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
    },
  ) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id, tenantId },
    });
    if (!variant) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Variante no accesible" });
    }
    if (variant.version !== input.expectedVersion) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "Versión esperada no coincide",
      });
    }
    return this.prisma.productVariant.update({
      where: { id },
      data: {
        title: input.title,
        price: input.price,
        satProductCode: input.satProductCode,
        satUnitCode: input.satUnitCode,
        status: input.status,
        version: { increment: 1 },
      },
    });
  }

  async archiveProduct(tenantId: string, id: string): Promise<void> {
    await this.prisma.product.updateMany({
      where: { id, tenantId },
      data: { status: "ARCHIVED", version: { increment: 1 } },
    });
  }

  /**
   * Dry-run de importación CSV: valida formato y reglas básicas.
   * No muta datos. Devuelve errores por fila.
   * Ver docs/04-cat.md T-CAT-06.
   */
  async dryRunImport(tenantId: string, rows: Array<Record<string, string>>) {
    const result: {
      totalRows: number;
      wouldCreate: number;
      wouldUpdate: number;
      errors: Array<{ row: number; errors: string[] }>;
    } = {
      totalRows: rows.length,
      wouldCreate: 0,
      wouldUpdate: 0,
      errors: [],
    };
    if (rows.length > 10_000) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Máximo 10,000 filas por job",
      });
    }

    const skuIndex = new Map<string, { row: number; product?: string }>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const errs: string[] = [];
      const sku = row.sku?.trim();
      const title = row.title?.trim();
      const price = row.price?.trim();
      const satProd = row.satProductCode?.trim();
      const satUnit = row.satUnitCode?.trim();
      if (!sku) errs.push("sku requerido");
      if (!title) errs.push("title requerido");
      if (!price || !/^\d+\.\d{2}$/.test(price)) errs.push("price formato inválido (NN.NN)");
      if (satProd && !/^\d{8}$/.test(satProd)) errs.push("satProductCode debe ser 8 dígitos");
      if (satUnit && !/^[A-Z0-9]{2,3}$/.test(satUnit)) errs.push("satUnitCode inválido");
      if (sku) {
        if (skuIndex.has(sku)) {
          errs.push(`sku duplicado en fila ${skuIndex.get(sku)!.row}`);
        } else {
          skuIndex.set(sku, { row: i });
        }
        const existing = await this.prisma.productVariant.findFirst({
          where: { tenantId, sku },
        });
        if (existing) result.wouldUpdate += 1;
        else result.wouldCreate += 1;
      }
      if (errs.length > 0) {
        result.errors.push({ row: i, errors: errs });
      }
    }
    return result;
  }

  async assertOwnership(tenantId: string, productId: string): Promise<void> {
    const exists = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { id: true },
    });
    if (!exists) {
      throw new ForbiddenException({
        code: "NOT_FOUND",
        message: "Producto no accesible",
      });
    }
  }
}