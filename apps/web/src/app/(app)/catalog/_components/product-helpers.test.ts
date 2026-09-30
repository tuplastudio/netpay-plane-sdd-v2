import { describe, expect, it } from "vitest";
import type { Product, Variant } from "../catalog-shared";
import {
  EMPTY_LOCAL_FILTERS,
  applyLocalFilters,
  catalogStats,
  collectTags,
  countLocalFilters,
  hasLocalFilters,
  isOutOfStock,
  minPrice,
  priceRange,
  totalStock,
  variantsLabel,
} from "./product-helpers";

let seq = 0;
function variant(over: Partial<Variant> = {}): Variant {
  seq += 1;
  return {
    id: `v${seq}`,
    sku: `SKU-${seq}`,
    title: `Variante ${seq}`,
    price: "10.00",
    stock: null,
    satProductCode: "01010101",
    satUnitCode: "H87",
    status: "ACTIVE",
    version: 1,
    originSystem: null,
    originExternalId: null,
    images: [],
    ...over,
  };
}

function product(over: Partial<Product> = {}): Product {
  seq += 1;
  return {
    id: `p${seq}`,
    sku: `P-${seq}`,
    title: `Producto ${seq}`,
    description: null,
    tags: [],
    synonyms: [],
    status: "ACTIVE",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    variants: [variant()],
    images: [],
    ...over,
  };
}

describe("priceRange / minPrice / totalStock", () => {
  it("devuelve el rango con los strings originales", () => {
    const p = product({ variants: [variant({ price: "15.50" }), variant({ price: "9.99" }), variant({ price: "20.00" })] });
    expect(priceRange(p)).toEqual({ min: "9.99", max: "20.00" });
    expect(minPrice(p)).toBe(9.99);
    expect(priceRange(product({ variants: [] }))).toBeNull();
    expect(minPrice(product({ variants: [] }))).toBe(Number.POSITIVE_INFINITY);
  });

  it("suma solo variantes con control de inventario", () => {
    const p = product({ variants: [variant({ stock: "2.5" }), variant({ stock: null }), variant({ stock: "1" })] });
    expect(totalStock(p)).toBe(3.5);
  });
});

describe("isOutOfStock / catalogStats / variantsLabel", () => {
  it("sin control de inventario nunca está agotado", () => {
    expect(isOutOfStock(variant({ stock: null }))).toBe(false);
    expect(isOutOfStock(variant({ stock: "0" }))).toBe(true);
    expect(isOutOfStock(variant({ stock: "0.000" }))).toBe(true);
    expect(isOutOfStock(variant({ stock: "3" }))).toBe(false);
  });

  it("cuenta por estado, variantes y agotados", () => {
    const stats = catalogStats([
      product({ status: "ACTIVE", variants: [variant({ stock: "0" }), variant()] }),
      product({ status: "DRAFT" }),
      product({ status: "ARCHIVED", variants: [] }),
    ]);
    expect(stats).toEqual({ total: 3, active: 1, draft: 1, archived: 1, variants: 3, outOfStock: 1 });
    expect(catalogStats(undefined).total).toBe(0);
  });

  it("pluraliza", () => {
    expect(variantsLabel(1)).toBe("1 variante");
    expect(variantsLabel(4)).toBe("4 variantes");
  });
});

describe("applyLocalFilters", () => {
  const a = product({ title: "Zeta", tags: ["rojo"], updatedAt: "2026-03-01T00:00:00Z", variants: [variant({ price: "5.00", stock: "0" })] });
  const b = product({ title: "Alfa", tags: ["azul"], updatedAt: "2026-02-01T00:00:00Z", variants: [variant({ price: "50.00", stock: "4" })] });
  const c = product({ title: "Mu", tags: [], updatedAt: "2026-01-01T00:00:00Z", variants: [variant({ price: "20.00", stock: null })] });
  const all = [a, b, c];
  const ids = (list: Product[] | undefined) => list?.map((p) => p.id);

  it("undefined mientras no hay datos; por defecto ordena por actualización", () => {
    expect(applyLocalFilters(undefined, EMPTY_LOCAL_FILTERS)).toBeUndefined();
    expect(ids(applyLocalFilters([c, a, b], EMPTY_LOCAL_FILTERS))).toEqual([a.id, b.id, c.id]);
  });

  it("filtra por existencias", () => {
    expect(ids(applyLocalFilters(all, { ...EMPTY_LOCAL_FILTERS, stock: "out" }))).toEqual([a.id]);
    expect(ids(applyLocalFilters(all, { ...EMPTY_LOCAL_FILTERS, stock: "in" }))).toEqual([b.id]);
    expect(ids(applyLocalFilters(all, { ...EMPTY_LOCAL_FILTERS, stock: "external" }))).toEqual([c.id]);
  });

  it("filtra por tag y por rango de precio (coincide si alguna variante cae dentro)", () => {
    expect(ids(applyLocalFilters(all, { ...EMPTY_LOCAL_FILTERS, tag: "azul" }))).toEqual([b.id]);
    expect(ids(applyLocalFilters(all, { ...EMPTY_LOCAL_FILTERS, priceMin: "10" }))).toEqual([b.id, c.id]);
    expect(ids(applyLocalFilters(all, { ...EMPTY_LOCAL_FILTERS, priceMax: "20" }))).toEqual([a.id, c.id]);
    expect(ids(applyLocalFilters(all, { ...EMPTY_LOCAL_FILTERS, priceMin: "abc" }))).toEqual([a.id, b.id, c.id]);
    expect(ids(applyLocalFilters([product({ variants: [] })], { ...EMPTY_LOCAL_FILTERS, priceMin: "1" }))).toEqual([]);
  });

  it("ordena por nombre, precio y existencias sin mutar la entrada", () => {
    const input = [a, b, c];
    expect(ids(applyLocalFilters(input, { ...EMPTY_LOCAL_FILTERS, sort: "title" }))).toEqual([b.id, c.id, a.id]);
    expect(ids(applyLocalFilters(input, { ...EMPTY_LOCAL_FILTERS, sort: "price-asc" }))).toEqual([a.id, c.id, b.id]);
    expect(ids(applyLocalFilters(input, { ...EMPTY_LOCAL_FILTERS, sort: "price-desc" }))).toEqual([b.id, c.id, a.id]);
    expect(ids(applyLocalFilters(input, { ...EMPTY_LOCAL_FILTERS, sort: "stock" }))).toEqual([a.id, c.id, b.id]);
    expect(ids(input)).toEqual([a.id, b.id, c.id]);
  });
});

describe("hasLocalFilters / countLocalFilters / collectTags", () => {
  it("el orden no cuenta como filtro", () => {
    expect(hasLocalFilters({ ...EMPTY_LOCAL_FILTERS, sort: "title" })).toBe(false);
    expect(hasLocalFilters({ ...EMPTY_LOCAL_FILTERS, priceMax: " 5 " })).toBe(true);
    expect(countLocalFilters({ ...EMPTY_LOCAL_FILTERS, stock: "in", tag: "x", priceMin: " " })).toBe(2);
  });

  it("junta tags únicos ordenados", () => {
    expect(collectTags([product({ tags: ["b", "a"] }), product({ tags: ["a", "c"] })])).toEqual(["a", "b", "c"]);
    expect(collectTags(undefined)).toEqual([]);
  });
});
