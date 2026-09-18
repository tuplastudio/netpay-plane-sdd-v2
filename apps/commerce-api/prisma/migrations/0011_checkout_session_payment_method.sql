-- Método de pago con el que se cobró la sesión (CARD | SPEI | OXXO).
--
-- El gateway lo manda en el webhook de captura/fallo. Antes solo quedaba
-- embebido en la descripción del asiento del ledger ("Visa •••• 4242"), así
-- que no se podía filtrar ni reportar por método. NULL mientras la sesión
-- sigue PENDING o para sesiones anteriores a esta migración.

ALTER TABLE "CheckoutSession" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;
