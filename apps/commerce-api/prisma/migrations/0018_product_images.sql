-- Fotos de catálogo (producto y variante), varias por cada uno.
--
-- `variantId` NULL = imagen general del producto; no-NULL = imagen propia de
-- esa variante (p.ej. color/presentación). `position` ordena la galería;
-- 0 es la portada que se muestra en listados y en el chat. El archivo en sí
-- vive en el storage local de `uploads/` (mismo mecanismo que el logo del
-- tenant, ver `logo-storage.ts`); aquí solo se guarda la URL pública y la
-- `storageKey` para poder borrarlo del disco cuando se borra la fila.

CREATE TABLE IF NOT EXISTS "ProductImage" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"   UUID NOT NULL,
  "productId"  UUID NOT NULL,
  "variantId"  UUID,
  "url"        TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "position"   INTEGER NOT NULL DEFAULT 0,
  "width"      INTEGER,
  "height"     INTEGER,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductImage_storageKey_key" ON "ProductImage"("storageKey");

-- Galería del producto, en orden.
CREATE INDEX IF NOT EXISTS "ProductImage_tenantId_productId_position_idx"
  ON "ProductImage"("tenantId", "productId", "position");

-- Galería de una variante puntual, en orden.
CREATE INDEX IF NOT EXISTS "ProductImage_variantId_position_idx"
  ON "ProductImage"("variantId", "position");

ALTER TABLE "ProductImage"
  ADD CONSTRAINT "ProductImage_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductImage"
  ADD CONSTRAINT "ProductImage_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductImage"
  ADD CONSTRAINT "ProductImage_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- T-IAM-06 — RLS por tenant, mismo patrón que 0009/0015 para tablas nuevas.
ALTER TABLE "ProductImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductImage" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ProductImage";
CREATE POLICY tenant_isolation ON "ProductImage"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
