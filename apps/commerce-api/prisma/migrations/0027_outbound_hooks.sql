-- Hooks salientes (webhooks REST / herramientas MCP por tenant):
--   * `OutboundHook`: destino, autenticación (credencial cifrada), secreto de
--     firma HMAC cifrado, eventos suscritos, headers extra, plantilla de
--     argumentos MCP y política de reintentos.
--   * `OutboundHookDelivery`: una fila por (evento, hook) con intentos,
--     respuesta y programación del siguiente intento.
--
-- Idempotente a propósito: en prod el deploy hace `prisma db push` contra
-- schema.prisma y este archivo solo se aplica a mano (psql) en local/staging.

DO $$ BEGIN
  CREATE TYPE "OutboundHookKind" AS ENUM ('REST', 'MCP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OutboundHookAuthType" AS ENUM ('NONE', 'BEARER', 'API_KEY_HEADER', 'BASIC', 'HMAC');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OutboundHookStatus" AS ENUM ('ACTIVE', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OutboundHookDeliveryStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'DEAD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "OutboundHook" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "OutboundHookKind" NOT NULL DEFAULT 'REST',
    "targetUrl" TEXT NOT NULL,
    "authType" "OutboundHookAuthType" NOT NULL DEFAULT 'NONE',
    "credential" TEXT,
    "authHeaderName" TEXT,
    "signingSecret" TEXT NOT NULL,
    "events" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" "OutboundHookStatus" NOT NULL DEFAULT 'ACTIVE',
    "headers" JSONB,
    "toolName" TEXT,
    "argsTemplate" JSONB,
    "retryPolicy" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "OutboundHook_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OutboundHook_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "OutboundHook_tenantId_status_idx" ON "OutboundHook"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "OutboundHook_tenantId_createdAt_idx" ON "OutboundHook"("tenantId", "createdAt");

CREATE TABLE IF NOT EXISTS "OutboundHookDelivery" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "hookId" UUID NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "status" "OutboundHookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "error" TEXT,
    "durationMs" INTEGER,
    "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMPTZ,

    CONSTRAINT "OutboundHookDelivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OutboundHookDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OutboundHookDelivery_hookId_fkey" FOREIGN KEY ("hookId") REFERENCES "OutboundHook"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- El despachador barre por estado + fecha del siguiente intento (todos los tenants).
CREATE INDEX IF NOT EXISTS "OutboundHookDelivery_status_nextAttemptAt_idx" ON "OutboundHookDelivery"("status", "nextAttemptAt");
-- Historial de un hook en el panel.
CREATE INDEX IF NOT EXISTS "OutboundHookDelivery_hookId_createdAt_idx" ON "OutboundHookDelivery"("hookId", "createdAt");
CREATE INDEX IF NOT EXISTS "OutboundHookDelivery_tenantId_createdAt_idx" ON "OutboundHookDelivery"("tenantId", "createdAt");

-- RLS: misma plantilla que el resto de tablas con tenantId.
ALTER TABLE "OutboundHook" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboundHook" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OutboundHook";
CREATE POLICY tenant_isolation ON "OutboundHook"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE "OutboundHookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboundHookDelivery" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OutboundHookDelivery";
CREATE POLICY tenant_isolation ON "OutboundHookDelivery"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
