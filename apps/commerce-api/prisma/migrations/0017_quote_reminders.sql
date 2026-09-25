-- Recordatorios de cotización sin pagar (T-NTF-07).
--
-- `Tenant`: el dueño configura desde el panel si quiere recordatorios, cada
-- cuántas horas y cuántos como máximo. Los valores por defecto reproducen el
-- comportamiento que se acordó con el negocio: dos recordatorios, uno por día.
ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "quoteReminderEnabled"    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "quoteReminderEveryHours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS "quoteReminderMaxCount"   INTEGER NOT NULL DEFAULT 2;

-- Plantillas aprobadas por Meta, por clave interna de plantilla. Fuera de la
-- ventana de servicio de 24 h es lo único que se puede mandar.
ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "whatsappTemplates" JSONB;

-- `Quote`: cuántos recordatorios se mandaron ya y cuándo fue el último. El
-- barrido usa las dos columnas para no repetir ni pasarse del tope.
ALTER TABLE "Quote"
  ADD COLUMN IF NOT EXISTS "remindersSent"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastReminderAt" TIMESTAMPTZ;

-- El barrido busca por estado y vigencia a través de TODOS los tenants: los
-- índices que ya existían empiezan por "tenantId" y no le sirven. Va con el
-- nombre que genera Prisma para `@@index([status, expiresAt])`, porque el
-- despliegue sincroniza el esquema con `prisma db push` y un índice con otro
-- nombre se borraría en el siguiente deploy.
CREATE INDEX IF NOT EXISTS "Quote_status_expiresAt_idx"
  ON "Quote" ("status", "expiresAt");
