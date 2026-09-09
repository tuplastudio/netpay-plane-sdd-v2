-- =============================================================
-- T-IAM-06 — Row-Level Security (RLS) por tenant
-- Ver docs/03-iam.md. Aislamiento persistente incluso si una query
-- omite el `where: { tenantId }`. Activada por tabla.
--
-- Patrón:
--   1. SET LOCAL app.tenant_id = '<uuid>'  por conexión/transacción.
--   2. Política `tenant_isolation` compara `current_tenant_id()` con
--      la columna `tenant_id` (NULL si no existe la columna, p.ej.
--      `User`/`OutboxEvent` no son tenant-scoped → política BYPASS).
-- =============================================================

-- Función utilitaria: lee el GUC `app.tenant_id`.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$ LANGUAGE SQL STABLE;

-- =============================================================
-- Habilitar RLS y crear política por tabla tenant-scoped
-- =============================================================

DO $$
DECLARE
  t text;
  has_tenant boolean;
  tables text[] := ARRAY[
    'Membership',
    'Session',
    'Invitation',
    'ApiKey',
    'AuditLog',
    'Product',
    'ProductVariant',
    'Customer',
    'CustomerAddress',
    'CustomerIdentity',
    'CustomerConsent',
    'Quote',
    'QuoteLine',
    'QuoteShareToken',
    'Order',
    'OrderRevision',
    'CheckoutAccessToken',
    'CheckoutSession',
    'LedgerEntry',
    'StorageObject',
    'Job'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Verificar que la tabla tiene columna tenantId
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'tenantId'
    ) INTO has_tenant;

    IF has_tenant THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_tenant_id()) WITH CHECK ("tenantId" = current_tenant_id())',
        t
      );
    END IF;
  END LOOP;
END$$;

-- Tablas no-tenant (User, OutboxEvent, InboxEvent, ApiKey-prefix)
-- permanecen sin RLS — se filtran por aplicación o son internas.

-- =============================================================
-- Garantizar que el rol app puede SET el GUC
-- =============================================================
GRANT USAGE ON SCHEMA public TO netpay_app;

COMMENT ON FUNCTION current_tenant_id() IS
  'Lee app.tenant_id del GUC de la conexión. PrismaService.withTenant lo configura.';