-- enable-rls.sql: activa la defensa RLS en Neon.tech.
--
-- INSTRUCCIONES:
--   1. Hacer backup de la DB.
--   2. En la consola SQL de Neon.tech (https://console.neon.tech), pegar este script.
--   3. Cambiar el DATABASE_URL de la app de 'neondb_owner' a 'neondb_app' con la
--      password que elijas en este script.
--
-- QUÉ HACE:
--   - Quita BYPASSRLS al rol owner (requiere superuser; si falla, contacta soporte)
--   - Crea rol neondb_app sin BYPASSRLS
--   - Otorga permisos sobre todas las tablas del schema public
--   - Configura default privileges para tablas futuras
--
-- POST-FIX: ver docs/TENANT-ISOLATION.md sección "Verificación rápida post-fix"

-- ⚠️ Cambiar esta password por algo seguro antes de correr:
\set app_password 'NEON_APP_PASSWORD_PLACEHOLDER'

-- 1. Quitar BYPASSRLS al owner (puede fallar si neondb_owner no es superuser)
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER ROLE neondb_owner NOBYPASSRLS';
    RAISE NOTICE 'OK: neondb_owner NOBYPASSRLS';
  EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
    RAISE NOTICE 'SKIP: NOBYPASSRLS requiere superuser. Continuar sin esto.';
  END;
END $$;

-- 2. Crear rol app (puede fallar si ya existe)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neondb_app') THEN
    EXECUTE format('CREATE ROLE neondb_app LOGIN PASSWORD %L NOBYPASSRLS', :'app_password');
    RAISE NOTICE 'OK: rol neondb_app creado';
  ELSE
    RAISE NOTICE 'SKIP: rol neondb_app ya existe';
  END IF;
END $$;

-- 3. Permisos
GRANT CONNECT ON DATABASE neondb TO neondb_app;
GRANT USAGE ON SCHEMA public TO neondb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO neondb_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO neondb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO neondb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO neondb_app;

-- 4. Verificar
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('neondb_owner', 'neondb_app');
