-- Integración con ecommerce/ERP externo (Shopify, WooCommerce, SAP, Odoo, ...).
--
-- `originSystem`: nombre del sistema de origen, elegido del catálogo conocido
-- del portal o texto libre ("Otro"). `originExternalId`: el identificador que
-- ese sistema usa para este producto/variante. NULL en ambos = variante
-- nativa de este catálogo.

ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "originSystem" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "originExternalId" TEXT;
