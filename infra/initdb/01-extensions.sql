-- T-FND-03 + T-IAM-06
-- Crea el rol de aplicación SIN superuser y SIN BYPASSRLS para
-- activar Row-Level Security. Las migraciones las corre el rol
-- bootstrap (que sí es superuser hasta el final del init).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'netpay_app') THEN
    CREATE ROLE netpay_app LOGIN PASSWORD 'netpay_app' NOSUPERUSER NOBYPASSRLS;
  END IF;
END$$;

GRANT ALL PRIVILEGES ON DATABASE netpay TO netpay_app;
GRANT ALL ON SCHEMA public TO netpay_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO netpay_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO netpay_app;