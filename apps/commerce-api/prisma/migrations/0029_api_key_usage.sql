-- Gestión de API keys y bitácora de uso (T-IAM-05b):
--   * `ApiKey.rotatedAt` / `ApiKey.rotatedToId`: rotación con periodo de
--     gracia. Al rotar se acuña una key nueva (misma empresa, nombre y scopes)
--     y la vieja queda marcada: su `expiresAt` se recorta a `now + gracia`
--     (o se revoca de inmediato con gracia 0). `resolve()` no cambia: la key
--     vieja deja de valer sola cuando vence.
--   * `ApiKeyUsage`: una fila por petición autenticada con una API key. La
--     escribe en lote `ApiKeyUsageService` (buffer en memoria, flush por
--     tiempo/tamaño y en shutdown) y se purga por retención
--     (`API_KEY_USAGE_RETENTION_DAYS`, 90 días por defecto).
--
-- Idempotente a propósito: en prod el deploy hace `prisma db push` contra
-- schema.prisma y este archivo solo se aplica a mano (psql) en local/staging.

ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "rotatedAt" TIMESTAMPTZ;
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "rotatedToId" UUID;

CREATE TABLE IF NOT EXISTS "ApiKeyUsage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID,
    "apiKeyId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "scopeUsed" TEXT,
    "errorCode" TEXT,

    CONSTRAINT "ApiKeyUsage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ApiKeyUsage_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApiKeyUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ApiKeyUsage_apiKeyId_occurredAt_idx" ON "ApiKeyUsage"("apiKeyId", "occurredAt");
CREATE INDEX IF NOT EXISTS "ApiKeyUsage_tenantId_occurredAt_idx" ON "ApiKeyUsage"("tenantId", "occurredAt");

-- RLS: misma plantilla que 0009/0015/0026, con una salvedad por el tenantId
-- NULL-able (igual que ApiKey y AuditLog desde 0019):
--   * USING estricto: una fila con tenantId NULL (uso de una key global sin
--     X-Tenant-Id) nunca hace match con current_tenant_id() y es invisible
--     para una sesión de tenant. Es lo correcto: es tráfico de plataforma y
--     solo se consulta desde /super-admin/*, que hoy corre con el rol de
--     conexión BYPASSRLS (ver docs/TENANT-ISOLATION.md).
--   * WITH CHECK admite NULL: el logger inserta esas filas de plataforma desde
--     el mismo proceso que atiende a los tenants; si algún día la conexión
--     corre bajo RLS con app.tenant_id fijado, la inserción no debe fallar.
ALTER TABLE "ApiKeyUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKeyUsage" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ApiKeyUsage";
CREATE POLICY tenant_isolation ON "ApiKeyUsage"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id() OR "tenantId" IS NULL);
