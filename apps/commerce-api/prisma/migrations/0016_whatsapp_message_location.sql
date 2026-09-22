-- Mensajes de WhatsApp con coordenadas: cuando el cliente comparte su
-- ubicación desde el menú "Ubicación", guardamos lat/lng en la misma fila
-- para que el agente los tenga a mano (la dirección textual sigue en
-- `body`; WhatsApp la adjunta al mensaje).
ALTER TABLE "WhatsAppMessage"
  ADD COLUMN IF NOT EXISTS "latitude"  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
