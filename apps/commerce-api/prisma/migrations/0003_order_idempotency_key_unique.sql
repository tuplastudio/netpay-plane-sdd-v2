-- =============================================================
-- T-ORD — Idempotencia del cobro rápido
--
-- `Order.idempotencyKey` ya está declarado `@unique` en prisma/schema.prisma,
-- así que en cualquier entorno levantado con `prisma db push` / `migrate dev`
-- el índice ya existe y este archivo es un no-op. Se escribe explícito porque
-- la garantía de "una clave = un cobro" que aplica OrderService.quickCharge NO
-- la da la lectura previa (dos peticiones simultáneas la pasan las dos en
-- vacío): la da este índice, que serializa el insert y hace que el perdedor
-- reciba P2002 y relea el pedido del ganador. Sin el índice, la idempotencia
-- es solo aparente.
--
-- Aplicar con:
--   psql "$DATABASE_URL" -f prisma/migrations/0003_order_idempotency_key_unique.sql
-- o, si el entorno usa el flujo de Prisma:
--   pnpm --filter @netpay/commerce-api prisma db push
-- =============================================================

-- Nombre exacto que genera Prisma para `idempotencyKey String? @unique`.
-- NULL no colisiona con NULL en Postgres: los pedidos sin clave (catálogo,
-- cotización) no se ven afectados.
CREATE UNIQUE INDEX IF NOT EXISTS "Order_idempotencyKey_key"
  ON "Order" ("idempotencyKey");
