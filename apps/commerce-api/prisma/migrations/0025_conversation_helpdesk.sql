-- Help desk sobre la bandeja de WhatsApp (estilo Zendesk).
--
--  1. `WhatsAppConversation.priority`: LOW / NORMAL / HIGH / URGENT. Enum de
--     Postgres en ese orden a propósito: `ORDER BY priority DESC` ordena por
--     posición del enum (no alfabético), así "urgente primero" se resuelve
--     en la base sin columna numérica aparte.
--  2. `WhatsAppConversation.pendingAt`: el hilo espera algo del cliente
--     ("marcar como pendiente"). NULL = no está pendiente. Se limpia solo
--     cuando el cliente vuelve a escribir (ingestInbound) o al cerrar.
--     El estado de ticket se DERIVA: CLOSED → resuelta; pendingAt → pendiente;
--     resto → abierta. No se duplica `status`.
--  3. Índices para los filtros nuevos de la bandeja (prioridad, pendientes,
--     dueño) — el de dueño faltaba y `assignee=` ya barría por tenant.
--  4. `CannedResponse`: respuestas rápidas por tenant (atajo "/gracias" →
--     texto). RLS igual que el resto de tablas por tenant (0009/0015/0018).

CREATE TYPE "ConversationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

ALTER TABLE "WhatsAppConversation"
  ADD COLUMN "priority" "ConversationPriority" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "WhatsAppConversation"
  ADD COLUMN "pendingAt" TIMESTAMPTZ;

CREATE INDEX "WhatsAppConversation_tenantId_priority_idx"
  ON "WhatsAppConversation"("tenantId", "priority");
CREATE INDEX "WhatsAppConversation_tenantId_pendingAt_idx"
  ON "WhatsAppConversation"("tenantId", "pendingAt");
CREATE INDEX "WhatsAppConversation_tenantId_handoffUserId_idx"
  ON "WhatsAppConversation"("tenantId", "handoffUserId");

CREATE TABLE "CannedResponse" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"        UUID NOT NULL,
  -- Atajo sin "/" ni espacios, en minúsculas (p.ej. "gracias", "horario").
  "shortcut"        TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "body"            TEXT NOT NULL,
  "createdByUserId" UUID,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMPTZ NOT NULL,
  CONSTRAINT "CannedResponse_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CannedResponse"
  ADD CONSTRAINT "CannedResponse_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CannedResponse"
  ADD CONSTRAINT "CannedResponse_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "CannedResponse_tenantId_shortcut_key" ON "CannedResponse"("tenantId", "shortcut");
CREATE INDEX "CannedResponse_tenantId_title_idx" ON "CannedResponse"("tenantId", "title");

-- T-IAM-06 — RLS por tenant, mismo patrón que 0009/0015/0018.
ALTER TABLE "CannedResponse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CannedResponse" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "CannedResponse";
CREATE POLICY tenant_isolation ON "CannedResponse"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
