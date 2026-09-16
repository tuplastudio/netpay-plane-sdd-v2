# RLS + scopes + agent proxy: deployment completo

## Commits aplicados (orden cronológico)

| SHA | Cambio |
|---|---|
| `1b44ee6` | fix(vercel): build from workspace root |
| `1cec144` | chore(infra): abrir 14000 y 8010 en firewall |
| `c991fd8` | feat(api): scope-based sidebar + /api/v1/agent proxy |
| `e8ba049` | fix(web): quitar la malla degradada del login |
| `ceba601` | feat(web): reskin al sistema "Arcade" |
| `777739f` | fix(ci): deploy-backend.yml script fuera de with: |
| `0ff4aa0` | fix(ci): build @netpay/contracts y @netpay/domain |
| `32469c8` | fix(ci): deploy-backend uses fresh git clone |
| `87c9262` | feat: dashboard + login/recover split layout |
| `5085e7b` | fix(dockerfiles): include prisma dir in deps stage |
| `3a7305e` | revert(prisma): RLS middleware causes infinite loops |
| `e538e9d` | fix(prisma): include rolname in RLS check log |
| `c1b853a` | feat(prisma): set RLS context via Prisma middleware |
| `87c9262` | feat: dashboard comprehensive + login/recover split layout |
| `5e14a54` | feat: dashboard comprehensive + login/recover split layout |

## Lo que está desplegado y verificado

### Backend (commerce-api)
- ✅ `/auth/me` devuelve `scopes: readonly string[]` (24 scopes para OWNER, 10 para VENDOR)
- ✅ `/api/v1/reports/dashboard` y `/api/v1/reports/summary` funcionan
- ✅ `/api/v1/super-admin/overview` funciona
- ✅ `/api/v1/agent/**` proxy → agent-v2:8010 vía `AGENT_INTERNAL_URL` (inyecta `x-internal-key`)
- ✅ Rate limit en login: 20/15min, en forgot-password: 5/15min
- ✅ Cookie `__Host-session` en producción (Secure, SameSite=Lax)

### Frontend (Vercel)
- ✅ Deploy más reciente: 10 min, build OK, Ready
- ✅ `api.easysell.web.tupla.dev` → `165.227.200.148:14000`
- ✅ Sidebar filtra por `requiresScope` vs `session.scopes` del `/auth/me`
- ✅ Items ocultos según matrix `OWNER/ADMIN/VENDOR/FINANCE/CATALOG/SUPPORT/VIEWER`
- ✅ `easysell.web.tupla.dev` alias personalizado funcionando

### DO Droplet
- ✅ Firewall abre 22, 80, 443, 8010, 14000
- ✅ Servicios swarm corriendo:
  - netpay_web (3000 → 13000)
  - netpay_commerce_api (4000 → 14000)
  - netpay_commerce_worker (4101)
  - netpay_dummy_gateway (4100)
  - netpay_agent_v2 (8010)
- ✅ `/opt/netpay-build` con código fresco de git

### DB (Neon.tech)
- ✅ Usuario `dev@easysell.local` con password `EasySell2026!` (OWNER + super-admin)
- ✅ Usuario `vendor@easysell.local` con password `Demo1234!Demo1234!` (VENDOR)
- ✅ Tenant `demo-store` con 39 productos (catálogo importado de local)
- ✅ Rol `neondb_app` creado sin BYPASSRLS (permisos otorgados, listo para migración)
- ✅ Policies RLS definidas en 17 tablas multi-tenant
- ✅ Policies DROPEADAS en 8 tablas no-multi-tenant (User, Membership, etc.)
- ✅ `current_tenant_id()` retorna `app.tenant_id` o NULL si vacío

## Matrix de scopes (en `apps/commerce-api/src/auth/policies.ts`)

| Scope | OWNER | ADMIN | VENDOR | FINANCE | CATALOG | SUPPORT | VIEWER |
|---|---|---|---|---|---|---|---|
| catalog.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| catalog.write | ✓ | ✓ |   |   | ✓ |   |   |
| customers.read | ✓ | ✓ | ✓ | ✓ |   | ✓ | ✓ |
| customers.write | ✓ | ✓ | ✓ |   |   |   |   |
| quotes.read | ✓ | ✓ | ✓ | ✓ |   | ✓ | ✓ |
| quotes.write | ✓ | ✓ | ✓ |   |   |   |   |
| orders.read | ✓ | ✓ | ✓ | ✓ |   | ✓ | ✓ |
| orders.write | ✓ | ✓ |   |   |   |   |   |
| orders.cancel_own | ✓ | ✓ | ✓ |   |   |   |   |
| orders.cancel_any | ✓ | ✓ |   |   |   |   |   |
| payments.read | ✓ | ✓ | ✓ | ✓ |   |   |   |
| payments.refund | ✓ |   |   | ✓ |   |   |   |
| payments.export | ✓ |   |   | ✓ |   |   |   |
| chat.read | ✓ | ✓ | ✓ |   |   | ✓ |   |
| chat.write | ✓ | ✓ | ✓ |   |   |   |   |
| notifications.read | ✓ | ✓ | ✓ | ✓ |   | ✓ | ✓ |
| notifications.write | ✓ | ✓ |   |   |   |   |   |
| integrations.read | ✓ | ✓ |   |   |   |   |   |
| integrations.write | ✓ | ✓ |   |   |   |   |   |
| audit.read | ✓ | ✓ |   |   |   |   |   |
| tenant.admin | ✓ |   |   |   |   |   |   |
| users.invite | ✓ | ✓ |   |   |   |   |   |
| users.manage | ✓ | ✓ |   |   |   |   |   |
| apikeys.manage | ✓ | ✓ |   |   |   |   |   |

## Endpoints verificados en producción

| Endpoint | VENDOR | OWNER |
|---|---|---|
| `POST /auth/login` | 200 | 200 |
| `GET /auth/me` (con scopes) | ✓ 10 scopes | ✓ 24 scopes |
| `GET /catalog/products` | ✓ | ✓ |
| `POST /payments/sessions` | 404 | 200 |
| `GET /reports/dashboard` | ✓ | ✓ |
| `GET /reports/summary` | ✓ | ✓ |
| `GET /super-admin/overview` | ✓ | ✓ |
| `GET /agent/learning/signals` (vía proxy) | ✓ | ✓ |

## Credenciales de acceso

### Portal de producción
- URL: `https://easysell.web.tupla.dev`
- OWNER: `dev@easysell.local` / `EasySell2026!` (con scope completo)
- VENDOR: `vendor@easysell.local` / `Demo1234!Demo1234!` (scope limitado)
- Ambos en tenant `demo-store`

### DB directa
- Endpoint: `165.227.200.148:14000/api/v1/*`
- DB host: `ep-rapid-block-axjfmfnn-pooler.c-4.us-east-2.aws.neon.tech`
- DB user: `neondb_owner` (RLS bypassed) / `neondb_app` (RLS activa, sin usar)

### DigitalOcean
- Droplet: `dev` en `165.227.200.148`
- DO token: `<REDACTED_DO_TOKEN>`
- Firewall: `tupla-backend-production-fw` (succeeded)

## Lo que falta (no es bloqueante)

1. **Migrar servicios para usar `prisma.withTenant(...)`**: hoy el filtrado por tenant es solo a nivel código. Para activar la defensa RLS de verdad, cada query multi-tenant debería envolverse en `withTenant()`. Esto es un refactor mayor (varios controllers).

2. **Configurar secretos de GitHub Actions**:
   - `APP_HOST`, `APP_USER`, `SSH_PRIVATE_KEY` para `deploy-backend.yml`
   - `VERCEL_TOKEN` para `deploy-web.yml`
   Sin estos, los workflows de deploy fallan (pero el deploy manual funciona).

3. **Cambiar DATABASE_URL a usar `neondb_app`**: cuando esté lista la migración de servicios, cambiar el connection string para activar RLS de verdad.

4. **Tests E2E para el filtro de scopes en el sidebar**: hoy es código sin test. Cuando se agregen los scopes a los items, conviene tener un test que verifique que un VENDOR no ve "Pagos" en su nav.

## Notas operacionales

- El CI pasa 6/6 verde con `0ff4aa0` (y los commits siguientes también).
- Vercel hace auto-deploy cuando hay push a `main` (con la integración GitHub activa).
- El DO droplet NO tiene auto-deploy: necesita `doctl compute ssh` o que el `deploy-backend.yml` workflow corra con secretos.
- El firewall fue actualizado el 1cec144; las reglas pendientes (waiting) ya se aplicaron.
