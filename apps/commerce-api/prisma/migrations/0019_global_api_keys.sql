-- Keys globales de super-admin (T-IAM-09b): tenantId de ApiKey pasa a ser
-- NULL-able. NULL = key global, sin tenant fijo; el tenant sobre el que
-- actúa cada request lo manda el header X-Tenant-Id (ver PrincipalGuard).
--
-- Documentación de la evolución del esquema: en prod, `deploy-backend.yml`
-- aplica esto vía `prisma db push` contra schema.prisma (no `prisma migrate
-- deploy`, ver comentario en el workflow); este archivo no se ejecuta solo.

ALTER TABLE "ApiKey" ALTER COLUMN "tenantId" DROP NOT NULL;

-- Para poder auditar la creación/revocación de una key global (acción de
-- plataforma, sin tenant): NULL = fila de auditoría sin tenant.
ALTER TABLE "AuditLog" ALTER COLUMN "tenantId" DROP NOT NULL;

-- La política RLS de ApiKey (creada en 0002) compara "tenantId" =
-- current_tenant_id(): una fila con tenantId NULL nunca hace match (NULL en
-- SQL no es igual a nada, ni a sí mismo) y por tanto es invisible bajo RLS
-- real. Es el comportamiento correcto: una key global no "pertenece" a
-- ningún tenant y no debe aparecer en un listado filtrado por tenant. Su
-- propio listado (GET /super-admin/api-keys) consulta con tenantId IS NULL,
-- fuera del alcance de esa policy — igual que el resto de rutas
-- /super-admin/*, pensadas para un rol que ve todo (hoy vía BYPASSRLS del
-- rol de conexión; ver docs/TENANT-ISOLATION.md).
