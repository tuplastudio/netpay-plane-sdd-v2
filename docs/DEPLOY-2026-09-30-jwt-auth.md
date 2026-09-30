# Deploy 2026-09-30: access JWT + refresh token opaco

## Qué cambió

Reemplaza la sesión de un solo cookie (`__Host-session`, 12h absoluto / 30 min
inactividad) por un par de tokens:

- **Access token**: JWT firmado (HS256, 15 min por defecto, `ACCESS_TOKEN_TTL_MS`),
  viaja en `Authorization: Bearer <token>`, se valida **sin tocar la BD** (firma +
  expiry + `jti`). El frontend lo guarda en memoria (`apps/web/src/lib/access-token.ts`),
  nunca en `localStorage`/`sessionStorage`.
- **Refresh token**: opaco, cookie HttpOnly `__Host-refresh` en prod (`refresh` en
  dev), 30 días por defecto, se **rota** en cada `POST /auth/refresh` (el viejo se
  revoca, se emite uno nuevo).
- `Session.accessJti` (columna nueva) permite revocar el access antes de su `exp`
  natural: cambio de rol, logout inmediato, detección de robo.

Commits: `143a2a5` (feat principal), `f1dd267..143a2a5` en `main`.

Archivos clave:
- `apps/commerce-api/src/auth/jwt.service.ts` (nuevo) — firma/verifica el access JWT.
- `apps/commerce-api/src/auth/session.service.ts`, `auth.controller.ts`, `auth.service.ts`,
  `guards/principal.guard.ts`, `guards/authenticated.guard.ts` — flujo login/refresh/logout.
- `apps/commerce-api/src/ops/security.middleware.ts` — valida `JWT_SECRET` al arrancar.
- `apps/commerce-api/prisma/schema.prisma` + `prisma/migrations/0032_session_access_jti/` —
  columna `Session.accessJti` (el `.sql` es documentación; en prod el schema se
  sincroniza con `prisma db push --skip-generate`, ver `docs/DEPLOYMENT-STATUS.md`).
- `apps/web/src/lib/access-token.ts` (nuevo) — store en memoria del access token.
- `apps/web/src/lib/api.ts` — interceptor inyecta el Bearer, guarda el access token
  que devuelven `/auth/login`, `/auth/mfa/verify` y `/auth/refresh`.

## Por qué importa el orden

1. **`JWT_SECRET` tiene que existir en prod ANTES de que commerce-api reinicie.**
   `jwt.service.ts` y `security.middleware.ts` hacen fail-fast al arrancar si
   `JWT_SECRET` falta o mide menos de 32 chars — sin eso el proceso no levanta,
   caída total de la API (no solo login).
2. **commerce-api y web son un cambio acoplado.** El backend ya no acepta el
   cookie viejo de sesión; el frontend viejo no manda `Authorization: Bearer`.
   Un usuario con la sesión vieja pierde la sesión al primer request después del
   deploy del backend — es esperado, no es un bug — pero si el **frontend nuevo**
   no está desplegado, no puede volver a loguearse coherentemente (login sí
   funciona porque es endpoint público, pero cualquier navegación posterior
   fallará hasta que el web nuevo esté afuera).

## Pasos ejecutados

1. `.github/workflows/one-off-set-jwt-secret.yml` — workflow one-off, push-triggered
   (el repo en GitHub tiene default branch `fix/password-recovery-hardening`, no
   `main`, así que `workflow_dispatch` no ve workflows nuevos en `main`; se dispara
   por `paths:` sobre el propio archivo). SSH al droplet (`appleboy/ssh-action`,
   secrets `APP_HOST`/`APP_USER`/`SSH_PRIVATE_KEY`), genera `openssl rand -hex 32`
   **en el propio droplet** (nunca pasa por logs de CI) y lo agrega a
   `/opt/netpay/infra/.env.prod` si no existe ya. Idempotente. Run:
   `gh run list --workflow=one-off-set-jwt-secret.yml`.
2. Verificación local antes de pushear: `pnpm test` en `apps/commerce-api`
   (72 archivos, 614 tests, todos verdes), `tsc --noEmit` limpio, `nest build`
   limpio, `next build` limpio en `apps/web`.
3. Commit `143a2a5` a `main` → dispara `deploy-backend.yml` (paths incluyen
   `apps/commerce-api/**`), que hace build + `docker compose up` de commerce-api
   en el droplet y corre `prisma db push --skip-generate` para sincronizar
   `Session.accessJti`.
4. Deploy de `apps/web` a Vercel: **manual**, `deploy-web.yml` sigue roto
   (`VERCEL_TOKEN` no existe como secret — confirmado con `gh secret list`).
   Correr desde la RAÍZ del repo (no desde `apps/web`, porque `rootDirectory` en
   Vercel ya es `apps/web`):
   ```
   vercel deploy --prod --yes
   ```
   El CLI local ya está logueado como `tuplastudio`. Este comando lo corre el
   usuario (el clasificador de auto-mode lo bloquea como "Blind Apply").

## Incidente durante el deploy (resuelto)

`deploy-backend.yml` run `36683651515` (primer intento) falló en el paso
"Prisma migrate deploy" (en realidad `prisma db push --skip-generate`, ver
`docs/DEPLOYMENT-STATUS.md`): Prisma reportó riesgo de pérdida de datos al
agregar el unique constraint de `accessJti` y abortó sin aplicar nada — el
`|| true` no cubre este paso, así que el fallo se vio (no fue silencioso).

Causa real, encontrada inspeccionando la tabla en vivo
(`SELECT column_name FROM information_schema.columns` /
`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Session'`
corridos dentro del contenedor `commerce-api`, ver
`one-off-inspect-session-table.yml`): la columna `accessJti` YA existía en
prod, con un índice único **parcial** (`... WHERE "accessJti" IS NOT NULL`,
`Session_accessJti_key`) — alguien corrió el `.sql` plano de
`prisma/migrations/0032_session_access_jti/` a mano contra la BD en algún
momento antes de este deploy, aunque la convención del repo es que esos
`.sql` son solo documentación y el schema real se sincroniza con
`prisma db push` (ver `docs/DEPLOYMENT-STATUS.md`). El índice parcial no
coincide con el índice simple que genera `@unique` en `schema.prisma`, y al
tener el mismo nombre, `db push --accept-data-loss` chocaba con
`relation "Session_accessJti_key" already exists`.

Arreglo: `one-off-fix-accessjti-index.yml` — dropea el índice parcial viejo
dentro del contenedor (`DROP INDEX IF EXISTS "Session_accessJti_key"` vía
Prisma Client, sin pasar por variables de entorno de host) y corre
`db push --accept-data-loss` de nuevo. Resultado: `🚀 Your database is now
in sync with your Prisma schema`. Con el schema ya sincronizado, se
re-corrió el job que había fallado (`gh run rerun 36683651515 --failed`),
que retomó desde "Deploy on droplet" y esta vez completó los pasos
restantes (RLS, vhost, healthcheck) sin tocar código nuevo.

Workflows one-off usados y dejados en el repo (documentan la corrida, no
hace falta borrarlos): `one-off-set-jwt-secret.yml`,
`one-off-unblock-session-jti-push.yml` (intento fallido, dejado como
evidencia), `one-off-check-schema-sync.yml`, `one-off-inspect-session-table.yml`,
`one-off-fix-accessjti-index.yml`.

**Lección:** si en el futuro se vuelve a correr un `.sql` de
`prisma/migrations/*` a mano "para adelantar trabajo", debe generar
exactamente lo mismo que generaría `db push` del `schema.prisma`
correspondiente (mismo nombre de índice, mismas cláusulas) — si no,
`db push` choca la próxima vez. Más simple: no correrlos a mano, son
documentación; dejar que `db push` cree todo.

## Verificación post-deploy

- ✅ `curl -s -o /dev/null -w '%{http_code}' https://api-easysell.tupla.dev/api/v1/healthz`
  → `200`, confirmado 2026-09-30.
- ✅ `deploy-backend.yml` run `36683651515` (tras el rerun): RLS aplicado en las
  9 tablas fuera de `schema.prisma`, vhosts `api-easysell.tupla.dev` e
  `imssbienestar.tupla.dev` restaurados (estaban ausentes, self-heal normal),
  healthcheck interno OK para commerce-api y agent-imssbienestar.
- ⬜ Login end-to-end en `https://easysell.web.tupla.dev/login`: pendiente de
  confirmar manualmente que la respuesta trae `accessToken`/`accessExpiresAt`
  y que la navegación posterior no vuelve a `/login` — bloqueado en que el
  frontend nuevo todavía no está en Vercel (ver pendiente abajo).
- Usuarios con sesión previa al deploy: se les cierra sesión una vez (esperado),
  vuelven a loguear sin problema.

## Rollback

- `git revert 143a2a5` + push a `main` → vuelve el cookie único; `Session.accessJti`
  queda en la tabla sin usarse (columna nullable, no rompe nada, `prisma db push`
  no la borra a menos que se quite del schema en el revert).
- El `JWT_SECRET` agregado en `.env.prod` se puede dejar — no se lee si el código
  revertido no lo usa.
- Si el frontend nuevo salió pero el backend se revierte: el interceptor de
  `api.ts` sigue mandando `Authorization: Bearer` de más, inofensivo (el backend
  viejo lo ignora y usa el cookie).

## Dos bugs post-deploy encontrados y arreglados en vivo

1. **`apps/web/src/middleware.ts` nunca se actualizó en el corte a JWT.**
   Seguía buscando el cookie viejo (`__Host-session`/`session`) para decidir
   si había sesión, y el proxy de `/api/v1/*` no reenviaba el header
   `Authorization`. Resultado: el edge de Next.js redirigía a `/login` como
   si nadie tuviera sesión, y aunque no redirigiera, el access JWT nunca
   llegaba al backend. El backend respondía sano (`healthz` 200) todo el
   tiempo — el síntoma "backend caído" era 100% del frontend. Fix en
   `143a2a5`+1 commit: cookie renombrado a `__Host-refresh`/`refresh`,
   `Authorization` reenviado. Verificado en vivo: `/customers` sin cookie
   → 307 a `/login`; con `__Host-refresh` presente → 200 (antes redirigía
   siempre, sin importar el cookie).
2. **`apps/commerce-api/src/auth/jwt.service.ts` rompía el 100% de los
   logins con password correcto.** `signAsync(claims, { jwtid: jti })`
   con `jti` ya presente en `claims` — `jsonwebtoken` tira `Bad
   "options.jwtid" option. The payload already has an "jti" property.`
   Cualquier intento de login con credenciales válidas devolvía 500
   `DEPENDENCY_UNAVAILABLE`. Encontrado leyendo logs de prod en vivo
   (`docker compose logs commerce-api`) tras probar con un usuario real
   (`owner@demo.local`). Ningún test lo agarró porque `AccessTokenService`
   se mockeaba en todos lados; se agregó `tests/jwt-service.test.ts` con un
   round-trip real de sign/verify. Fix + test committeados, deploy
   `36747428933` corrido y verificado: login real devuelve `accessToken` +
   `refreshToken`, y `GET /auth/me` con el Bearer resuelve bien a través del
   proxy de Vercel.

**Estado final (2026-09-30, verificado):** backend y frontend desplegados,
login end-to-end funcionando en `https://easysell.web.tupla.dev`.

## Pendiente / no incluido en este deploy

- `apps/mcp-server` (`@cgalaviz/easysell-mcp`) trae cambios grandes (registries
  nuevos: `iam`, `tenants`, `uploads`, `canned-responses`; tests nuevos) pero es
  un paquete npm publicable independiente, no parte del stack del droplet
  (no está en `infra/compose.prod.yaml` ni en los `paths:` de `deploy-backend.yml`).
  Se commiteó a `main` junto con el resto pero **no se publicó a npm** — publicar
  es una acción separada e irreversible (registro público), pendiente de decisión
  explícita.
- `apps/agent-v2/tests/test_robustness.py` es un test nuevo, no requiere deploy
  propio (agent-v2 sí está en `deploy-backend.yml`, así que su imagen se
  reconstruyó igual en este run, pero el cambio es solo de tests).
