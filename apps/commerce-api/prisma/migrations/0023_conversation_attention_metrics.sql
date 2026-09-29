-- Atención multi-agente: quién contestó cada mensaje y cuándo entró/salió cada
-- hilo de la cola humana. Sin esto el reporte de atención no puede atribuir
-- trabajo a una persona ni medir tiempos de respuesta.
--
--  1. `WhatsAppMessage.sentByUserId`: persona del portal que mandó el saliente
--     (NULL = bot, plantilla automática o mensaje anterior a esta migración).
--  2. `WhatsAppConversation.handoffAt`: cuándo el hilo entró a la cola humana.
--  3. `WhatsAppConversation.assignedAt`: cuándo una persona lo tomó/recibió.
--  4. `WhatsAppConversation.firstHumanReplyAt`: primera respuesta humana desde
--     el último handoff (tiempo de espera = firstHumanReplyAt - handoffAt).
--  5. `WhatsAppConversation.closedAt`: cierre (resolución = closedAt - createdAt).

ALTER TABLE "WhatsAppMessage" ADD COLUMN "sentByUserId" UUID;
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "WhatsAppMessage_tenantId_sentByUserId_createdAt_idx" ON "WhatsAppMessage"("tenantId", "sentByUserId", "createdAt");

ALTER TABLE "WhatsAppConversation" ADD COLUMN "handoffAt" TIMESTAMPTZ;
ALTER TABLE "WhatsAppConversation" ADD COLUMN "assignedAt" TIMESTAMPTZ;
ALTER TABLE "WhatsAppConversation" ADD COLUMN "firstHumanReplyAt" TIMESTAMPTZ;
ALTER TABLE "WhatsAppConversation" ADD COLUMN "closedAt" TIMESTAMPTZ;

-- Backfill: los hilos que ya están con una persona cuentan desde su última
-- actividad; los cerrados, desde su última actualización.
UPDATE "WhatsAppConversation" SET "handoffAt" = "updatedAt" WHERE "handoffToHuman" = true;
UPDATE "WhatsAppConversation" SET "assignedAt" = "updatedAt" WHERE "handoffUserId" IS NOT NULL;
UPDATE "WhatsAppConversation" SET "closedAt" = "updatedAt" WHERE "status" = 'CLOSED';
