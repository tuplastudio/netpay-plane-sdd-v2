-- =============================================================
-- Backfill de Row-Level Security por tenant (continúa 0002_rls_tenant_isolation)
--
-- 0002 activó RLS sobre una lista fija de tablas. Desde entonces las
-- migraciones 0004-0008 (y el módulo de WhatsApp/notificaciones/integraciones)
-- agregaron tablas con columna `tenantId` que quedaron FUERA de esa lista, es
-- decir sin RLS ni política: hoy una query sin `where: { tenantId }` sobre
-- cualquiera de ellas devuelve filas de todas las empresas.
--
-- Verificado contra la base viva:
--   select c.relname, c.relrowsecurity from pg_class c ... where existe columna "tenantId"
-- → 12 tablas con tenantId y relrowsecurity = false.
--
-- Esta migración les aplica exactamente la misma forma de política que 0002:
--   USING ("tenantId" = current_tenant_id()) WITH CHECK (...)
-- más ENABLE + FORCE (FORCE es imprescindible: el rol de la app es dueño de
-- las tablas, y sin FORCE el dueño se salta la política).
--
-- QUEDAN A PROPÓSITO FUERA (no son request-scoped):
--   * "OutboxEvent" / "InboxEvent" — los consume apps/commerce-worker, un
--     proceso cross-tenant que nunca hace SET app.tenant_id. Activarles RLS
--     dejaría al worker viendo 0 filas y rompería la publicación de eventos.
--     Coincide con la nota de 0002 ("son internas").
--
-- ⚠ IMPORTANTE — leer antes de aplicar (ver informe de auditoría):
--   Hoy esta migración es un NO-OP de comportamiento, porque el rol con el que
--   conecta la app (netpay_app) es SUPERUSER + BYPASSRLS y ninguna política se
--   evalúa. Aplicarla es seguro y deja el esquema listo; para que RLS SIRVA de
--   verdad hacen falta además (a) un rol de runtime sin SUPERUSER/BYPASSRLS y
--   (b) que las rutas usen PrismaService.withTenant(), que hoy no tiene ni un
--   solo llamador. Ver el informe: activar (a) sin (b) deja la app en 0 filas.
-- =============================================================

-- ---- WhatsApp (migraciones 0007/0008 + módulo src/whatsapp) ----
ALTER TABLE "WhatsAppConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppConnection" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WhatsAppConnection";
CREATE POLICY tenant_isolation ON "WhatsAppConnection"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE "WhatsAppConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppConversation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WhatsAppConversation";
CREATE POLICY tenant_isolation ON "WhatsAppConversation"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE "WhatsAppMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppMessage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WhatsAppMessage";
CREATE POLICY tenant_isolation ON "WhatsAppMessage"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- ---- Notas internas de la bandeja (0007 y 0008) ----
ALTER TABLE "ConversationNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConversationNote" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ConversationNote";
CREATE POLICY tenant_isolation ON "ConversationNote"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE "MessageNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageNote" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MessageNote";
CREATE POLICY tenant_isolation ON "MessageNote"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- ---- Consumo del agente (0006). Alimenta el estado de cuenta. ----
ALTER TABLE "AgentUsageEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentUsageEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AgentUsageEvent";
CREATE POLICY tenant_isolation ON "AgentUsageEvent"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- ---- Notificaciones ----
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Notification";
CREATE POLICY tenant_isolation ON "Notification"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE "NotificationTimeline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationTimeline" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "NotificationTimeline";
CREATE POLICY tenant_isolation ON "NotificationTimeline"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- ---- Integraciones ----
ALTER TABLE "Integration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Integration" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Integration";
CREATE POLICY tenant_isolation ON "Integration"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE "IntegrationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "IntegrationEvent";
CREATE POLICY tenant_isolation ON "IntegrationEvent"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

COMMENT ON FUNCTION current_tenant_id() IS
  'Lee app.tenant_id del GUC de la conexión. PrismaService.withTenant lo configura. Tablas cubiertas: 0002 + 0009.';
