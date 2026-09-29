import { describe, expect, it } from "vitest";
import {
  MAX_POLYGON_VERTICES,
  countVertices,
  pointInGeometry,
  pointInRing,
  validateZoneGeometry,
} from "../src/shipping/geo.js";

/**
 * Punto-en-polígono y validación GeoJSON de zonas de envío (T-SHIP-07).
 * Coordenadas [lng, lat]. Cuadrado "centro CDMX" aprox. alrededor del Zócalo.
 */

const SQUARE: [number, number][] = [
  [-99.14, 19.42],
  [-99.12, 19.42],
  [-99.12, 19.44],
  [-99.14, 19.44],
  [-99.14, 19.42],
];

const HOLE: [number, number][] = [
  [-99.135, 19.425],
  [-99.125, 19.425],
  [-99.125, 19.435],
  [-99.135, 19.435],
  [-99.135, 19.425],
];

const polygon = { type: "Polygon" as const, coordinates: [SQUARE] };
const polygonWithHole = { type: "Polygon" as const, coordinates: [SQUARE, HOLE] };
const FAR_SQUARE: [number, number][] = [
  [-100.4, 20.55],
  [-100.3, 20.55],
  [-100.3, 20.65],
  [-100.4, 20.65],
  [-100.4, 20.55],
];
const multi = { type: "MultiPolygon" as const, coordinates: [[SQUARE], [FAR_SQUARE]] };

describe("pointInRing", () => {
  it("detecta dentro y fuera", () => {
    expect(pointInRing(-99.13, 19.43, SQUARE)).toBe(true);
    expect(pointInRing(-99.10, 19.43, SQUARE)).toBe(false);
    expect(pointInRing(-99.13, 19.50, SQUARE)).toBe(false);
  });

  it("funciona aunque el anillo no repita el cierre", () => {
    expect(pointInRing(-99.13, 19.43, SQUARE.slice(0, 4))).toBe(true);
  });
});

describe("pointInGeometry", () => {
  it("Polygon simple", () => {
    expect(pointInGeometry(-99.13, 19.43, polygon)).toBe(true);
    expect(pointInGeometry(-99.20, 19.43, polygon)).toBe(false);
  });

  it("respeta agujeros", () => {
    // Centro del agujero: fuera de la zona.
    expect(pointInGeometry(-99.13, 19.43, polygonWithHole)).toBe(false);
    // Entre el contorno y el agujero: dentro.
    expect(pointInGeometry(-99.138, 19.422, polygonWithHole)).toBe(true);
  });

  it("MultiPolygon: cualquiera de los polígonos", () => {
    expect(pointInGeometry(-99.13, 19.43, multi)).toBe(true);
    expect(pointInGeometry(-100.35, 20.60, multi)).toBe(true);
    expect(pointInGeometry(-99.80, 20.00, multi)).toBe(false);
  });

  it("geometría malformada o coordenadas no numéricas → false, nunca lanza", () => {
    expect(pointInGeometry(-99.13, 19.43, null)).toBe(false);
    expect(pointInGeometry(-99.13, 19.43, { type: "Point", coordinates: [0, 0] })).toBe(false);
    expect(pointInGeometry(-99.13, 19.43, { type: "Polygon", coordinates: "x" })).toBe(false);
    expect(pointInGeometry(Number.NaN, 19.43, polygon)).toBe(false);
  });
});

describe("validateZoneGeometry", () => {
  it("acepta Polygon y MultiPolygon válidos y cuenta vértices sin el cierre", () => {
    const p = validateZoneGeometry(polygon);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.vertexCount).toBe(4);
    const h = validateZoneGeometry(polygonWithHole);
    if (h.ok) expect(h.vertexCount).toBe(8);
    expect(countVertices(multi)).toBe(8);
  });

  it("rechaza anillos abiertos", () => {
    const open = { type: "Polygon", coordinates: [SQUARE.slice(0, 4)] };
    const res = validateZoneGeometry(open);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/cerrado/);
  });

  it("rechaza menos de 3 vértices", () => {
    const tri = { type: "Polygon", coordinates: [[[0, 0], [1, 1], [0, 0]]] };
    expect(validateZoneGeometry(tri).ok).toBe(false);
  });

  it("rechaza lng/lat fuera de rango", () => {
    const bad = { type: "Polygon", coordinates: [[[-200, 0], [0, 0], [0, 1], [-200, 0]]] };
    const res = validateZoneGeometry(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/lng/);
    const badLat = { type: "Polygon", coordinates: [[[0, 95], [0, 0], [1, 0], [0, 95]]] };
    expect(validateZoneGeometry(badLat).ok).toBe(false);
  });

  it("rechaza tipos no soportados y coordenadas vacías", () => {
    expect(validateZoneGeometry({ type: "Point", coordinates: [0, 0] }).ok).toBe(false);
    expect(validateZoneGeometry({ type: "Polygon", coordinates: [] }).ok).toBe(false);
    expect(validateZoneGeometry("nope").ok).toBe(false);
    expect(validateZoneGeometry(null).ok).toBe(false);
  });

  it("rechaza más de MAX_POLYGON_VERTICES", () => {
    const ring: [number, number][] = [];
    for (let i = 0; i <= MAX_POLYGON_VERTICES; i++) {
      ring.push([-99 + i * 1e-6, 19 + (i % 2) * 1e-6]);
    }
    ring.push(ring[0]);
    const res = validateZoneGeometry({ type: "Polygon", coordinates: [ring] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/excede/);
  });
});
