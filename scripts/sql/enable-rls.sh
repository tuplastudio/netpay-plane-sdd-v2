#!/bin/bash
# Activa la defensa RLS en Neon.tech para que el rol owner no la bypass.
#
# ANTES DE CORRERLO:
#   - Confirmar que la app filtra por tenantId en todos los queries
#     (lo hace: ver docs/TENANT-ISOLATION.md y código en
#     apps/commerce-api/src/catalog/, customers/, orders/, etc.)
#   - Hacer backup de la DB
#   - Probar primero en staging
#
# CÓMO CORRERLO:
#   Opción 1 (recomendada): pegar el SQL en la consola SQL de Neon.tech
#   Opción 2: psql $DATABASE_URL -f scripts/sql/enable-rls.sql
#
# QUÉ HACE:
#   1. Quita BYPASSRLS del rol owner (neondb_owner)
#   2. Crea un rol app (neondb_app) sin bypass
#   3. Otorga al rol app los permisos sobre las tablas del schema public
#   4. Documenta el nuevo DATABASE_URL a usar

set -euo pipefail

DB_URL="${DATABASE_URL:?Set DATABASE_URL}"

# 1. NOBYPASSRLS en el owner (puede fallar si neondb_owner no tiene permiso
#    de alter role sobre sí mismo — en Neon.tech esto requiere superuser).
echo "=== 1. Quitar BYPASSRLS al owner ==="
psql "$DB_URL" -c "ALTER ROLE neondb_owner NOBYPASSRLS;" 2>&1 || echo "  [SKIP] requiere superuser"

# 2. Crear rol app (puede fallar si ya existe o no hay permiso).
echo ""
echo "=== 2. Crear rol neondb_app ==="
APP_PASSWORD="${NEON_APP_PASSWORD:?Set NEON_APP_PASSWORD}"
psql "$DB_URL" -c "CREATE ROLE neondb_app LOGIN PASSWORD '$APP_PASSWORD' NOBYPASSRLS;" 2>&1 || echo "  [SKIP] rol ya existe"

# 3. Otorgar permisos sobre el schema public.
echo ""
echo "=== 3. Otorgar permisos a neondb_app ==="
psql "$DB_URL" <<'SQL'
GRANT CONNECT ON DATABASE neondb TO neondb_app;
GRANT USAGE ON SCHEMA public TO neondb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO neondb_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO neondb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO neondb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO neondb_app;
SQL

# 4. Verificar.
echo ""
echo "=== 4. Verificar ==="
echo "Owner bypass:"
psql "$DB_URL" -At -c "SELECT rolbypassrls FROM pg_roles WHERE rolname='neondb_owner'"
echo ""
echo "App bypass:"
psql "$DB_URL" -At -c "SELECT rolbypassrls FROM pg_roles WHERE rolname='neondb_app'"

echo ""
echo "=== Listo. Cambiar DATABASE_URL de la app a: ==="
echo "  postgresql://neondb_app:$APP_PASSWORD@<host>/neondb?sslmode=require"
