-- Fase B: tags/sinónimos en Product para mejorar búsqueda del bot.
-- Fase C: flag de super-admin en User + branding mínimo en Tenant.

ALTER TABLE "Product" ADD COLUMN     "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Tenant" ADD COLUMN     "accentColor" TEXT NOT NULL DEFAULT '#2563eb',
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "primaryColor" TEXT NOT NULL DEFAULT '#0f172a',
ADD COLUMN     "secondaryColor" TEXT NOT NULL DEFAULT '#64748b';

ALTER TABLE "User" ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;
