-- =============================================================
-- T-PAY-04 — Reembolsos parciales: CheckoutSession."refundedTotal"
--
-- Antes de esta migración `refund()` marcaba la sesión COMPLETA como
-- 'REFUNDED' aunque el importe reembolsado fuera parcial, y el importe vivía
-- solo en LedgerEntry. Consecuencias: el bruto cobrado desaparecía de
-- cualquier filtro por 'CAPTURED' y una sesión reembolsada a medias no
-- admitía un segundo reembolso.
--
-- Esta migración añade el acumulado reembolsado a la propia sesión y
-- reconstruye el estado histórico. Es idempotente: se puede correr dos veces.
--
-- SUPUESTO DEL BACKFILL (importante):
--   El importe reembolsado NO se infiere del estado, se reconstruye sumando
--   los LedgerEntry de tipo 'REFUND' de cada sesión, que es el registro
--   exacto de lo que se devolvió. El estado 'REFUNDED' antiguo es ambiguo
--   (un parcial y un total se ven idénticos), el ledger no lo es.
--   Por tanto:
--     - refundedTotal := SUM(LedgerEntry.amount WHERE entryType='REFUND'),
--       acotado a `amount` para no violar la invariante
--       0 <= refundedTotal <= amount si hubiera datos sucios.
--     - Una sesión 'REFUNDED' cuyo ledger suma MENOS que `amount` era en
--       realidad un reembolso parcial: se reetiqueta a 'PARTIALLY_REFUNDED'.
--     - Una sesión 'REFUNDED' SIN ningún LedgerEntry de tipo 'REFUND' se
--       deja como 'REFUNDED' con refundedTotal = amount: sin ledger no hay
--       forma de saber que fue parcial, y suponer "total" es lo que ya
--       reflejaba el sistema (el pedido asociado también quedó 'REFUNDED').
--       Este es el ÚNICO caso en el que el backfill adivina.
-- =============================================================

ALTER TABLE "CheckoutSession"
  ADD COLUMN IF NOT EXISTS "refundedTotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00;

-- 1) Reconstruir el acumulado desde el ledger (fuente exacta).
UPDATE "CheckoutSession" cs
   SET "refundedTotal" = LEAST(agg.total, cs."amount")
  FROM (
    SELECT "sessionId", SUM("amount") AS total
      FROM "LedgerEntry"
     WHERE "entryType" = 'REFUND'
     GROUP BY "sessionId"
  ) agg
 WHERE agg."sessionId" = cs."id"
   AND cs."refundedTotal" = 0.00;

-- 2) Sesiones marcadas 'REFUNDED' sin rastro en el ledger: se asume total.
UPDATE "CheckoutSession"
   SET "refundedTotal" = "amount"
 WHERE "status" = 'REFUNDED'
   AND "refundedTotal" = 0.00;

-- 3) Reetiquetar los parciales que el código viejo escribió como totales.
UPDATE "CheckoutSession"
   SET "status" = 'PARTIALLY_REFUNDED'
 WHERE "status" = 'REFUNDED'
   AND "refundedTotal" > 0.00
   AND "refundedTotal" < "amount";

-- 4) Invariante en la base, no solo en la aplicación. El UPDATE condicional
--    de refund() ya impide pasarse, pero la restricción deja el error en el
--    sitio correcto si alguna vez se escribe por otra vía.
--    (Prisma no modela CHECK; `prisma db push` no la crea ni la necesita, y
--    si alguna vez la eliminara la garantía de aplicación sigue en pie.)
ALTER TABLE "CheckoutSession"
  DROP CONSTRAINT IF EXISTS "CheckoutSession_refundedTotal_range";
ALTER TABLE "CheckoutSession"
  ADD CONSTRAINT "CheckoutSession_refundedTotal_range"
  CHECK ("refundedTotal" >= 0 AND "refundedTotal" <= "amount");

-- El índice que usan los agregados de /reports/summary ya existe:
-- @@index([tenantId, status]) del modelo CheckoutSession.
