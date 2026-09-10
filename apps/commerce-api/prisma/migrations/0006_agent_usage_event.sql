-- Uso de tokens del agente por tenant, para el "estado de cuenta" de
-- super-admin (filtrable por tenant y rango de fechas).

CREATE TABLE "AgentUsageEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentUsageEvent_tenantId_createdAt_idx" ON "AgentUsageEvent"("tenantId", "createdAt");

ALTER TABLE "AgentUsageEvent" ADD CONSTRAINT "AgentUsageEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
