-- T-SHIP-07 — Zonas de envío con polígono dibujado en el mapa.
--
-- `polygon`: GeoJSON Polygon / MultiPolygon (coordenadas [lng, lat]) que el
-- admin dibuja en el panel. El test punto-en-polígono se hace en TypeScript
-- (`src/shipping/geo.ts`): sin PostGIS, sin índice espacial — las zonas de un
-- tenant son decenas, no miles. `color`: color de la zona en el mapa (`#rrggbb`).
--
-- Idempotente (ADD COLUMN IF NOT EXISTS): se puede aplicar a mano en un
-- contenedor que ya la tenga sin romper. La RLS de 0015 sigue aplicando: son
-- columnas nuevas de la misma tabla.

ALTER TABLE "DeliveryZone" ADD COLUMN IF NOT EXISTS "polygon" JSONB;
ALTER TABLE "DeliveryZone" ADD COLUMN IF NOT EXISTS "color" TEXT;
