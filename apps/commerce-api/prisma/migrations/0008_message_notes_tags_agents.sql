-- Bandeja de conversaciones (fase 2): notas por mensaje, etiquetas de hilo y
-- agentes humanos que atienden WhatsApp.
--
--  1. `MessageNote`: nota interna sobre UN mensaje puntual (ConversationNote
--     ya cubre notas de todo el hilo; esta es más fina). Mismo shape/índice.
--  2. `WhatsAppConversation.tags`: arreglo nativo de Postgres, sin tabla de
--     unión — de sobra para "vip"/"reclamo"/"mayoreo" en un primer corte.
--  3. FK real para `WhatsAppConversation.handoffUserId` -> `User.id`: existía
--     como columna suelta sin constraint; ahora se puede hacer join.
--  4. `Membership.isAgent`: quién puede tomar hilos transferidos.

CREATE TABLE "MessageNote" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "authorId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessageNote_messageId_createdAt_idx" ON "MessageNote"("messageId", "createdAt");

ALTER TABLE "MessageNote" ADD CONSTRAINT "MessageNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageNote" ADD CONSTRAINT "MessageNote_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WhatsAppMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageNote" ADD CONSTRAINT "MessageNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WhatsAppConversation" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_handoffUserId_fkey" FOREIGN KEY ("handoffUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Membership" ADD COLUMN "isAgent" BOOLEAN NOT NULL DEFAULT false;
