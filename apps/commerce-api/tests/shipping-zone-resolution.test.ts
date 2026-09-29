import { describe, expect, it } from "vitest";
import { PricingService } from "../src/pricing/pricing.service.js";
import type { PrismaService } from "../src/prisma/prisma.service.js";

/**
 * Orden de precedencia de `resolveShippingZone` (T-SHIP-07):
 * polígono > CP > estado+ciudad > catch-all > flat del tenant.
 * Prisma se sustituye por un stub en memoria: aquí se prueba la regla, no
 * la consulta.
 */

const SQUARE = {
  type: "Polygon",
  coordinates: [
    [
      [-99.14, 19.42],
      [-99.12, 19.42],
      [-99.12, 19.44],
      [-99.14, 19.44],
      [-99.14, 19.42],
    ],
  ],
};

interface ZoneRow {
  id: string;
  name: string;
  postalCodes: string[];
  cityPattern: string | null;
  state: string | null;
  polygon: unknown;
  price: { toString(): string };
  sortOrder: number;
  active: boolean;
}

function zone(partial: Partial<ZoneRow> & { id: string; name: string; price: string }): ZoneRow {
  return {
    postalCodes: [],
    cityPattern: null,
    state: null,
    polygon: null,
    sortOrder: 0,
    active: true,
    ...partial,
    price: { toString: () => partial.price },
  };
}

function service(zones: ZoneRow[], flat = "99"): PricingService {
  const sorted = [...zones].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
  const prisma = {
    tenant: { findUnique: async () => ({ shippingFlat: { toString: () => flat } }) },
    deliveryZone: { findMany: async () => sorted.filter((z) => z.active) },
  } as unknown as PrismaService;
  return new PricingService(prisma);
}

const POLY = zone({ id: "poly", name: "Centro (mapa)", price: "35", polygon: SQUARE, sortOrder: 5 });
const CP = zone({ id: "cp", name: "Centro CP", price: "40", postalCodes: ["06000"], sortOrder: 1 });
const CITY = zone({ id: "city", name: "GDL", price: "80", cityPattern: "Guadalajara", state: "JAL" });
const ALL = zone({ id: "all", name: "Resto", price: "120", sortOrder: 99 });

describe("resolveShippingZone", () => {
  it("polígono gana sobre CP aunque tenga sortOrder mayor", async () => {
    const r = await service([CP, POLY, ALL]).resolveShippingZone("t1", {
      postalCode: "06000",
      lat: 19.43,
      lng: -99.13,
    });
    expect(r).toMatchObject({ zoneId: "poly", price: "35.00", fallback: false, matchedBy: "polygon" });
  });

  it("entre polígonos gana el de menor sortOrder", async () => {
    const big = zone({ id: "big", name: "Grande", price: "10", polygon: SQUARE, sortOrder: 1 });
    const r = await service([POLY, big]).resolveShippingZone("t1", { lat: 19.43, lng: -99.13 });
    expect(r.zoneId).toBe("big");
  });

  it("punto fuera del polígono cae al CP", async () => {
    const r = await service([POLY, CP, ALL]).resolveShippingZone("t1", {
      postalCode: "06000",
      lat: 19.5,
      lng: -99.3,
    });
    expect(r).toMatchObject({ zoneId: "cp", matchedBy: "postalCode" });
  });

  it("sin lat/lng ignora polígonos y sigue con CP → ciudad → catch-all", async () => {
    const s = service([POLY, CP, CITY, ALL]);
    expect((await s.resolveShippingZone("t1", { postalCode: "06000" })).matchedBy).toBe("postalCode");
    expect(
      (await s.resolveShippingZone("t1", { city: "Guadalajara Centro", state: "jal" })).matchedBy,
    ).toBe("city");
    const r = await s.resolveShippingZone("t1", { postalCode: "99999" });
    expect(r).toMatchObject({ zoneId: "all", matchedBy: "catchAll", fallback: false });
  });

  it("lat sin lng (o fuera de rango) no cuenta como punto", async () => {
    const r = await service([POLY, ALL]).resolveShippingZone("t1", { lat: 19.43 });
    expect(r.matchedBy).toBe("catchAll");
    const r2 = await service([POLY, ALL]).resolveShippingZone("t1", { lat: 999, lng: -99.13 });
    expect(r2.matchedBy).toBe("catchAll");
  });

  it("una zona con polígono NO es catch-all", async () => {
    const r = await service([POLY]).resolveShippingZone("t1", { postalCode: "06000" });
    expect(r).toMatchObject({ zoneId: null, fallback: true, matchedBy: "fallback", price: "99.00" });
  });

  it("sin zonas activas devuelve el flat del tenant", async () => {
    const inactive = zone({ id: "x", name: "X", price: "1", active: false });
    const r = await service([inactive], "55").resolveShippingZone("t1", { lat: 19.43, lng: -99.13 });
    expect(r).toMatchObject({ price: "55.00", fallback: true, matchedBy: "fallback" });
  });
});
