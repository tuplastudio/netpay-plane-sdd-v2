import { describe, expect, it } from "vitest";
import { syncItems } from "../src/data-sources/sync-engine.js";
import type { PrismaService } from "../src/prisma/prisma.service.js";

/**
 * Prisma falso en memoria con lo justo que usa el motor: productos y
 * variantes de un tenant, con los filtros que el motor emplea.
 */
interface Product {
  id: string;
  tenantId: string;
  sku: string;
  title: string;
  description: string | null;
  tags: string[];
  status: string;
  version: number;
}
interface Variant {
  id: string;
  tenantId: string;
  productId: string;
  sku: string;
  title: string;
  price: string;
  currency: string;
  stock: string | null;
  status: string;
  originSystem: string | null;
  originExternalId: string | null;
  version: number;
}

function fakePrisma() {
  const products: Product[] = [];
  const variants: Variant[] = [];
  let seq = 0;
  const nextId = () => `id-${++seq}`;
  const writes: string[] = [];

  const matchVariant = (v: Variant, where: Record<string, unknown>): boolean => {
    for (const [k, cond] of Object.entries(where)) {
      if (k === "NOT") {
        const not = cond as Record<string, unknown>;
        if (matchVariant(v, not)) return false;
        continue;
      }
      if (k === "status" && typeof cond === "object" && cond && "not" in cond) {
        if (v.status === (cond as { not: string }).not) return false;
        continue;
      }
      if (k === "id" && typeof cond === "object" && cond && "in" in cond) {
        if (!(cond as { in: string[] }).in.includes(v.id)) return false;
        continue;
      }
      if (k === "originExternalId" && typeof cond === "object" && cond && "in" in cond) {
        if (!(cond as { in: string[] }).in.includes(v.originExternalId ?? "")) return false;
        continue;
      }
      if ((v as unknown as Record<string, unknown>)[k] !== cond) return false;
    }
    return true;
  };

  const withProduct = (v: Variant) => ({ ...v, product: products.find((p) => p.id === v.productId)! });

  const prisma = {
    productVariant: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const found = variants.find((v) => matchVariant(v, where));
        return found ? withProduct(found) : null;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        variants.filter((v) => matchVariant(v, where)).map((v) => ({ id: v.id, productId: v.productId })),
      count: async ({ where }: { where: Record<string, unknown> }) => variants.filter((v) => matchVariant(v, where)).length,
      create: async ({ data }: { data: Omit<Variant, "id" | "version"> }) => {
        writes.push("variant.create");
        const row = { ...data, id: nextId(), version: 1 };
        variants.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        writes.push("variant.update");
        const row = variants.find((v) => v.id === where.id)!;
        const { version: _v, ...rest } = data;
        Object.assign(row, rest, { version: row.version + 1 });
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        writes.push("variant.updateMany");
        const rows = variants.filter((v) => matchVariant(v, where));
        const { version: _v, ...rest } = data;
        for (const row of rows) Object.assign(row, rest, { version: row.version + 1 });
        return { count: rows.length };
      },
    },
    product: {
      findFirst: async ({ where }: { where: { tenantId: string; sku: string } }) =>
        products.find((p) => p.tenantId === where.tenantId && p.sku === where.sku) ?? null,
      create: async ({ data }: { data: Record<string, unknown> & { variants: { create: Array<Omit<Variant, "id" | "productId" | "version">> } } }) => {
        writes.push("product.create");
        const { variants: nested, ...rest } = data;
        const product: Product = { ...(rest as Omit<Product, "id" | "version">), id: nextId(), version: 1 };
        products.push(product);
        for (const v of nested.create) variants.push({ ...v, id: nextId(), productId: product.id, version: 1 });
        return product;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        writes.push("product.update");
        const row = products.find((p) => p.id === where.id)!;
        const { version: _v, ...rest } = data;
        Object.assign(row, rest, { version: row.version + 1 });
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        writes.push("product.updateMany");
        const ids = (where.id as { in: string[] }).in;
        const rows = products.filter(
          (p) =>
            ids.includes(p.id) &&
            p.status !== "ARCHIVED" &&
            !variants.some((v) => v.productId === p.id && v.status !== "ARCHIVED"),
        );
        const { version: _v, ...rest } = data;
        for (const row of rows) Object.assign(row, rest, { version: row.version + 1 });
        return { count: rows.length };
      },
    },
  };
  return { prisma: prisma as unknown as PrismaService, products, variants, writes };
}

const source = { id: "ds-1", tenantId: "t-1", deactivateMissing: false };
const fieldMap = { sku: "sku", name: "name", price: "price", stock: "qty", active: "active", externalId: "id", category: "cat" };
const feed = [
  { id: 1, sku: "A-1", name: "Uno", price: 10, qty: 5, cat: "Tornillos" },
  { id: 2, sku: "B-2", name: "Dos", price: "20.5", qty: null },
];

describe("motor de sync: upsert idempotente", () => {
  it("crea productos con su variante marcando originSystem y luego no reescribe", async () => {
    const db = fakePrisma();
    const first = await syncItems(db.prisma, source, feed, fieldMap);
    expect(first.stats).toMatchObject({ fetched: 2, mapped: 2, created: 2, updated: 0, skipped: 0, errors: 0 });
    expect(db.products.map((p) => [p.sku, p.status, p.tags])).toEqual([
      ["A-1", "ACTIVE", ["tornillos"]],
      ["B-2", "ACTIVE", []],
    ]);
    expect(db.variants.map((v) => [v.sku, v.price, v.stock, v.originSystem, v.originExternalId])).toEqual([
      ["A-1", "10.00", "5.000", "ds-1", "1"],
      ["B-2", "20.50", null, "ds-1", "2"],
    ]);

    db.writes.length = 0;
    const second = await syncItems(db.prisma, source, feed, fieldMap);
    expect(second.stats).toMatchObject({ created: 0, updated: 0, skipped: 2, errors: 0 });
    expect(db.writes).toEqual([]);
  });

  it("actualiza solo lo que cambió y adopta variantes existentes por SKU", async () => {
    const db = fakePrisma();
    db.products.push({ id: "p-manual", tenantId: "t-1", sku: "A-1", title: "Manual", description: null, tags: [], status: "DRAFT", version: 1 });
    db.variants.push({
      id: "v-manual",
      tenantId: "t-1",
      productId: "p-manual",
      sku: "A-1",
      title: "Manual",
      price: "9.00",
      currency: "MXN",
      stock: null,
      status: "DRAFT",
      originSystem: null,
      originExternalId: null,
      version: 1,
    });
    const result = await syncItems(db.prisma, source, [feed[0]], fieldMap);
    expect(result.stats).toMatchObject({ created: 0, updated: 1 });
    const v = db.variants[0]!;
    expect(v).toMatchObject({ title: "Uno", price: "10.00", stock: "5.000", status: "ACTIVE", originSystem: "ds-1", originExternalId: "1", version: 2 });
    expect(db.products[0]).toMatchObject({ title: "Uno", status: "ACTIVE", tags: ["tornillos"] });

    // Cambia el precio en la fuente: una sola escritura de variante.
    db.writes.length = 0;
    const again = await syncItems(db.prisma, source, [{ ...feed[0], price: 11 }], fieldMap);
    expect(again.stats.updated).toBe(1);
    expect(db.writes).toEqual(["variant.update"]);
    expect(db.variants[0]!.price).toBe("11.00");
  });

  it("separa ítems inválidos y duplicados sin frenar el resto", async () => {
    const db = fakePrisma();
    const result = await syncItems(
      db.prisma,
      source,
      [{ id: 1, sku: "A", name: "a", price: 1 }, { id: 9, name: "sin sku", price: 1 }, { id: 1, sku: "A2", name: "dup", price: 1 }],
      fieldMap,
    );
    expect(result.stats).toMatchObject({ fetched: 3, mapped: 1, created: 1, errors: 2 });
    expect(result.errors).toEqual([
      { index: 1, message: expect.stringContaining("sku vacío") },
      { index: 2, sku: "A2", message: expect.stringContaining("duplicado") },
    ]);
  });

  it("un ítem inactivo archiva la variante (y el producto si queda vacío); si no existe, no se crea", async () => {
    const db = fakePrisma();
    await syncItems(db.prisma, source, feed, fieldMap);
    const result = await syncItems(db.prisma, source, [{ ...feed[0], active: false }, { id: 3, sku: "C", name: "c", price: 1, active: "no" }], fieldMap);
    expect(result.stats).toMatchObject({ updated: 1, skipped: 1, created: 0 });
    expect(db.variants.find((v) => v.sku === "A-1")!.status).toBe("ARCHIVED");
    expect(db.products.find((p) => p.sku === "A-1")!.status).toBe("ARCHIVED");
    expect(db.products.find((p) => p.sku === "C")).toBeUndefined();
  });

  it("deactivateMissing archiva lo de ESTA fuente que ya no viene, nunca borra ni toca otras fuentes", async () => {
    const db = fakePrisma();
    await syncItems(db.prisma, source, feed, fieldMap);
    await syncItems(db.prisma, { ...source, id: "ds-2" }, [{ id: 50, sku: "Z", name: "z", price: 1 }], fieldMap);

    const result = await syncItems(db.prisma, { ...source, deactivateMissing: true }, [feed[1]], fieldMap);
    expect(result.stats.deactivated).toBe(1);
    expect(db.variants.map((v) => [v.sku, v.status])).toEqual([
      ["A-1", "ARCHIVED"],
      ["B-2", "ACTIVE"],
      ["Z", "ACTIVE"],
    ]);
    expect(db.products.map((p) => [p.sku, p.status])).toEqual([
      ["A-1", "ARCHIVED"],
      ["B-2", "ACTIVE"],
      ["Z", "ACTIVE"],
    ]);
    expect(db.variants).toHaveLength(3);

    // Con cero ítems válidos no se archiva nada (endpoint roto ≠ catálogo vacío).
    const empty = await syncItems(db.prisma, { ...source, deactivateMissing: true }, [], fieldMap);
    expect(empty.stats.deactivated).toBe(0);
    expect(db.variants.find((v) => v.sku === "B-2")!.status).toBe("ACTIVE");
  });
});
