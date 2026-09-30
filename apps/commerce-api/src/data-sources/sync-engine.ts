/**
 * Motor de sincronización: ítems crudos → fieldMap → upsert en el catálogo.
 *
 * Modelo: un ítem externo = un `Product` con UNA `ProductVariant` del mismo
 * SKU (el catálogo nativo permite varias variantes; una fuente externa que
 * traiga variantes las manda como ítems con su propio SKU).
 *
 * Reglas:
 *  - Se busca la variante primero por `(originSystem = fuente, originExternalId)`
 *    y si no, por `(tenantId, sku)`: así un producto cargado a mano queda
 *    "adoptado" por la fuente en la primera sincronización.
 *  - Idempotente: si nada cambió se cuenta como `skipped` y no se escribe.
 *  - Nunca borra. `deactivateMissing` archiva las variantes de ESTA fuente
 *    que dejaron de venir (y el producto si ya no le queda ninguna activa).
 *  - Los productos nuevos entran ACTIVE (la fuente es la autoridad); los
 *    ítems inactivos que no existen no se crean.
 *  - Imágenes: `ProductImage` exige un objeto en nuestro storage
 *    (`storageKey` + `StorageObject`), así que NO se importan URLs externas
 *    (descargar imágenes de terceros implicaría validación de tipo, tamaño y
 *    SSRF por cada una). Se reportan en la vista previa y en `stats.images`
 *    para que el operador sepa cuántas hay. Ver docs/integrations/data-sources.md.
 */

import type { PrismaService } from "../prisma/prisma.service.js";
import { FieldMap, NormalizedItem, mapItem } from "./field-map.js";

export interface SyncStats {
  fetched: number;
  mapped: number;
  created: number;
  updated: number;
  skipped: number;
  deactivated: number;
  errors: number;
  /** Ítems que traían al menos una imagen (no se importan; ver arriba). */
  images: number;
}

export interface SyncError {
  index?: number;
  sku?: string;
  message: string;
}

export const ERROR_SAMPLE_SIZE = 10;

export interface SyncSource {
  id: string;
  tenantId: string;
  deactivateMissing: boolean;
}

export interface SyncOutcome {
  stats: SyncStats;
  errors: SyncError[];
}

/** SAT por defecto para productos importados (mismo default que el catálogo). */
const DEFAULT_SAT_PRODUCT_CODE = "01010101";
const DEFAULT_SAT_UNIT_CODE = "H87";

type VariantRow = {
  id: string;
  productId: string;
  title: string;
  price: unknown;
  currency: string;
  stock: unknown;
  status: string;
  originSystem: string | null;
  originExternalId: string | null;
  product: { id: string; title: string; description: string | null; tags: string[]; status: string };
};

const VARIANT_SELECT = {
  id: true,
  productId: true,
  title: true,
  price: true,
  currency: true,
  stock: true,
  status: true,
  originSystem: true,
  originExternalId: true,
  product: { select: { id: true, title: true, description: true, tags: true, status: true } },
} as const;

function decimalEq(current: unknown, next: string | null, digits: number): boolean {
  if (current === null || current === undefined) return next === null;
  if (next === null) return false;
  return Number(current).toFixed(digits) === Number(next).toFixed(digits);
}

function withCategory(tags: string[], category: string | null): string[] {
  if (!category || tags.includes(category)) return tags;
  return [...tags, category];
}

export class CatalogUpserter {
  constructor(private readonly prisma: PrismaService) {}

  private async findVariant(source: SyncSource, item: NormalizedItem): Promise<VariantRow | null> {
    const byOrigin = await this.prisma.productVariant.findFirst({
      where: { tenantId: source.tenantId, originSystem: source.id, originExternalId: item.externalId },
      select: VARIANT_SELECT,
    });
    if (byOrigin) return byOrigin as VariantRow;
    const bySku = await this.prisma.productVariant.findFirst({
      where: { tenantId: source.tenantId, sku: item.sku },
      select: VARIANT_SELECT,
    });
    return (bySku as VariantRow | null) ?? null;
  }

  /** Upsert de un ítem. Devuelve qué pasó para las estadísticas. */
  async upsert(source: SyncSource, item: NormalizedItem): Promise<"created" | "updated" | "skipped"> {
    const existing = await this.findVariant(source, item);
    if (existing) return this.updateExisting(source, existing, item);
    if (!item.active) return "skipped";

    const product = await this.prisma.product.findFirst({
      where: { tenantId: source.tenantId, sku: item.sku },
      select: { id: true },
    });
    const variantData = {
      tenantId: source.tenantId,
      sku: item.sku,
      title: item.name,
      price: item.price,
      currency: item.currency,
      stock: item.stock,
      originSystem: source.id,
      originExternalId: item.externalId,
      satProductCode: DEFAULT_SAT_PRODUCT_CODE,
      satUnitCode: DEFAULT_SAT_UNIT_CODE,
      status: "ACTIVE" as const,
    };
    if (product) {
      await this.prisma.productVariant.create({ data: { ...variantData, productId: product.id } });
      return "created";
    }
    await this.prisma.product.create({
      data: {
        tenantId: source.tenantId,
        sku: item.sku,
        title: item.name,
        description: item.description,
        tags: withCategory([], item.category),
        status: "ACTIVE",
        variants: { create: [variantData] },
      },
    });
    return "created";
  }

  private async updateExisting(
    source: SyncSource,
    existing: VariantRow,
    item: NormalizedItem,
  ): Promise<"updated" | "skipped"> {
    const nextVariantStatus = item.active ? "ACTIVE" : "ARCHIVED";
    const variantPatch: Record<string, unknown> = {};
    if (existing.title !== item.name) variantPatch.title = item.name;
    if (!decimalEq(existing.price, item.price, 2)) variantPatch.price = item.price;
    if (existing.currency !== item.currency) variantPatch.currency = item.currency;
    if (!decimalEq(existing.stock, item.stock, 3)) variantPatch.stock = item.stock;
    if (existing.status !== nextVariantStatus) variantPatch.status = nextVariantStatus;
    if (existing.originSystem !== source.id) variantPatch.originSystem = source.id;
    if (existing.originExternalId !== item.externalId) variantPatch.originExternalId = item.externalId;

    const productPatch: Record<string, unknown> = {};
    const product = existing.product;
    if (product.title !== item.name) productPatch.title = item.name;
    if (item.description !== null && product.description !== item.description) {
      productPatch.description = item.description;
    }
    const tags = withCategory(product.tags, item.category);
    if (tags.length !== product.tags.length) productPatch.tags = tags;
    if (item.active && product.status !== "ACTIVE") productPatch.status = "ACTIVE";

    let changed = false;
    if (Object.keys(variantPatch).length > 0) {
      await this.prisma.productVariant.update({
        where: { id: existing.id },
        data: { ...variantPatch, version: { increment: 1 } },
      });
      changed = true;
    }
    if (!item.active && product.status !== "ARCHIVED") {
      const alive = await this.prisma.productVariant.count({
        where: { productId: product.id, status: { not: "ARCHIVED" }, NOT: { id: existing.id } },
      });
      if (alive === 0) productPatch.status = "ARCHIVED";
    }
    if (Object.keys(productPatch).length > 0) {
      await this.prisma.product.update({
        where: { id: product.id },
        data: { ...productPatch, version: { increment: 1 } },
      });
      changed = true;
    }
    return changed ? "updated" : "skipped";
  }

  /**
   * Archiva variantes de esta fuente cuyo `originExternalId` no vino en esta
   * pasada, y los productos que se quedan sin variantes activas.
   */
  async deactivateMissing(source: SyncSource, seenExternalIds: ReadonlySet<string>): Promise<number> {
    const stale = await this.prisma.productVariant.findMany({
      where: {
        tenantId: source.tenantId,
        originSystem: source.id,
        status: { not: "ARCHIVED" },
        NOT: { originExternalId: { in: [...seenExternalIds] } },
      },
      select: { id: true, productId: true },
    });
    if (stale.length === 0) return 0;
    const ids = stale.map((v) => v.id);
    const { count } = await this.prisma.productVariant.updateMany({
      where: { id: { in: ids } },
      data: { status: "ARCHIVED", version: { increment: 1 } },
    });
    const productIds = [...new Set(stale.map((v) => v.productId))];
    await this.prisma.product.updateMany({
      where: {
        tenantId: source.tenantId,
        id: { in: productIds },
        status: { not: "ARCHIVED" },
        variants: { none: { status: { not: "ARCHIVED" } } },
      },
      data: { status: "ARCHIVED", version: { increment: 1 } },
    });
    return count;
  }
}

/**
 * Corre el mapeo + upsert sobre una lista de ítems crudos. No toca la fila
 * de la fuente ni del run: eso lo hace el servicio, que conoce el contexto.
 */
export async function syncItems(
  prisma: PrismaService,
  source: SyncSource,
  rawItems: unknown[],
  fieldMap: FieldMap,
): Promise<SyncOutcome> {
  const upserter = new CatalogUpserter(prisma);
  const stats: SyncStats = {
    fetched: rawItems.length,
    mapped: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    deactivated: 0,
    errors: 0,
    images: 0,
  };
  const errors: SyncError[] = [];
  const seen = new Set<string>();
  const pushError = (error: SyncError) => {
    stats.errors += 1;
    if (errors.length < ERROR_SAMPLE_SIZE) errors.push(error);
  };

  for (let index = 0; index < rawItems.length; index += 1) {
    const mapped = mapItem(rawItems[index], fieldMap);
    if (!mapped.ok) {
      pushError({ index, message: mapped.error });
      continue;
    }
    const item = mapped.item;
    if (seen.has(item.externalId)) {
      // Dos ítems con el mismo id externo en la misma pasada: el primero manda.
      pushError({ index, sku: item.sku, message: `externalId duplicado "${item.externalId}"` });
      continue;
    }
    seen.add(item.externalId);
    stats.mapped += 1;
    if (item.imageUrls.length > 0) stats.images += 1;
    try {
      const result = await upserter.upsert(source, item);
      stats[result] += 1;
    } catch (err) {
      pushError({ index, sku: item.sku, message: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
    }
  }

  // Sin ítems no se archiva nada: un endpoint roto no debe vaciar el catálogo.
  if (source.deactivateMissing && stats.mapped > 0) {
    stats.deactivated = await upserter.deactivateMissing(source, seen);
  }
  return { stats, errors };
}
