-- Facturación (CFDI) pedida desde el bot: snapshot fiscal en Order +
-- últimos datos fiscales conocidos en Customer (para no volver a pedirlos).

CREATE TYPE "InvoiceRequestStatus" AS ENUM ('NONE', 'REQUESTED', 'DATA_COMPLETE');

ALTER TABLE "Customer" ADD COLUMN     "fiscalCfdiUse" TEXT,
ADD COLUMN     "fiscalPostalCode" TEXT,
ADD COLUMN     "legalName" TEXT;

ALTER TABLE "Order" ADD COLUMN     "invoiceCfdiUse" TEXT,
ADD COLUMN     "invoiceConstanciaUrl" TEXT,
ADD COLUMN     "invoiceLegalName" TEXT,
ADD COLUMN     "invoiceNotes" TEXT,
ADD COLUMN     "invoicePostalCode" TEXT,
ADD COLUMN     "invoiceRequestedAt" TIMESTAMPTZ,
ADD COLUMN     "invoiceRfc" TEXT,
ADD COLUMN     "invoiceStatus" "InvoiceRequestStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "requiresInvoice" BOOLEAN NOT NULL DEFAULT false;
