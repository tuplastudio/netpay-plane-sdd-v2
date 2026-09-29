/**
 * Reglas puras sobre zonas de envío compartidas entre el controlador (alta /
 * edición, detección de catch-all) y `PricingService` (resolución).
 */

/** Criterio que decidió la zona en `resolveShippingZone`. */
export type ShippingZoneMatch = "polygon" | "postalCode" | "city" | "catchAll" | "fallback";

export interface ShippingAddressInput {
  postalCode?: string;
  city?: string;
  state?: string;
  /** Latitud WGS84 del cliente (ubicación de WhatsApp, pin del panel). */
  lat?: number;
  /** Longitud WGS84 del cliente. */
  lng?: number;
}

export interface ShippingZoneResolution {
  price: string;
  zoneId: string | null;
  zoneName: string | null;
  /** `true` cuando se cobró `tenant.shippingFlat` por no haber zona. */
  fallback: boolean;
  matchedBy: ShippingZoneMatch;
}

/**
 * Forma mínima de una zona para decidir si es catch-all. Acepta tanto la fila
 * de Prisma como el body de un DTO (donde los campos pueden venir `undefined`).
 */
export interface ZoneCriteria {
  postalCodes?: string[] | null;
  cityPattern?: string | null;
  state?: string | null;
  polygon?: unknown;
}

/**
 * Una zona es catch-all cuando NO tiene ningún criterio de área: ni CPs, ni
 * ciudad, ni estado, ni polígono. Solo puede existir una por tenant y se
 * evalúa después de todas las demás.
 */
export function isCatchAllZone(zone: ZoneCriteria): boolean {
  const hasCps = Array.isArray(zone.postalCodes) && zone.postalCodes.length > 0;
  const hasCity = (zone.cityPattern ?? "").trim() !== "";
  const hasState = (zone.state ?? "").trim() !== "";
  const hasPolygon = zone.polygon !== undefined && zone.polygon !== null;
  return !hasCps && !hasCity && !hasState && !hasPolygon;
}
