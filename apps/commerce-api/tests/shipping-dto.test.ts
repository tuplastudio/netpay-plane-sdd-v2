import { describe, expect, it } from "vitest";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CreateDeliveryZoneDto,
  LookupDeliveryZoneDto,
  UpdateDeliveryZoneDto,
} from "../src/shipping/delivery-zone.dto.js";
import { isCatchAllZone } from "../src/shipping/zone-rules.js";

/**
 * Validación del DTO de zonas con polígono (T-SHIP-07): el decorador
 * `IsZoneGeometry` devuelve el error concreto de `validateZoneGeometry`, y
 * `color`/`lat`/`lng` se acotan. `isCatchAllZone` no considera catch-all a
 * una zona con polígono.
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

async function errorsOf(dto: object): Promise<string[]> {
  const errs = await validate(dto);
  return errs.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("CreateDeliveryZoneDto.polygon", () => {
  it("acepta un Polygon válido y color hex", async () => {
    const dto = plainToInstance(CreateDeliveryZoneDto, {
      name: "Centro",
      price: 35,
      polygon: SQUARE,
      color: "#00d4a4",
    });
    expect(await errorsOf(dto)).toEqual([]);
  });

  it("rechaza anillo abierto con el mensaje del validador", async () => {
    const open = { type: "Polygon", coordinates: [SQUARE.coordinates[0]!.slice(0, 4)] };
    const dto = plainToInstance(CreateDeliveryZoneDto, { name: "X", price: 1, polygon: open });
    const errs = await errorsOf(dto);
    expect(errs.some((m) => /cerrado/.test(m))).toBe(true);
  });

  it("rechaza un tipo GeoJSON que no sea Polygon/MultiPolygon", async () => {
    const dto = plainToInstance(CreateDeliveryZoneDto, {
      name: "X",
      price: 1,
      polygon: { type: "Point", coordinates: [0, 0] },
    });
    expect((await errorsOf(dto)).length).toBeGreaterThan(0);
  });

  it("rechaza color que no sea #rrggbb", async () => {
    const dto = plainToInstance(CreateDeliveryZoneDto, { name: "X", price: 1, color: "red" });
    expect((await errorsOf(dto)).some((m) => /#rrggbb/.test(m))).toBe(true);
  });
});

describe("UpdateDeliveryZoneDto.polygon", () => {
  it("acepta null para quitar el polígono", async () => {
    const dto = plainToInstance(UpdateDeliveryZoneDto, { polygon: null });
    expect(await errorsOf(dto)).toEqual([]);
  });
});

describe("LookupDeliveryZoneDto lat/lng", () => {
  it("acota lat a [-90, 90] y lng a [-180, 180]", async () => {
    const bad = plainToInstance(LookupDeliveryZoneDto, { lat: 95, lng: -99 });
    expect((await errorsOf(bad)).length).toBeGreaterThan(0);
    const ok = plainToInstance(LookupDeliveryZoneDto, { lat: 19.43, lng: -99.13 });
    expect(await errorsOf(ok)).toEqual([]);
  });
});

describe("isCatchAllZone", () => {
  it("una zona solo con polígono NO es catch-all", () => {
    expect(isCatchAllZone({ polygon: SQUARE })).toBe(false);
    expect(isCatchAllZone({ postalCodes: [], cityPattern: null, state: null, polygon: null })).toBe(true);
    expect(isCatchAllZone({ postalCodes: ["06000"] })).toBe(false);
    expect(isCatchAllZone({ state: "JAL" })).toBe(false);
  });
});
