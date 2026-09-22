-- T-IAM-06 — Activa RLS en DeliveryZone (T-SHIP-01..03) tras crearla en 0014.
-- Patrón: misma plantilla que 0009 para tablas nuevas.

ALTER TABLE "DeliveryZone" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "DeliveryZone";
CREATE POLICY tenant_isolation ON "DeliveryZone"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
