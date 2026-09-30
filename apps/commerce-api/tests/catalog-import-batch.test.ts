import { describe, expect, it } from "vitest";
import { CatalogService } from "../src/catalog/catalog.service.js";

/**
 * Importación CSV: la existencia de skus se resuelve con UNA consulta
 * `IN (...)` por job, no con un `findFirst` por fila (10 000 filas eran
 * 10 000 viajes a la base). Se fija el conteo de consultas y que el
 * resultado (crear/actualizar/errores) no cambió.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";

interface Row {
  [key: string]: unknown;
}

function makeDb(existingSkus: string[]) {
  const variants: Row[] = existingSkus.map((sku, i) => ({
    id: `v-${i}`,
    tenantId: TENANT,
    sku,
    satProductCode: "01010101",
    satUnitCode: "H87",
  }));
  const calls = { findMany: 0, findFirst: 0, update: 0, productCreate: 0 };
  const prisma = {
    productVariant: {
      findMany: async ({ where }: { where: { tenantId: string; sku: { in: string[] } } }) => {
        calls.findMany += 1;
        return variants.filter((v) => v.tenantId === where.tenantId && where.sku.in.includes(v.sku as string));
      },
      findFirst: async () => {
        calls.findFirst += 1;
        return null;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        calls.update += 1;
        const v = variants.find((x) => x.id === where.id)!;
        Object.assign(v, data);
        return v;
      },
    },
    product: {
      create: async ({ data }: { data: { sku: string } }) => {
        calls.productCreate += 1;
        return { id: `p-${data.sku}`, variants: [{ id: `nv-${data.sku}` }] };
      },
    },
  };
  return { prisma, calls };
}

const rows = [
  { sku: "A-1", title: "Uno", price: "10.00" },
  { sku: "B-2", title: "Dos", price: "20.00" },
  { sku: "A-1", title: "Repetido", price: "30.00" },
  { sku: "C-3", title: "Tres", price: "mal" },
  { sku: "", title: "Sin sku", price: "1.00" },
];

describe("CatalogService.dryRunImport", () => {
  it("una sola consulta de skus y conteos correctos", async () => {
    const db = makeDb(["A-1"]);
    const svc = new CatalogService(db.prisma as never);
    const result = await svc.dryRunImport(TENANT, rows);
    expect(db.calls.findMany).toBe(1);
    expect(db.calls.findFirst).toBe(0);
    expect(result.totalRows).toBe(5);
    // A-1 (existe) cuenta como update dos veces (la fila repetida también
    // se evalúa, como antes), B-2 y C-3 como create; la fila sin sku no cuenta.
    expect(result.wouldUpdate).toBe(2);
    expect(result.wouldCreate).toBe(2);
    expect(result.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(result.errors[0]!.errors).toContain("sku duplicado en fila 0");
  });

  it("archivo vacío: no toca la base", async () => {
    const db = makeDb([]);
    const svc = new CatalogService(db.prisma as never);
    const result = await svc.dryRunImport(TENANT, []);
    expect(db.calls.findMany).toBe(0);
    expect(result.totalRows).toBe(0);
  });
});

describe("CatalogService.commitImport", () => {
  it("una sola consulta de skus; actualiza los existentes y crea los nuevos", async () => {
    const db = makeDb(["A-1"]);
    const svc = new CatalogService(db.prisma as never);
    const summary = await svc.commitImport(TENANT, null, rows);
    expect(db.calls.findMany).toBe(1);
    expect(db.calls.findFirst).toBe(0);
    expect(summary.updated).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.skipped).toBe(3);
    expect(db.calls.update).toBe(1);
    expect(db.calls.productCreate).toBe(1);
    expect(summary.results).toEqual([
      { row: 0, sku: "A-1", action: "updated", id: "v-0" },
      { row: 1, sku: "B-2", action: "created", id: "nv-B-2" },
    ]);
  });
});
