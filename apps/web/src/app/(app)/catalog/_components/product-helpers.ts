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

/** Suma de existencias de las variantes con control de inventario. */
export function totalStock(product: Pick<Product, "variants">): number {
  let total = 0;
  for (const v of product.variants) {
    if (v.stock === null) continue;
    const n = Number.parseFloat(v.stock);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

/** Precio mínimo numérico, solo para ordenar; +∞ si no hay variantes. */
export function minPrice(product: Product): number {
  const range = priceRange(product);
  return range ? Number.parseFloat(range.min) : Number.POSITIVE_INFINITY;
}

export type StockFilter = "" | "in" | "out" | "external";
export type SortKey = "updated" | "title" | "price-asc" | "price-desc" | "stock";

export interface LocalFilters {
  stock: StockFilter;
  tag: string;
  priceMin: string;
  priceMax: string;
  sort: SortKey;
}

export const EMPTY_LOCAL_FILTERS: LocalFilters = {
  stock: "",
  tag: "",
  priceMin: "",
  priceMax: "",
  sort: "updated",
};

/** True si algún filtro fino (no el orden) está activo. */
export function hasLocalFilters(f: LocalFilters): boolean {
  return f.stock !== "" || f.tag !== "" || f.priceMin.trim() !== "" || f.priceMax.trim() !== "";
}

/** Cuántos filtros finos están activos (para la píldora del botón "Más filtros"). */
export function countLocalFilters(f: LocalFilters): number {
  return [f.stock, f.tag, f.priceMin.trim(), f.priceMax.trim()].filter(Boolean).length;
}

function parseBound(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Filtros locales sobre la página cargada (el API solo entiende `q` y
 * `status`). Devuelve `undefined` mientras no hay datos para que el render
 * siga distinguiendo "cargando" de "vacío". No muta la lista original.
 */
export function applyLocalFilters(
  products: Product[] | undefined,
  f: LocalFilters,
): Product[] | undefined {
  if (!products) return undefined;
  const min = parseBound(f.priceMin);
  const max = parseBound(f.priceMax);
  const out = products.filter((p) => {
    if (f.tag && !p.tags.includes(f.tag)) return false;
    if (f.stock === "out" && !p.variants.some(isOutOfStock)) return false;
    if (f.stock === "in" && !p.variants.some((v) => v.stock !== null && !isOutOfStock(v))) return false;
    if (f.stock === "external" && !p.variants.some((v) => v.stock === null)) return false;
    if (min !== null || max !== null) {
      const range = priceRange(p);
      if (!range) return false;
      const lo = Number.parseFloat(range.min);
      const hi = Number.parseFloat(range.max);
      // Coincide si alguna variante cae dentro del rango pedido.
      if (min !== null && hi < min) return false;
      if (max !== null && lo > max) return false;
    }
    return true;
  });
  switch (f.sort) {
    case "title":
      out.sort((a, b) => a.title.localeCompare(b.title, "es"));
      break;
    case "price-asc":
      out.sort((a, b) => minPrice(a) - minPrice(b));
      break;
    case "price-desc":
      out.sort((a, b) => minPrice(b) - minPrice(a));
      break;
    case "stock":
      out.sort((a, b) => totalStock(a) - totalStock(b));
      break;
    default:
      out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return out;
}

/** Tags distintos de la página, ordenados para el selector de filtro. */
export function collectTags(products: Product[] | undefined): string[] {
  const set = new Set<string>();
  for (const p of products ?? []) for (const t of p.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b, "es"));
}
