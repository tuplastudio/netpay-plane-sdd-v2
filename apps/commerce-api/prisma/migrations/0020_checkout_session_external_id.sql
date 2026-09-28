-- Id de la sesión en la pasarela + ruta hosted en CheckoutSession.
--
-- Antes el webhook buscaba la sesión por `orderId` + "la PENDING más nueva",
-- y cada "Pagar ahora" abría otra sesión en la pasarela: si el cliente pagaba
-- en dos pestañas, las dos capturas caían sobre sesiones distintas y el
-- pedido se cobraba dos veces. Ahora el webhook busca por `externalId` (el
-- `sessionId` del gateway) y el checkout público reusa la sesión PENDING
-- vigente (`hostedPath`) en vez de crear otra.
--
-- NULL en sesiones anteriores a esta migración: para ellas el webhook sigue
-- usando el fallback orderId + PENDING.
--
-- Documentación de la evolución del esquema: en prod, `deploy-backend.yml`
-- aplica esto vía `prisma db push` contra schema.prisma (no `prisma migrate
-- deploy`, ver comentario en el workflow); este archivo no se ejecuta solo.

ALTER TABLE "CheckoutSession" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "CheckoutSession" ADD COLUMN IF NOT EXISTS "hostedPath" TEXT;

-- Único global (los NULL no chocan entre sí en Postgres).
CREATE UNIQUE INDEX IF NOT EXISTS "CheckoutSession_externalId_key"
  ON "CheckoutSession"("externalId");

CREATE INDEX IF NOT EXISTS "CheckoutSession_orderId_status_idx"
  ON "CheckoutSession"("orderId", "status");
