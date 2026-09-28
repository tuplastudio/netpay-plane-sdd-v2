-- Régimen fiscal (clave c_RegimenFiscal, ej. "626") en Order y Customer.
--
-- La constancia de situación fiscal del SAT SÍ trae el régimen fiscal (era
-- el único de los 4 datos fiscales que la UI de checkout pedía pero nunca
-- se guardaba en ningún lado). Con esto, subir la constancia basta para los
-- 4 campos (RFC, razón social, código postal, régimen); "uso de CFDI" lo
-- sigue eligiendo quien factura, porque no está en el documento.
--
-- Documentación de la evolución del esquema: en prod, `deploy-backend.yml`
-- aplica esto vía `prisma db push` contra schema.prisma; este archivo no se
-- ejecuta solo.

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceRegimenFiscal" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "fiscalRegimenFiscal" TEXT;
