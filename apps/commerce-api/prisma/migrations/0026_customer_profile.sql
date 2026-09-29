-- Perfil 360° del cliente (T-CRM-06):
--   * `Customer.tags`: etiquetas libres ("vip", "mayoreo"), normalizadas en
--     minúsculas, mismo patrón que `WhatsAppConversation.tags`.
--   * `Customer.fiscalConstanciaUrl`: última constancia de situación fiscal
--     subida desde la ficha (los pedidos guardan la suya propia).
--   * `CustomerNote`: notas internas con autor y fecha (el campo `notes` de
--     Customer sigue siendo el texto libre "fijo" de la ficha).
--
-- Idempotente a propósito: en prod el deploy hace `prisma db push` contra
-- schema.prisma y este archivo solo se aplica a mano (psql) en local/staging.

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "fiscalConstanciaUrl" TEXT;

CREATE INDEX IF NOT EXISTS "Customer_tags_idx" ON "Customer" USING GIN ("tags");

CREATE TABLE IF NOT EXISTS "CustomerNote" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "authorId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomerNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CustomerNote_customerId_createdAt_idx" ON "CustomerNote"("customerId", "createdAt");

-- RLS: misma plantilla que 0009/0015 para tablas nuevas con tenantId.
ALTER TABLE "CustomerNote" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "CustomerNote";
CREATE POLICY tenant_isolation ON "CustomerNote"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
