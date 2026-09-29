/**
 * Helpers puros de geometría y color para el editor de zonas de envío.
 * Sin React ni Leaflet: se pueden probar y reutilizar. Convención GeoJSON:
 * `[lng, lat]`. Leaflet usa `[lat, lng]`; la conversión vive aquí para que el
 * resto del editor no mezcle órdenes.
 */

export type LngLat = [number, number];
export type LatLng = [number, number];

export interface GeoPolygon {
  type: "Polygon";
  coordinates: LngLat[][];
}

export interface GeoMultiPolygon {
  type: "MultiPolygon";
  coordinates: LngLat[][][];
}

export type ZoneGeometry = GeoPolygon | GeoMultiPolygon;

/** Mismo tope que el backend (`shipping/geo.ts`). */
export const MAX_POLYGON_VERTICES = 2000;

function isLngLat(v: unknown): v is LngLat {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

/** ¿El JSON que llegó del API es un Polygon/MultiPolygon con forma válida? */
export function isZoneGeometry(value: unknown): value is ZoneGeometry {
  if (!value || typeof value !== "object") return false;
  const g = value as { type?: unknown; coordinates?: unknown };
  if (g.type === "Polygon") {
    return (
      Array.isArray(g.coordinates) &&
      g.coordinates.length > 0 &&
      g.coordinates.every((ring) => Array.isArray(ring) && ring.every(isLngLat))
    );
  }
  if (g.type === "MultiPolygon") {
    return (
      Array.isArray(g.coordinates) &&
      g.coordinates.length > 0 &&
      g.coordinates.every(
        (poly) =>
          Array.isArray(poly) &&
          poly.length > 0 &&
          poly.every((ring) => Array.isArray(ring) && ring.every(isLngLat)),
      )
    );
  }
  return false;
}

/** Polígonos → anillos → `[lat, lng]`, la forma que espera `L.polygon`. */
export function geometryToLatLngs(g: ZoneGeometry): LatLng[][][] {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.map((rings) => rings.map((ring) => ring.map(([lng, lat]) => [lat, lng] as LatLng)));
}

/** Vértices únicos (sin el punto de cierre de cada anillo). */
export function countVertices(g: ZoneGeometry | null | undefined): number {
  if (!g) return 0;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  let n = 0;
  for (const rings of polys) {
    for (const ring of rings) {
      if (ring.length === 0) continue;
      const first = ring[0];
      const last = ring[ring.length - 1];
      const closed = first && last && first[0] === last[0] && first[1] === last[1];
      n += closed ? ring.length - 1 : ring.length;
    }
  }
  return n;
}

/**
 * Si la geometría es un `Polygon` simple (un solo anillo, sin agujeros), sus
 * vértices sin el cierre: es lo que el editor del panel sabe manipular. Para
 * `MultiPolygon` o polígonos con agujeros devuelve `null` (se muestran pero
 * no se editan vértice a vértice).
 */
export function editableRing(g: ZoneGeometry | null | undefined): LngLat[] | null {
  if (!g || g.type !== "Polygon" || g.coordinates.length !== 1) return null;
  const ring = g.coordinates[0] ?? [];
  if (ring.length < 4) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first && last && first[0] === last[0] && first[1] === last[1];
  return closed ? ring.slice(0, -1) : ring.slice();
}

/** Vértices del editor (≥3) → GeoJSON Polygon cerrado. `null` si faltan puntos. */
export function ringToGeometry(vertices: LngLat[]): GeoPolygon | null {
  if (vertices.length < 3) return null;
  const first = vertices[0];
  if (!first) return null;
  const ring: LngLat[] = [...vertices.map(([lng, lat]) => [lng, lat] as LngLat), [first[0], first[1]]];
  return { type: "Polygon", coordinates: [ring] };
}

/** Caja envolvente `[[latMin, lngMin], [latMax, lngMax]]` o `null` si no hay puntos. */
export function boundsOf(points: LatLng[]): [LatLng, LatLng] | null {
  if (points.length === 0) return null;
  let latMin = Infinity;
  let latMax = -Infinity;
  let lngMin = Infinity;
  let lngMax = -Infinity;
  for (const [lat, lng] of points) {
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
    if (lng < lngMin) lngMin = lng;
    if (lng > lngMax) lngMax = lng;
  }
  return [
    [latMin, lngMin],
    [latMax, lngMax],
  ];
}

// ---------------------------------------------------------------------------
// Color: la paleta de zonas sale de los tokens del tema (nunca hex crudo en
// TSX). `<input type="color">` y Leaflet necesitan hex, así que se resuelve
// el `hsl` de la variable CSS en runtime.
// ---------------------------------------------------------------------------

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v);
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/**
 * Resuelve un token del tema (`brand`, `info`, …) a hex leyendo la variable
 * CSS `--<token>` ("h s% l%" en `globals.css`). Solo en cliente; en servidor o
 * si la variable no existe devuelve `null`.
 */
export function resolveTokenColor(token: string): string | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim();
  if (!raw) return null;
  if (HEX_RE.test(raw)) return raw.toLowerCase();
  const parts = raw.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;
  const h = Number.parseFloat(parts[0] ?? "");
  const s = Number.parseFloat(parts[1] ?? "");
  const l = Number.parseFloat(parts[2] ?? "");
  if (![h, s, l].every(Number.isFinite)) return null;
  return hslToHex(h, s, l);
}

/** Tokens del tema que sirven de paleta por defecto para las zonas, en orden. */
export const ZONE_PALETTE_TOKENS = ["brand", "info", "warning", "destructive", "success", "highlight", "primary"] as const;

/** Paleta resuelta a hex (solo cliente). Vacía en servidor. */
export function zonePalette(): string[] {
  const out: string[] = [];
  for (const token of ZONE_PALETTE_TOKENS) {
    const hex = resolveTokenColor(token);
    if (hex && !out.includes(hex)) out.push(hex);
  }
  return out;
}

/** Color efectivo de una zona: el guardado o uno de la paleta por índice. */
export function zoneColor(saved: string | null | undefined, index: number, palette: string[]): string {
  if (isHexColor(saved)) return saved.toLowerCase();
  if (palette.length === 0) return resolveTokenColor("foreground") ?? "currentColor";
  return palette[index % palette.length] ?? palette[0]!;
}

/** Ubicación por defecto del mapa cuando no hay zonas: centro de México. */
export const DEFAULT_CENTER: LatLng = [23.6345, -102.5528];
export const DEFAULT_ZOOM = 5;
