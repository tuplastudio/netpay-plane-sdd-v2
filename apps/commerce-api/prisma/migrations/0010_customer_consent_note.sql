-- Comentario (justificación) sobre cada consentimiento del cliente.
--
-- WHATSAPP se otorga automáticamente cuando el cliente escribe al canal
-- (consentimiento implícito: si nos escribe, acepta que le respondamos por
-- ese mismo canal), y queda nota "Auto-otorgado: el cliente envió un
-- mensaje por WhatsApp el …".
-- MARKETING y DATA_PROCESSING los otorga una persona; el operador deja
-- una nota que justifica cómo y cuándo lo obtuvo (formulario firmado,
-- verbal en llamada, etc.).
--
-- El comentario se muestra en la ficha del cliente y en el detalle del
-- consentimiento, así siempre queda claro por qué se le puede (o no) usar
-- cada canal.

ALTER TABLE "CustomerConsent" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "CustomerConsent" ADD COLUMN IF NOT EXISTS "source" TEXT;
