# Performance de la plataforma — 2026-09-29

Cambios de bajo riesgo y alto impacto en `apps/commerce-api`, `apps/commerce-worker` y el
consumo desde `apps/web`. Rama `perf/platform-backend`.

## Diagnóstico (evidencia)

| Punto caliente | Qué pasaba | Dónde |
| --- | --- | --- |
| Auth por cookie en **cada** petición | `Session.findUnique` con `include: { tenant: true }` (fila completa del tenant con JSON de plantillas y branding) + `Membership.findUnique` + `UPDATE Session.lastActivityAt`. El portal abre 5–10 peticiones por pantalla: 3 viajes a la base × N por cada clic. | `auth/session.service.ts`, `auth/guards/principal.guard.ts` |
| Auth por API key en cada petición | `argon2.verify` (argon2id, 19 MB, t=2 ≈ 20–40 ms de CPU) + `UPDATE ApiKey.lastUsedAt` por petición. El agente y el MCP mandan cientos de llamadas con la misma key. | `auth/api-key.service.ts` |
| Bandeja de WhatsApp (sondeo cada 10 s) | `conversationStats` traía **todos** los hilos del tenant con su último mensaje (subconsulta por hilo) y contaba en JS. | `whatsapp/whatsapp.service.ts` |
| Listado de pedidos | `include: { customer: true, revisions: true, payments: true }`: todas las revisiones y sesiones de pago de cada pedido en cada página del listado; ningún consumidor del listado las usa (el detalle sí). | `orders/order.service.ts` |
| Listado de cotizaciones | `customer: true` (ficha completa con datos fiscales y notas). | `quotes/quote.service.ts` |
| Importación CSV | `findFirst` por fila (10 000 filas = 10 000 consultas) en dry-run y en commit. | `catalog/catalog.service.ts` |
| Índices | Listados ordenan por `updatedAt DESC, id DESC` por tenant sin índice → `Sort` sobre scan. `Order` no tenía **ningún** índice por `customerId` (el listado de clientes hace `groupBy customerId`). | `prisma/schema.prisma` |
| HTTP | Sin compresión de respuestas; el rate limit global acumulaba buckets `ip|path` sin borrarlos nunca (fuga de memoria lenta). | `main.ts`, `ops/security.middleware.ts` |
| Worker | Sondeo del outbox cada 1 s aunque la cola esté vacía. | `commerce-worker/src/outbox.publisher.ts` |
| Web | `refetchOnWindowFocus` (default de TanStack) refrescaba TODAS las consultas montadas al volver a la pestaña; sin prefetch de la página siguiente en los listados. | `app/providers.tsx`, `components/app/use-paged-query.ts` |

## Cambios

### commerce-api

1. **`common/ttl-cache.ts`** — caché en memoria con TTL, tope de entradas y single-flight
   (`getOrLoad` deduplica cargas concurrentes; los negativos no se cachean).
2. **`prisma/prisma.service.ts`** — `onWrite(models, listener)`: middleware que avisa a las cachés
   tras cualquier escritura (también dentro de `$transaction`), sin importar qué servicio la hizo.
3. **Sesión (`auth/session.service.ts`)**
   - `select` acotado (ya no viaja la fila del tenant).
   - Resultado positivo cacheado **5 s** por hash del token; se vacía con cualquier escritura en
     `Session`/`Membership`/`User` (revocar, cambiar de empresa, deshabilitar membresía) y
     explícitamente en `revoke`, `revokeAllForUser`, `setActiveTenant`; `refreshSession` siempre
     resuelve contra la base.
   - `lastActivityAt` se persiste como mucho **una vez por minuto** por sesión (la regla de
     inactividad es de 30 min). Ese toque no vacía la caché.
4. **API key (`auth/api-key.service.ts`)** — memo `sha256(token) → secretHash` (10 min): argon2 corre una
   vez por token; la fila se sigue leyendo en cada petición, así que revocación/expiración/scopes se
   ven al instante y si el hash cambia el memo deja de valer. `lastUsedAt` una vez por minuto por key.
5. **`conversationStats`** — una sola consulta agregada (`COUNT ... FILTER`) con un `LATERAL`
   acotado a hilos abiertos y no pendientes para "sin responder" (índice `(conversationId, createdAt)`).
6. **Listados** — pedidos: solo `customer {id, fullName, email, phone}` (se quitan `revisions` y
   `payments`, que siguen en `GET /orders/:id`); cotizaciones: cliente acotado igual, líneas se quedan.
7. **Importación CSV** — un `findMany ... sku IN (...)` por job en dry-run y commit.
8. **HTTP (`main.ts`)** — `compression()` (umbral 1 KB; imágenes/PDF no se tocan) y
   `Cache-Control: private, no-cache` en `GET /quotes/public/*` y `GET /orders/public/*` para que el
   ETag de Express dé 304 en los sondeos de "¿ya se pagó?".
9. **Rate limit** — barrido de buckets vencidos una vez por ventana.

### Índices nuevos (`schema.prisma` + `prisma/migrations/0027_perf_indexes.sql`)

| Tabla | Índice | Para |
| --- | --- | --- |
| `Product` | `(tenantId, updatedAt)` | `GET /catalog/products` (orden por `updatedAt`) |
| `Customer` | `(tenantId, status, updatedAt)` | listado (status ACTIVE + orden) |
| `Customer` | `(tenantId, createdAt)` | KPI "clientes nuevos hoy" |
| `Quote` | `(tenantId, updatedAt)` | listado |
| `Quote` | `(tenantId, customerId)` | ficha del cliente |
| `Order` | `(tenantId, updatedAt)` | listado |
| `Order` | `(tenantId, customerId)` | `groupBy customerId` (listado y ficha de clientes) |
| `CheckoutSession` | `(tenantId, createdAt)` | `GET /payments/sessions` |
| `WhatsAppConversation` | `(tenantId, customerId)` | ficha del cliente, resolve-channel |

Sin tablas nuevas → no hay RLS que agregar. En prod los crea `prisma db push` en el deploy.

### commerce-worker

- Sondeo del outbox con backoff: 1 s con trabajo, ×2 hasta 5 s con la cola vacía (`poll-backoff.ts`).

### web

- `QueryClient`: `refetchOnWindowFocus: false` (lo que necesita estar vivo ya sondea con
  `refetchInterval`), `refetchOnReconnect: true`, `staleTime` 30 s se conserva.
- `usePagedQuery`: precarga la página siguiente con la misma `queryKey` (avanzar pinta desde caché).

## Cómo comprobar

```bash
pnpm --filter @netpay/commerce-api typecheck && pnpm --filter @netpay/commerce-api lint && pnpm --filter @netpay/commerce-api test
pnpm --filter @netpay/commerce-worker test
pnpm --filter @netpay/web typecheck && pnpm --filter @netpay/web lint && (cd apps/web && pnpm exec next build)
```

Tests nuevos: `ttl-cache`, `prisma-write-notifier`, `session-cache`, `api-key-verify-cache`,
`conversation-stats-map`, `catalog-import-batch`, `public-cache-headers`, `rate-limit-sweep`
(commerce-api) y `poll-backoff` (worker).

Contra una base real (`EXPLAIN (ANALYZE, BUFFERS)`):

```sql
-- Antes: Sort sobre Seq/Bitmap scan; después: Index Scan Backward sobre Order_tenantId_updatedAt_idx
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM "Order" WHERE "tenantId" = '<uuid>' ORDER BY "updatedAt" DESC, id DESC LIMIT 25;
-- Antes: Seq Scan de Order filtrando por customerId; después: Index Scan sobre Order_tenantId_customerId_idx
EXPLAIN (ANALYZE, BUFFERS) SELECT "customerId", count(*) FROM "Order" WHERE "tenantId" = '<uuid>' AND "customerId" IN ('...') GROUP BY 1;
```

Medición local (2026-09-29, base de desarrollo con 72 hilos / 192 mensajes / 18 pedidos): el SQL
nuevo de `conversationStats` devuelve exactamente los mismos ocho contadores que el camino
anterior. Con tan pocas filas Postgres elige `Seq Scan` para todo (una página), así que los
tiempos locales no distinguen antes/después; el beneficio de los índices y del agregado en SQL
aparece con volumen (miles de hilos/pedidos por tenant), donde el camino anterior crecía lineal en
filas transferidas al proceso de Node.

Cómo ver el efecto de las cachés en vivo: con `DEBUG`/logs de Prisma (`log: ["query"]`) abrir
el dashboard del portal — antes 3 consultas de auth por petición (Session, Membership, UPDATE);
después 2 consultas en la primera petición de cada 5 s y ninguna en el resto; el `UPDATE` de
`lastActivityAt` una vez por minuto.

## Riesgos y límites

- Las cachés son **por proceso**. Con varias réplicas del API, una revocación hecha en otra
  réplica tarda hasta 5 s (sesión) en verse; la API key no tiene ese problema (la fila se relee).
- La invalidación por middleware ocurre al ejecutarse cada escritura, no al commit de la
  transacción: una lectura concurrente puede repoblar la caché con el valor previo hasta 5 s.
- `GET /orders` ya no trae `revisions` ni `payments` en cada fila; el detalle (`GET /orders/:id`)
  sigue igual. El portal, el agente y el MCP solo usan `customer.fullName` del listado.
