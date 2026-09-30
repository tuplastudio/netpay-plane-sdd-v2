-- Fuentes de datos para sincronizar el catálogo (API REST / servidor MCP).
--
--   * `DataSource`: conexión + mapeo de campos + programación. La credencial
--     va cifrada (`credentialEnc`, secret-cipher con TOKEN_ENCRYPTION_KEY_REF).
--   * `DataSourceRun`: historial de cada sincronización con stats y muestra
--     de errores.
--   * Las variantes que crea una fuente llevan `ProductVariant.originSystem`
--     = `DataSource.id` y `originExternalId` = id externo (o SKU).
--
-- Idempotente a propósito: en prod el deploy hace `prisma db push` contra
-- schema.prisma y este archivo solo se aplica a mano (psql) en local/staging.

DO $$ BEGIN
  CREATE TYPE "DataSourceKind" AS ENUM ('REST', 'MCP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DataSourceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DataSourceAuthType" AS ENUM ('NONE', 'BEARER', 'API_KEY_HEADER', 'BASIC');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DataSourceRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DataSourceTrigger" AS ENUM ('MANUAL', 'SCHEDULE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "DataSource" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DataSourceKind" NOT NULL,
    "status" "DataSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "url" TEXT NOT NULL,
    "authType" "DataSourceAuthType" NOT NULL DEFAULT 'NONE',
    "credentialEnc" TEXT,
    "authHeaderName" TEXT,
    "headers" JSONB,
    "config" JSONB NOT NULL,
    "scheduleEveryMinutes" INTEGER,
    "scheduleCron" TEXT,
    "deactivateMissing" BOOLEAN NOT NULL DEFAULT false,
    "nextRunAt" TIMESTAMPTZ,
    "lastRunAt" TIMESTAMPTZ,
    "lastStatus" "DataSourceRunStatus",
    "lastError" TEXT,
    "lockedAt" TIMESTAMPTZ,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DataSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "DataSource_tenantId_name_key" ON "DataSource"("tenantId", "name");
CREATE INDEX IF NOT EXISTS "DataSource_tenantId_status_idx" ON "DataSource"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "DataSource_status_nextRunAt_idx" ON "DataSource"("status", "nextRunAt");

CREATE TABLE IF NOT EXISTS "DataSourceRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "dataSourceId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ,
    "status" "DataSourceRunStatus" NOT NULL DEFAULT 'RUNNING',
    "stats" JSONB,
    "errorSample" JSONB,
    "triggeredBy" "DataSourceTrigger" NOT NULL,
    "triggeredById" UUID,

    CONSTRAINT "DataSourceRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DataSourceRun_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DataSourceRun_tenantId_dataSourceId_startedAt_idx" ON "DataSourceRun"("tenantId", "dataSourceId", "startedAt");
CREATE INDEX IF NOT EXISTS "DataSourceRun_dataSourceId_status_idx" ON "DataSourceRun"("dataSourceId", "status");

-- RLS: misma plantilla que 0009/0015/0026 para tablas nuevas con tenantId.
ALTER TABLE "DataSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataSource" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DataSource";
CREATE POLICY tenant_isolation ON "DataSource"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE "DataSourceRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataSourceRun" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DataSourceRun";
CREATE POLICY tenant_isolation ON "DataSourceRun"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
