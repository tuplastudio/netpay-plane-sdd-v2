-- 0027: índices de performance para los listados y agregados más usados.
-- Documentación del cambio en schema.prisma (la fuente de verdad; en prod el
-- deploy corre `prisma db push`). Nombres = convención de Prisma. Sin tablas
-- nuevas: no hay RLS que agregar. Ver docs/perf/2026-09-29-performance.md.

-- Catálogo: GET /catalog/products ordena por updatedAt DESC, id DESC por tenant.
CREATE INDEX IF NOT EXISTS "Product_tenantId_updatedAt_idx"
  ON "Product" ("tenantId", "updatedAt");

-- Clientes: listado (status ACTIVE + ORDER BY updatedAt) y KPI "nuevos hoy".
CREATE INDEX IF NOT EXISTS "Customer_tenantId_status_updatedAt_idx"
  ON "Customer" ("tenantId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "Customer_tenantId_createdAt_idx"
  ON "Customer" ("tenantId", "createdAt");

-- Cotizaciones: listado por updatedAt y ficha del cliente (por customerId).
CREATE INDEX IF NOT EXISTS "Quote_tenantId_updatedAt_idx"
  ON "Quote" ("tenantId", "updatedAt");
CREATE INDEX IF NOT EXISTS "Quote_tenantId_customerId_idx"
  ON "Quote" ("tenantId", "customerId");

-- Pedidos: listado por updatedAt y cifras por cliente (groupBy customerId
-- en el listado de clientes y en su ficha). Antes no había ningún índice
-- por customerId en Order: cada página de clientes barría los pedidos.
CREATE INDEX IF NOT EXISTS "Order_tenantId_updatedAt_idx"
  ON "Order" ("tenantId", "updatedAt");
CREATE INDEX IF NOT EXISTS "Order_tenantId_customerId_idx"
  ON "Order" ("tenantId", "customerId");

-- Cobros: GET /payments/sessions ordena por createdAt DESC por tenant.
CREATE INDEX IF NOT EXISTS "CheckoutSession_tenantId_createdAt_idx"
  ON "CheckoutSession" ("tenantId", "createdAt");

-- Conversaciones: hilos de un cliente (ficha del cliente, resolve-channel).
CREATE INDEX IF NOT EXISTS "WhatsAppConversation_tenantId_customerId_idx"
  ON "WhatsAppConversation" ("tenantId", "customerId");
