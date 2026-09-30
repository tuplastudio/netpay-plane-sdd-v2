import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { CatalogService, nextCopySku } from "../src/catalog/catalog.service.js";

/**
 * Galería de fotos (orden, portada, texto alternativo) y duplicado de
 * producto. Prisma es un fake en memoria: lo que importa es la lógica de
 * posiciones y las reglas de validación, no el SQL.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "99999999-9999-9999-9999-999999999999";
const PRODUCT = "22222222-2222-2222-2222-222222222222";
const VARIANT = "33333333-3333-3333-3333-333333333333";
const IMG = (n: number) => `aaaaaaaa-aaaa-aaaa-aaaa-${String(n).padStart(12, "0")}`;

interface ImageRow {
  id: string;
  tenantId: string;
  productId: string;
  variantId: string | null;
  position: number;
  altText: string | null;
  storageKey: string;
}

interface ProductRow {
  id: string;
  tenantId: string;
  sku: string;
  title: string;
  description: string | null;
  tags: string[];
  synonyms: string[];
  status: string;
  variants: Array<{
    id: string;
    sku: string;
    title: string;
    price: string;
    currency: string;
    stock: string | null;
    satProductCode: string;
    satUnitCode: string;
    createdAt: Date;
  }>;
}

type Where = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: Where): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === "object" && "in" in (v as object)) {
      if (!(v as { in: unknown[] }).in.includes(row[k])) return false;
    } else if (row[k] !== v) {
      return false;
    }
  }
  return true;
}

function makeFakePrisma(opts: { images?: ImageRow[]; products?: ProductRow[] } = {}) {
  const images: ImageRow[] = opts.images ?? [];
  const products: ProductRow[] = opts.products ?? [];
  const audit: Array<Record<string, unknown>> = [];
  const created: Array<Record<string, unknown>> = [];

  const sortByPosition = (rows: ImageRow[]) => [...rows].sort((a, b) => a.position - b.position);

  const prisma = {
    audit,
    created,
    images,
    productImage: {
      findFirst: async ({ where }: { where: Where }) => images.find((i) => matches(i, where)) ?? null,
      findMany: async ({ where }: { where: Where }) => sortByPosition(images.filter((i) => matches(i, where))),
      count: async ({ where }: { where: Where }) => images.filter((i) => matches(i, where)).length,
      update: async ({ where, data }: { where: { id: string }; data: Partial<ImageRow> }) => {
        const row = images.find((i) => i.id === where.id);
        if (!row) throw new Error(`no image ${where.id}`);
        Object.assign(row, data);
        return row;
      },
    },
    product: {
      findFirst: async ({ where }: { where: Where }) => {
        const p = products.find((x) => x.id === where.id && x.tenantId === where.tenantId);
        return p ? { ...p } : null;
      },
      findMany: async ({ where }: { where: Where }) =>
        products.filter((p) => p.tenantId === where.tenantId).map((p) => ({ sku: p.sku })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        const variants = (data.variants as { create: Array<Record<string, unknown>> }).create;
        return { id: "new-product", ...data, variants, images: [] };
      },
    },
    productVariant: {
      findMany: async ({ where }: { where: Where }) =>
        products
          .filter((p) => p.tenantId === where.tenantId)
          .flatMap((p) => p.variants.map((v) => ({ sku: v.sku }))),
    },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => void audit.push(data) },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  };
  return prisma;
}

function gallery(): ImageRow[] {
  const mk = (n: number, variantId: string | null, position: number): ImageRow => ({
    id: IMG(n),
    tenantId: TENANT,
    productId: PRODUCT,
    variantId,
    position,
    altText: null,
    storageKey: `k${n}`,
  });
  return [mk(1, null, 0), mk(2, null, 1), mk(3, null, 2), mk(4, VARIANT, 0)];
}

const productRow = (): ProductRow => ({
  id: PRODUCT,
  tenantId: TENANT,
  sku: "PROD-1",
  title: "Producto uno",
  description: "desc",
  tags: ["a"],
  synonyms: ["b"],
  status: "ACTIVE",
  variants: [
    {
      id: VARIANT,
      sku: "PROD-1-A",
      title: "A",
      price: "10.00",
      currency: "MXN",
      stock: "5",
      satProductCode: "01010101",
      satUnitCode: "H87",
      createdAt: new Date("2026-01-01"),
    },
  ],
});

function service(prisma: ReturnType<typeof makeFakePrisma>) {
  return new CatalogService(prisma as never);
}

describe("reorderImages", () => {
  it("asigna posiciones 0..n-1 en el orden pedido y devuelve la galería", async () => {
    const prisma = makeFakePrisma({ images: gallery(), products: [productRow()] });
    const out = await service(prisma).reorderImages(TENANT, PRODUCT, [IMG(3), IMG(1), IMG(2)]);
    expect(out.map((i) => i.id)).toEqual([IMG(3), IMG(1), IMG(2)]);
    expect(out.map((i) => i.position)).toEqual([0, 1, 2]);
    // La galería de la variante no se toca.
    expect(prisma.images.find((i) => i.id === IMG(4))!.position).toBe(0);
  });

  it("rechaza fotos que no son del producto (o de otro tenant)", async () => {
    const foreign: ImageRow = { ...gallery()[0]!, id: IMG(9), tenantId: OTHER_TENANT };
    const prisma = makeFakePrisma({ images: [...gallery(), foreign], products: [productRow()] });
    await expect(
      service(prisma).reorderImages(TENANT, PRODUCT, [IMG(1), IMG(2), IMG(9)]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rechaza mezclar la galería del producto con la de una variante", async () => {
    const prisma = makeFakePrisma({ images: gallery(), products: [productRow()] });
    await expect(
      service(prisma).reorderImages(TENANT, PRODUCT, [IMG(1), IMG(4)]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("exige el orden completo de la galería", async () => {
    const prisma = makeFakePrisma({ images: gallery(), products: [productRow()] });
    await expect(service(prisma).reorderImages(TENANT, PRODUCT, [IMG(2), IMG(1)])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("404 si el producto no es del tenant", async () => {
    const prisma = makeFakePrisma({ images: gallery(), products: [productRow()] });
    await expect(service(prisma).reorderImages(OTHER_TENANT, PRODUCT, [IMG(1)])).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("setPrimaryImage", () => {
  it("mueve la foto a la posición 0 y corre las demás", async () => {
    const prisma = makeFakePrisma({ images: gallery() });
    const out = await service(prisma).setPrimaryImage(TENANT, IMG(3), "user-1");
    expect(out.map((i) => i.id)).toEqual([IMG(3), IMG(1), IMG(2)]);
    expect(out.map((i) => i.position)).toEqual([0, 1, 2]);
    expect(prisma.audit[0]).toMatchObject({ action: "catalog.product_image_primary", targetId: PRODUCT });
  });

  it("en una variante solo reordena su propia galería", async () => {
    const prisma = makeFakePrisma({ images: gallery() });
    const out = await service(prisma).setPrimaryImage(TENANT, IMG(4), null);
    expect(out.map((i) => i.id)).toEqual([IMG(4)]);
    expect(prisma.audit[0]).toMatchObject({ action: "catalog.variant_image_primary", targetId: VARIANT });
    expect(prisma.images.find((i) => i.id === IMG(1))!.position).toBe(0);
  });

  it("404 para una foto de otro tenant", async () => {
    const prisma = makeFakePrisma({ images: gallery() });
    await expect(service(prisma).setPrimaryImage(OTHER_TENANT, IMG(1), null)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("updateImage", () => {
  it("guarda el altText recortado y lo audita", async () => {
    const prisma = makeFakePrisma({ images: gallery() });
    const out = await service(prisma).updateImage(TENANT, IMG(1), "user-1", { altText: "  Frente  " });
    expect(out.altText).toBe("Frente");
    expect(prisma.audit[0]).toMatchObject({ action: "catalog.image_updated", metadata: { altText: "Frente" } });
  });

  it("vacío o null borran el texto; ausente no toca nada", async () => {
    const prisma = makeFakePrisma({ images: gallery() });
    prisma.images[0]!.altText = "algo";
    expect((await service(prisma).updateImage(TENANT, IMG(1), null, {})).altText).toBe("algo");
    expect(prisma.audit).toHaveLength(0);
    expect((await service(prisma).updateImage(TENANT, IMG(1), null, { altText: "   " })).altText).toBeNull();
    prisma.images[0]!.altText = "algo";
    expect((await service(prisma).updateImage(TENANT, IMG(1), null, { altText: null })).altText).toBeNull();
  });
});

describe("nextCopySku", () => {
  it("agrega -copia y numera si ya existe (sin distinguir mayúsculas)", () => {
    expect(nextCopySku("ABC", new Set())).toBe("ABC-copia");
    expect(nextCopySku("ABC", new Set(["abc-copia"]))).toBe("ABC-copia-2");
    expect(nextCopySku("ABC", new Set(["abc-copia", "abc-copia-2"]))).toBe("ABC-copia-3");
  });

  it("recorta la base para no pasar de 64 caracteres", () => {
    const long = "X".repeat(64);
    const sku = nextCopySku(long, new Set());
    expect(sku).toHaveLength(64);
    expect(sku.endsWith("-copia")).toBe(true);
  });
});

describe("duplicateProduct", () => {
  it("crea un borrador con SKUs -copia, título (copia) y sin fotos", async () => {
    const prisma = makeFakePrisma({ images: gallery(), products: [productRow()] });
    const out = await service(prisma).duplicateProduct(TENANT, "user-1", PRODUCT);
    const data = prisma.created[0]!;
    expect(data).toMatchObject({
      tenantId: TENANT,
      sku: "PROD-1-copia",
      title: "Producto uno (copia)",
      status: "DRAFT",
      createdById: "user-1",
      tags: ["a"],
      synonyms: ["b"],
    });
    const variants = (data.variants as { create: Array<Record<string, unknown>> }).create;
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({ sku: "PROD-1-A-copia", price: "10.00", status: "DRAFT", stock: "5" });
    expect(variants[0]).not.toHaveProperty("originSystem");
    expect(out.images).toEqual([]);
    expect(prisma.audit[0]).toMatchObject({ action: "catalog.product_duplicated", metadata: { sourceProductId: PRODUCT } });
  });

  it("numera el SKU cuando la copia anterior ya existe", async () => {
    const copy: ProductRow = { ...productRow(), id: "p2", sku: "prod-1-copia", variants: [] };
    const prisma = makeFakePrisma({ products: [productRow(), copy] });
    await service(prisma).duplicateProduct(TENANT, null, PRODUCT);
    expect(prisma.created[0]!.sku).toBe("PROD-1-copia-2");
  });

  it("404 si el producto no es del tenant", async () => {
    const prisma = makeFakePrisma({ products: [productRow()] });
    await expect(service(prisma).duplicateProduct(OTHER_TENANT, null, PRODUCT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
