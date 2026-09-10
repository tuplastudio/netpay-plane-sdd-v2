import type { Product, Variant } from "../catalog-shared";

/**
 * Rango de precios de un producto a partir de sus variantes. Devuelve los
 * importes ORIGINALES (string decimal del API) para que `Money` los formatee
 * sin pasar por `Number()`: la comparación numérica solo decide el orden.
 */
export function priceRange(product: Product): { min: string; max: string } | null {
  if (product.variants.length === 0) return null;
  let min = product.variants[0]!;
  let max = product.variants[0]!;
  for (const v of product.variants) {
    if (Number.parseFloat(v.price) < Number.parseFloat(min.price)) min = v;
    if (Number.parseFloat(v.price) > Number.parseFloat(max.price)) max = v;
  }
  return { min: min.price, max: max.price };
}

/** `stock` es `null` cuando la variante no controla inventario. */
export function isOutOfStock(variant: Variant): boolean {
  if (variant.stock === null) return false;
  const n = Number.parseFloat(variant.stock);
  return Number.isFinite(n) && n <= 0;
}

export interface CatalogStats {
  total: number;
  active: number;
  draft: number;
  archived: number;
  variants: number;
  outOfStock: number;
}

/** Conteos derivados del listado ya cargado: no hay endpoint de resumen. */
export function catalogStats(products: Product[] | undefined): CatalogStats {
  const stats: CatalogStats = { total: 0, active: 0, draft: 0, archived: 0, variants: 0, outOfStock: 0 };
  for (const p of products ?? []) {
    stats.total += 1;
    if (p.status === "ACTIVE") stats.active += 1;
    else if (p.status === "DRAFT") stats.draft += 1;
    else if (p.status === "ARCHIVED") stats.archived += 1;
    stats.variants += p.variants.length;
    for (const v of p.variants) if (isOutOfStock(v)) stats.outOfStock += 1;
  }
  return stats;
}

/** "1 variante" / "3 variantes". */
export function variantsLabel(count: number): string {
  return count === 1 ? "1 variante" : `${count} variantes`;
}
