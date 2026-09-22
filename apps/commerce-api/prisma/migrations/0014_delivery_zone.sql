-- Zonas de envío a domicilio (T-SHIP-01..03).
--
-- El admin las crea/define desde el panel del tenant; el agente y el front
-- las consultan para cobrar el envío correcto según CP/ciudad. Si no hay
-- zona activa que coincida con la dirección del cliente, se cae al
-- `shippingFlat` del tenant (compatibilidad con tenants que todavía no
-- configuraron zonas).

CREATE TABLE IF NOT EXISTS "DeliveryZone" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"    UUID NOT NULL,
  "name"        TEXT NOT NULL,
  "postalCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "cityPattern" TEXT,
  "state"       TEXT,
  "price"       DECIMAL(12, 2) NOT NULL,
  "minOrder"    DECIMAL(12, 2),
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "notes"       TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

-- Un nombre único por tenant: el admin no crea duplicados por descuido.
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryZone_tenantId_name_key"
  ON "DeliveryZone"("tenantId", "name");

-- Búsqueda por tenant + estado activo (lookup principal del agente).
CREATE INDEX IF NOT EXISTS "DeliveryZone_tenantId_active_idx"
  ON "DeliveryZone"("tenantId", "active");

-- Índice GIN sobre `postalCodes` para resolver por CP en O(log n) por tenant.
-- (No se puede declarar desde Prisma porque GIN sobre UUID necesita
-- `uuid_ops`, y la DSL de Prisma no lo soporta.)
CREATE INDEX IF NOT EXISTS "DeliveryZone_postalCodes_gin_idx"
  ON "DeliveryZone" USING GIN ("postalCodes");

ALTER TABLE "DeliveryZone"
  ADD CONSTRAINT "DeliveryZone_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
