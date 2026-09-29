import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { buildPageInfo } from "../common/pagination.js";
import { validateProductImage } from "./product-image-validation.js";
import { deleteObject, publicUrlForKey, writeObject } from "../tenants/logo-storage.js";

export interface ListProductsInput {
  q?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  cursor?: string;
  limit?: number;
  /** Si viene, modo offset: ignora `cursor` y el pageInfo incluye `total`. */
  offset?: number;
}

export interface UploadedImage {
  buffer: Buffer;
  mimetype?: string;
  originalname?: string;
}

/** Ver comentario de `purpose` en el modelo `StorageObject`. */
const IMAGE_PURPOSE = "product.media";

const IMAGES_ORDER = { orderBy: { position: "asc" as const } };

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

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
    const include = {
      variants: { include: { images: IMAGES_ORDER } },
      images: IMAGES_ORDER,
    };
    const orderBy = [{ updatedAt: "desc" as const }, { id: "desc" as const }];

    // Modo offset (paginador numerado): con `offset` se ignora `cursor` y el
    // pageInfo trae `total`/`limit`/`offset` además de nextCursor/size.
    if (input.offset !== undefined) {
      const [items, total] = await Promise.all([
        this.prisma.product.findMany({ where, include, orderBy, take: limit, skip: input.offset }),
        this.prisma.product.count({ where }),
      ]);
      const hasMore = input.offset + items.length < total;
      return {
        items,
        pageInfo: {
          nextCursor: hasMore && items.length ? items[items.length - 1]!.id : null,
          size: items.length,
          ...buildPageInfo(total, { limit, offset: input.offset }),
        },
      };
    }

    const rows = await this.prisma.product.findMany({
      where,
      include,
      orderBy,
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
      include: {
        variants: { orderBy: { createdAt: "asc" }, include: { images: IMAGES_ORDER } },
        images: IMAGES_ORDER,
      },
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
    actorId: string | null,
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
        stock?: string;
        originSystem?: string;
        originExternalId?: string;
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
            stock: v.stock,
            originSystem: v.originSystem,
            originExternalId: v.originExternalId,
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
      stock?: string;
      originSystem?: string;
      originExternalId?: string;
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
        stock: input.stock,
        originSystem: input.originSystem,
        originExternalId: input.originExternalId,
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
      /** `null` quita el control de inventario; ausente = no tocar. */
      stock?: string | null;
      satProductCode?: string;
      satUnitCode?: string;
      status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
      /** `null` = ya no viene de un sistema externo; ausente = no tocar. */
      originSystem?: string | null;
      originExternalId?: string | null;
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
        stock: input.stock,
        satProductCode: input.satProductCode,
        satUnitCode: input.satUnitCode,
        status: input.status,
        originSystem: input.originSystem,
        originExternalId: input.originExternalId,
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
   * Valida una fila cruda de importación (mismas reglas para dry-run y
   * commit — nunca deben divergir, o un dry-run "sin errores" podría fallar
   * al aplicarse de verdad). No consulta la base; el chequeo de sku
   * duplicado/existente lo hace el llamador, que ya trae el índice armado.
   */
  private validateImportRow(row: Record<string, string>): {
    sku?: string;
    title?: string;
    price?: string;
    satProductCode?: string;
    satUnitCode?: string;
    errors: string[];
  } {
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
    return { sku, title, price, satProductCode: satProd, satUnitCode: satUnit, errors: errs };
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

    const skuIndex = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const parsed = this.validateImportRow(rows[i]!);
      const errs = [...parsed.errors];
      if (parsed.sku) {
        if (skuIndex.has(parsed.sku)) {
          errs.push(`sku duplicado en fila ${skuIndex.get(parsed.sku)}`);
        } else {
          skuIndex.set(parsed.sku, i);
        }
        const existing = await this.prisma.productVariant.findFirst({
          where: { tenantId, sku: parsed.sku },
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

  /**
   * Aplica de verdad una importación CSV (T-CAT-06): mismas reglas que
   * `dryRunImport`, pero crea o actualiza. Una fila = un producto con UNA
   * variante (mismo sku/title para ambos) — el CSV no trae una columna de
   * agrupación por producto, así que no hay forma de mapear varias filas a
   * un mismo producto multi-variante desde aquí; para eso sigue estando el
   * alta manual (`createProduct`/`addVariant`).
   *
   * Fila por fila, no en una sola transacción: con hasta 10,000 filas, una
   * transacción interactiva de Prisma se arriesga a expirar, y una fila mala
   * no debe tumbar las 9,999 buenas. `actorId` es opcional (a diferencia de
   * `createProduct`, que exige sesión humana) — importar en bulk es
   * justamente el caso de uso de una API key/agente sin persona detrás.
   */
  async commitImport(
    tenantId: string,
    actorId: string | null,
    rows: Array<Record<string, string>>,
  ): Promise<{
    totalRows: number;
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ row: number; errors: string[] }>;
    results: Array<{ row: number; sku: string; action: "created" | "updated"; id: string }>;
  }> {
    if (rows.length > 10_000) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Máximo 10,000 filas por job",
      });
    }

    const summary = {
      totalRows: rows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [] as Array<{ row: number; errors: string[] }>,
      results: [] as Array<{ row: number; sku: string; action: "created" | "updated"; id: string }>,
    };

    const skuIndex = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const parsed = this.validateImportRow(rows[i]!);
      const errs = [...parsed.errors];
      if (parsed.sku) {
        if (skuIndex.has(parsed.sku)) {
          errs.push(`sku duplicado en fila ${skuIndex.get(parsed.sku)}`);
        } else {
          skuIndex.set(parsed.sku, i);
        }
      }
      if (errs.length > 0) {
        summary.errors.push({ row: i, errors: errs });
        summary.skipped += 1;
        continue;
      }
      const { sku, title, price, satProductCode, satUnitCode } = parsed as {
        sku: string;
        title: string;
        price: string;
        satProductCode?: string;
        satUnitCode?: string;
      };

      const existing = await this.prisma.productVariant.findFirst({ where: { tenantId, sku } });
      try {
        if (existing) {
          await this.prisma.productVariant.update({
            where: { id: existing.id },
            data: {
              title,
              price,
              satProductCode: satProductCode ?? existing.satProductCode,
              satUnitCode: satUnitCode ?? existing.satUnitCode,
              version: { increment: 1 },
            },
          });
          summary.updated += 1;
          summary.results.push({ row: i, sku, action: "updated", id: existing.id });
        } else {
          const product = await this.createProduct(tenantId, actorId, {
            sku,
            title,
            variants: [{ sku, title, price, satProductCode, satUnitCode }],
          });
          summary.created += 1;
          summary.results.push({ row: i, sku, action: "created", id: product.variants[0]!.id });
        }
      } catch (err) {
        summary.skipped += 1;
        summary.errors.push({
          row: i,
          errors: [err instanceof Error ? err.message : "error desconocido al guardar"],
        });
      }
    }
    return summary;
  }

  // ---------- imágenes ----------

  /** Foto general del producto (`variantId` null): portada y galería en listados. */
  async addProductImage(
    tenantId: string,
    productId: string,
    actorId: string | null,
    file: UploadedImage | undefined,
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Producto no accesible" });
    }
    return this.storeImage(
      tenantId,
      actorId,
      { productId, variantId: null, prefix: `products/${tenantId}/${productId}` },
      file,
    );
  }

  /** Foto propia de una variante (p.ej. color/presentación distinta a la del producto). */
  async addVariantImage(
    tenantId: string,
    variantId: string,
    actorId: string | null,
    file: UploadedImage | undefined,
  ) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, tenantId },
      select: { id: true, productId: true },
    });
    if (!variant) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Variante no accesible" });
    }
    return this.storeImage(
      tenantId,
      actorId,
      {
        productId: variant.productId,
        variantId: variant.id,
        prefix: `products/${tenantId}/${variant.productId}/variants/${variant.id}`,
      },
      file,
    );
  }

  private async storeImage(
    tenantId: string,
    actorId: string | null,
    target: { productId: string; variantId: string | null; prefix: string },
    file: UploadedImage | undefined,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Adjunta la imagen en el campo «file».",
      });
    }
    const meta = validateProductImage(file.buffer, file.mimetype);

    const hash = createHash("sha256").update(file.buffer).digest("hex").slice(0, 16);
    const key = `${target.prefix}/${hash}.${meta.ext}`;
    await writeObject(key, file.buffer);
    const url = publicUrlForKey(key);

    const last = await this.prisma.productImage.findFirst({
      where: { tenantId, productId: target.productId, variantId: target.variantId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const position = (last?.position ?? -1) + 1;

    const image = await this.prisma.$transaction(async (tx) => {
      const created = await tx.productImage.create({
        data: {
          tenantId,
          productId: target.productId,
          variantId: target.variantId,
          url,
          storageKey: key,
          position,
          width: meta.width,
          height: meta.height,
        },
      });
      await tx.storageObject.upsert({
        where: { tenantId_key: { tenantId, key } },
        create: {
          tenantId,
          key,
          contentType: meta.mime,
          sizeBytes: file.buffer.length,
          purpose: IMAGE_PURPOSE,
          metadata: {
            width: meta.width,
            height: meta.height,
            originalName: file.originalname ?? null,
            productId: target.productId,
            variantId: target.variantId,
          },
          uploadedBy: actorId,
        },
        update: {
          contentType: meta.mime,
          sizeBytes: file.buffer.length,
          deletedAt: null,
          uploadedBy: actorId,
        },
      });
      return created;
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId,
        action: target.variantId ? "catalog.variant_image_added" : "catalog.product_image_added",
        targetType: target.variantId ? "ProductVariant" : "Product",
        targetId: target.variantId ?? target.productId,
        metadata: { imageId: image.id, key, width: meta.width, height: meta.height },
      },
    });

    return image;
  }

  async deleteImage(tenantId: string, imageId: string, actorId: string | null): Promise<void> {
    const image = await this.prisma.productImage.findFirst({ where: { id: imageId, tenantId } });
    if (!image) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Imagen no accesible" });
    }
    await this.prisma.productImage.delete({ where: { id: imageId } });

    // Best-effort, igual que TenantLogoService.retire(): la fila ya se borró,
    // que falle el borrado del archivo no debe revertir la operación.
    try {
      await deleteObject(image.storageKey);
      await this.prisma.storageObject.updateMany({
        where: { tenantId, key: image.storageKey, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(`No se pudo retirar la imagen ${image.storageKey}: ${String(err)}`);
    }

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId,
        action: image.variantId ? "catalog.variant_image_removed" : "catalog.product_image_removed",
        targetType: image.variantId ? "ProductVariant" : "Product",
        targetId: image.variantId ?? image.productId,
        metadata: { imageId: image.id, key: image.storageKey },
      },
    });
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