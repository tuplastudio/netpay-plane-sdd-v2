-- WhatsAppMessage.externalId: único POR TENANT, no global.
--
-- Si dos negocios de la plataforma se escriben entre sí, el id del mensaje
-- de WhatsApp es el mismo en ambos lados (saliente en uno, entrante en el
-- otro). Con el único global, la ingesta del segundo chocaba con la fila del
-- primero: antes devolvía el mensaje del OTRO tenant (fuga), y con el parche
-- intermedio se perdía el mensaje entrante.
--
-- Orden seguro: primero el índice compuesto (la deduplicación del mismo
-- tenant nunca queda sin índice), después se retira el global. Idempotente.
-- En prod se aplica ANTES del deploy del código (ver one-off); `prisma db
-- push` del deploy luego no encuentra diferencias.

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppMessage_tenantId_externalId_key"
  ON "WhatsAppMessage"("tenantId", "externalId");

DROP INDEX IF EXISTS "WhatsAppMessage_externalId_key";
