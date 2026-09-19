-- Link público y duradero de seguimiento de pedido.
--
-- Distinto de CheckoutAccessToken (un solo uso, vence en minutos: autoriza
-- pagar): este no vence ni se marca usado, para que el cliente pueda volver
-- a consultarlo cuando quiera después de pagar. Un solo token por pedido
-- (índice único en orderId), generado la primera vez que hace falta.
--
-- Sin columna tenantId a propósito, mismo patrón que CheckoutAccessToken: el
-- aislamiento por tenant lo da el JOIN a través de "Order", no RLS directo
-- sobre esta tabla (ver 0002_rls_tenant_isolation.sql).

CREATE TABLE IF NOT EXISTS "OrderTrackingToken" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderId"   UUID NOT NULL,
  "token"     TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "OrderTrackingToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrderTrackingToken_orderId_key" ON "OrderTrackingToken"("orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrderTrackingToken_token_key" ON "OrderTrackingToken"("token");

ALTER TABLE "OrderTrackingToken"
  ADD CONSTRAINT "OrderTrackingToken_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
