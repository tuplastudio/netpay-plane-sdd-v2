-- Texto alternativo opcional por foto de catálogo.
--
-- Lo captura quien administra el catálogo desde el portal; sirve como `alt`
-- en el checkout público y como contexto para el agente cuando describe una
-- foto. NULL = sin texto (el portal usa el título del producto como respaldo).
--
-- Sin tabla nueva: "ProductImage" ya tiene RLS desde 0018.

ALTER TABLE "ProductImage" ADD COLUMN IF NOT EXISTS "altText" TEXT;
