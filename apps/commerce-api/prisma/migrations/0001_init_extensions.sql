-- Migración SQL inicial: habilita uuid_generate_v7 si existe
-- (Postgres 17 lo trae nativo, en 16 usamos uuid_generate_v7 de uuid_ossp o
-- implementación custom). Para V2 usamos uuid_generate_v4 por portabilidad
-- y aceptamos el orden lexicográfico como suficiente (no usamos para FK ordering).
--
-- Esta migración aplica además Row-Level Security para multi-tenancy (T-IAM-06).

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Función para extraer tenant_id del JWT (placeholder).
-- En V2 el tenant_id viaja en el RequestContext y se aplica SET LOCAL.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$ LANGUAGE SQL STABLE;

-- RLS en tablas multi-tenant. Aplicada por tabla en migraciones siguientes.
-- Aquí dejamos la función disponible.