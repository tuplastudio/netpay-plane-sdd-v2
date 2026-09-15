# Tenant isolation: estado actual y fix recomendado

## TL;DR

- ✅ La app **filtra correctamente por `tenantId` en código** (verificado).
- ⚠️ La defensa de RLS a nivel DB **está definida pero bypassed** porque el rol `neondb_owner` (el que usa la app) tiene `rolbypassrls = true`.
- 🔧 Para activar la segunda línea de defensa hay que cambiar de rol en Neon.

## Por qué importa

Si en el futuro alguien introduce un endpoint que olvide el filtro por `tenantId` (ej: `prisma.product.findMany({})` sin `where: { tenantId }`), la query devuelve productos de TODOS los tenants porque RLS está bypaseada.

Con RLS activa, esa misma query devuelve 0 filas para cualquier `tenantId` distinto al del contexto, o una excepción al insertar/actualizar.

## Cómo se verifica hoy

```bash
# ¿neondb_owner bypassa RLS?
psql $DATABASE_URL -c "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'neondb_owner'"
#  rolbypassrls
# --------------
#  t   ← bypasea

# ¿La policy existe?
psql $DATABASE_URL -c "SELECT polname FROM pg_policy WHERE polrelid = '\"Product\"'::regclass"
#    polname
# ---------------
#  tenant_isolation

# ¿La RLS está habilitada en la tabla?
psql $DATABASE_URL -c "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'Product'"
#  relname | relrowsecurity | relforcerowsecurity
# ---------+----------------+---------------------
#  Product | t              | t

# Test: SET tenant_id a otro tenant, ¿la query filtra?
psql $DATABASE_URL -c "SELECT set_config('app.tenant_id', 'aaaaaaaa-...', false); SELECT count(*) FROM \"Product\""
#  count → 39   ← debería ser 0 con RLS activa
```

## Fix

### Opción A — Cambiar a un rol no-owner (recomendado)

En el panel de Neon (o vía API de Neon con token de admin):

1. Crear un rol menos privilegiado:
   ```sql
   CREATE ROLE neondb_app LOGIN PASSWORD '<password>';
   GRANT CONNECT ON DATABASE neondb TO neondb_app;
   GRANT USAGE ON SCHEMA public TO neondb_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO neondb_app;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO neondb_app;
   ```

2. Cambiar `DATABASE_URL` en `.env.prod` (y todas las que use la app) para usar `neondb_app` en lugar de `neondb_owner`.

3. Quitar `BYPASSRLS` del rol owner (opcional pero recomendado):
   ```sql
   ALTER ROLE neondb_owner NOBYPASSRLS;
   ```

4. Verificar:
   ```bash
   psql $DATABASE_URL -c "SELECT count(*) FROM \"Product\""
   #   count
   #  ------
   #      0    ← ahora SÍ filtra
   ```

### Opción B — Solo quitar el bypass al rol owner

Si Neon permite `ALTER ROLE neondb_owner NOBYPASSRLS` (probamos, devuelve `permission denied` para el propio owner):

```sql
ALTER ROLE neondb_owner NOBYPASSRLS;
```

Si funciona: ya está. Si no: hay que hacerlo desde una conexión con un rol más privilegiado (superuser) — Neon expone esto vía soporte.

## Mientras tanto

La app está protegida **a nivel de código** porque cada servicio filtra por `tenantId`. Pero hay que:

1. Asegurar que todo código nuevo use `where: { tenantId }` (code review)
2. No confiar en RLS como red de seguridad

## Verificación rápida post-fix

```bash
# Después del fix, este comando debe devolver 0 filas:
psql $DATABASE_URL -c "
  SELECT set_config('app.tenant_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
  SELECT count(*) FROM \"Product\";
"

# Mientras que con el tenant correcto devuelve 39:
psql $DATABASE_URL -c "
  SELECT set_config('app.tenant_id', '8e3ecbd4-e06c-49a7-a3be-fa18f9af413f', false);
  SELECT count(*) FROM \"Product\";
"
```
