-- NetPay Plane - bootstrap dummy gateway
-- Crea rol dummy y extensiones.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'netpay_dummy') THEN
    CREATE ROLE netpay_dummy LOGIN PASSWORD 'netpay_dummy';
  END IF;
END$$;

GRANT ALL PRIVILEGES ON DATABASE netpay_dummy TO netpay_dummy;
GRANT ALL ON SCHEMA public TO netpay_dummy;