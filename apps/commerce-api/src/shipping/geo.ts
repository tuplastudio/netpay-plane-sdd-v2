/**
 * Geometría de zonas de envío sin PostGIS (T-SHIP-07).
 *
 * Módulo puro (sin Nest, sin Prisma) para que se pueda probar en aislamiento
 * y reutilizar desde el DTO (validación) y desde `PricingService`
 * (resolución). Convención GeoJSON: coordenadas `[lng, lat]` en WGS84.
 *
 * Se aceptan `Polygon` y `MultiPolygon`. Cada anillo debe venir cerrado
 * (primer punto == último), como manda RFC 7946; el primer anillo es el
 * contorno y los siguientes son agujeros.
 *
 * Punto-en-polígono por ray casting (par/impar): un punto está dentro de un
 * polígono si está dentro del contorno y fuera de todos sus agujeros. Para
 * un `MultiPolygon`, si está dentro de cualquiera de sus polígonos. Es O(n)
 * en vértices; con el tope de 2000 vértices por zona y decenas de zonas por
 * tenant, cuesta microsegundos.
 */

export type Position = [number, number];
export type LinearRing = Position[];

export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: LinearRing[];
}

export interface GeoJsonMultiPolygon {
  type: "MultiPolygon";
  coordinates: LinearRing[][];
}

export type ZoneGeometry = GeoJsonPolygon | GeoJsonMultiPolygon;

/** Tope de vértices por zona (sumando todos los anillos). */
export const MAX_POLYGON_VERTICES = 2000;

export type GeometryValidation =
  | { ok: true; geometry: ZoneGeometry; vertexCount: number }
  | { ok: false; error: string };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isPosition(v: unknown): v is Position {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    isFiniteNumber(v[0]) &&
    isFiniteNumber(v[1]) &&
    v[0] >= -180 &&
    v[0] <= 180 &&
    v[1] >= -90 &&
    v[1] <= 90
  );
}

function samePoint(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Valida un anillo: ≥4 posiciones (3 vértices + cierre), todas en rango y
 * cerrado. Devuelve el número de vértices ÚNICOS (sin contar el cierre) o un
 * mensaje de error.
 */
function validateRing(ring: unknown, label: string): { ok: true; vertices: number } | { ok: false; error: string } {
  if (!Array.isArray(ring) || ring.length < 4) {
    return { ok: false, error: `${label}: un anillo necesita al menos 3 vértices y el punto de cierre` };
  }
  for (let i = 0; i < ring.length; i++) {
    if (!isPosition(ring[i])) {
      return {
        ok: false,
        error: `${label}: la posición ${i} debe ser [lng, lat] con lng en [-180, 180] y lat en [-90, 90]`,
      };
    }
  }
  const first = ring[0] as Position;
  const last = ring[ring.length - 1] as Position;
  if (!samePoint(first, last)) {
    return { ok: false, error: `${label}: el anillo debe estar cerrado (primer punto == último)` };
  }
  return { ok: true, vertices: ring.length - 1 };
}

/**
 * Valida un valor arbitrario (el JSON que manda el panel o la API) como
 * `Polygon` / `MultiPolygon`. No muta la entrada; el `geometry` devuelto es
 * la misma referencia ya tipada.
 */
export function validateZoneGeometry(value: unknown): GeometryValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "polygon debe ser un objeto GeoJSON Polygon o MultiPolygon" };
  }
  const obj = value as { type?: unknown; coordinates?: unknown };
  if (obj.type !== "Polygon" && obj.type !== "MultiPolygon") {
    return { ok: false, error: 'polygon.type debe ser "Polygon" o "MultiPolygon"' };
  }
  if (!Array.isArray(obj.coordinates) || obj.coordinates.length === 0) {
    return { ok: false, error: "polygon.coordinates no puede estar vacío" };
  }
  const polygons: unknown[] = obj.type === "Polygon" ? [obj.coordinates] : obj.coordinates;
  let vertexCount = 0;
  for (let p = 0; p < polygons.length; p++) {
    const rings = polygons[p];
    if (!Array.isArray(rings) || rings.length === 0) {
      return { ok: false, error: `polígono ${p}: necesita al menos el anillo exterior` };
    }
    for (let r = 0; r < rings.length; r++) {
      const res = validateRing(rings[r], `polígono ${p}, anillo ${r}`);
      if (!res.ok) return res;
      vertexCount += res.vertices;
      if (vertexCount > MAX_POLYGON_VERTICES) {
        return { ok: false, error: `polygon excede ${MAX_POLYGON_VERTICES} vértices` };
      }
    }
  }
  return { ok: true, geometry: value as ZoneGeometry, vertexCount };
}

/** Cuenta vértices únicos (sin el cierre de cada anillo). 0 si no es válido. */
export function countVertices(value: unknown): number {
  const v = validateZoneGeometry(value);
  return v.ok ? v.vertexCount : 0;
}

/**
 * Ray casting clásico (Franklin PNPOLY) sobre un anillo. Trata el anillo
 * como cerrado aunque el último punto no repita el primero.
 */
export function pointInRing(lng: number, lat: number, ring: LinearRing): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = ring[i];
    const pj = ring[j];
    if (!pi || !pj) continue;
    const [xi, yi] = pi;
    const [xj, yj] = pj;
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInSinglePolygon(lng: number, lat: number, rings: LinearRing[]): boolean {
  const outer = rings[0];
  if (!outer || !pointInRing(lng, lat, outer)) return false;
  for (let r = 1; r < rings.length; r++) {
    const hole = rings[r];
    if (hole && pointInRing(lng, lat, hole)) return false; // dentro de un agujero
  }
  return true;
}

/**
 * ¿El punto `(lng, lat)` cae dentro de la geometría? Acepta la geometría sin
 * validar (la que viene de BD ya pasó por `validateZoneGeometry` al
 * guardarse); una geometría malformada devuelve `false`, nunca lanza.
 */
export function pointInGeometry(lng: number, lat: number, geometry: unknown): boolean {
  if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) return false;
  const g = geometry as { type?: unknown; coordinates?: unknown } | null;
  if (!g || typeof g !== "object") return false;
  try {
    if (g.type === "Polygon") {
      return pointInSinglePolygon(lng, lat, g.coordinates as LinearRing[]);
    }
    if (g.type === "MultiPolygon") {
      return (g.coordinates as LinearRing[][]).some((rings) => pointInSinglePolygon(lng, lat, rings));
    }
  } catch {
    return false;
  }
  return false;
}

/** Latitud válida (WGS84). */
export function isValidLat(v: unknown): v is number {
  return isFiniteNumber(v) && v >= -90 && v <= 90;
}

/** Longitud válida (WGS84). */
export function isValidLng(v: unknown): v is number {
  return isFiniteNumber(v) && v >= -180 && v <= 180;
}
