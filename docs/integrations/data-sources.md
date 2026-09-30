# Fuentes de datos: sincronización del catálogo desde REST / MCP

Una **fuente de datos** (`DataSource`) es una API REST o un servidor MCP del
que Easy Sell trae productos y los mete al catálogo del tenant: crea los que
no existen, actualiza los que cambiaron y, si se pide, archiva los que dejaron
de venir. Nunca borra.

- Módulo backend: `apps/commerce-api/src/data-sources/`
- Panel: **Administración → Fuentes de datos** (`/admin?tab=fuentes-datos`)
- Permisos: `integrations.read` para ver, `integrations.write` para todo lo
  demás (OWNER y ADMIN del tenant).

## Modelo

| Tabla | Para qué |
| --- | --- |
| `DataSource` | Conexión (URL, auth, headers), `config` con el mapeo, programación, último resultado y lock. |
| `DataSourceRun` | Una fila por sincronización: `stats` y `errorSample`. |

Ambas tienen `tenantId` y RLS (`tenant_isolation`). Migración documental:
`apps/commerce-api/prisma/migrations/0027_data_sources.sql`.

La credencial se guarda en `credentialEnc` cifrada con `secret-cipher`
(AES-256-GCM, clave derivada de `TOKEN_ENCRYPTION_KEY_REF`, la misma que usan
los secretos de `Integration`). Nunca sale por el API: al editar, si el campo
se deja vacío se conserva la guardada.

Las variantes creadas o adoptadas por una fuente llevan
`ProductVariant.originSystem = DataSource.id` y `originExternalId` = id
externo (o el SKU si la fuente no trae id).

## Endpoints

| Método | Ruta | Scope | Qué hace |
| --- | --- | --- | --- |
| GET | `/data-sources` | read | Lista (sin credenciales). |
| POST | `/data-sources` | write | Alta. Valida URL (anti-SSRF), `config` y cron. |
| GET | `/data-sources/:id` | read | Detalle. |
| PATCH | `/data-sources/:id` | write | Edición parcial. `credential` ausente = conservar; `""` = borrar. |
| DELETE | `/data-sources/:id` | write | Borra la fuente y sus runs. Los productos se quedan. |
| POST | `/data-sources/test` | write | Prueba ad-hoc (cuerpo = alta, `id` opcional para reutilizar la credencial guardada). Devuelve `fetched`, `rawSample` (3 crudos) y `preview` (3 mapeados). No escribe. |
| POST | `/data-sources/:id/test` | write | Igual, sobre una fuente guardada. |
| POST | `/data-sources/tools` | write | MCP: `tools/list` con la conexión del cuerpo. |
| GET | `/data-sources/tools?id=` | write | MCP: `tools/list` de una fuente guardada. |
| POST | `/data-sources/:id/sync` | write | Sincroniza ahora en segundo plano. `202 { runId }`. `409` si ya hay una en curso. |
| GET | `/data-sources/:id/runs` | read | Últimas 50 corridas. |

Todo queda en `AuditLog` (`data_source.created|updated|deleted|sync_requested|sync_finished`).

## Cuerpo de alta

```json
{
  "name": "ERP de bodega",
  "kind": "REST",
  "url": "https://api.mi-erp.example/v1",
  "authType": "BEARER",
  "credential": "eyJ...",
  "headers": { "Accept-Language": "es-MX" },
  "config": { "...": "ver abajo" },
  "scheduleEveryMinutes": 60,
  "scheduleCron": null,
  "deactivateMissing": true,
  "status": "ACTIVE"
}
```

- `kind`: `REST` | `MCP`.
- `authType`: `NONE` | `BEARER` (`Authorization: Bearer <credential>`) |
  `API_KEY_HEADER` (`<authHeaderName>: <credential>`, header por defecto
  `X-API-Key`) | `BASIC` (`credential` = `usuario:contraseña`).
- `headers`: extras fijos. No pueden pisar `Authorization`.
- Programación: `scheduleEveryMinutes` (5 … 10080) **o** `scheduleCron`
  (5 campos, UTC; si vienen ambos manda el cron). Ambos `null` = solo manual.
- `status`: `ACTIVE` (se programa) | `PAUSED` (solo manual). `ERROR` lo pone
  el sistema cuando el último run falló; la programación sigue intentando.

## `config` para REST

```json
{
  "listPath": "/products",
  "method": "GET",
  "query": { "status": "active" },
  "body": null,
  "pagination": { "type": "page", "pageParam": "page", "sizeParam": "limit", "pageSize": 100, "startPage": 1 },
  "itemsJsonPath": "data.items",
  "fieldMap": {
    "sku": "sku",
    "name": "title",
    "price": "pricing.amount",
    "currency": "pricing.currency",
    "stock": "inventory.available",
    "description": "description",
    "category": "category.name",
    "active": "status",
    "externalId": "id",
    "imageUrl": "images[*].src"
  },
  "maxItems": 5000
}
```

- `listPath`: relativa a `url` (`/products`) o URL absoluta.
- `method`: `GET` (default) o `POST` (con `body` JSON).
- `pagination.type`:
  - `none`: una sola petición.
  - `page`: manda `pageParam=N` (y `sizeParam=pageSize` si se indican). Se
    detiene en la primera página vacía o incompleta (cuando se conoce
    `pageSize`). `startPage` por defecto 1; `maxPages` opcional.
  - `cursor`: manda `cursorParam=<cursor>` y lee el siguiente en
    `nextCursorPath` de la respuesta; se detiene cuando viene vacío/null o
    se repite.
- Tope duro: 500 páginas y `maxItems` (default 5000, máximo 50000).

Ejemplo con cursor:

```json
{
  "listPath": "/catalog/items",
  "pagination": { "type": "cursor", "cursorParam": "after", "nextCursorPath": "meta.next_cursor" },
  "itemsJsonPath": "items",
  "fieldMap": { "sku": "code", "name": "name", "price": "price", "currency": "=MXN" }
}
```

## `config` para MCP

```json
{
  "toolName": "list_products",
  "toolArgs": { "limit": 1000 },
  "itemsJsonPath": "products",
  "fieldMap": { "sku": "sku", "name": "name", "price": "price", "stock": "stock" }
}
```

El cliente habla **Streamable HTTP** (JSON-RPC 2.0 por `POST` a `url`):
`initialize` → `notifications/initialized` → `tools/list` / `tools/call`.
Acepta respuestas `application/json` o `text/event-stream` (se lee el flujo
completo y se toma el mensaje con el `id` esperado). Propaga
`mcp-session-id` si el servidor lo devuelve. No abre el canal GET de eventos.

Del resultado de la tool se usa `structuredContent` si existe; si no, se
parsea como JSON el texto de los bloques `content[].text` (uno = ese valor;
varios = arreglo). Sobre eso se aplica `itemsJsonPath`.

## `itemsJsonPath` y rutas del `fieldMap`

JSONPath mínimo, sin dependencias (`src/data-sources/json-path.ts`):

| Sintaxis | Ejemplo |
| --- | --- |
| Raíz | `""` o `$` |
| Punto | `data.items` |
| Índice (negativo desde el final) | `images[0].url`, `prices[-1]` |
| Comodín (aplana un nivel) | `variants[*].sku`, `images[*].src` |
| Clave con puntos | `["Precio.Base"]` |
| Literal (solo en `fieldMap`) | `=MXN`, `=true` |

No hay filtros ni descendientes (`..`).

### Campos

| Campo | Obligatorio | Normalización |
| --- | --- | --- |
| `sku` | sí | trim, máx. 120. Único por tenant. |
| `name` | sí | trim, máx. 200. |
| `price` | sí | número o texto (`"1,250.50"`, `"$12"`); 2 decimales; ≥ 0. |
| `currency` | no | ISO 3 letras, mayúsculas. Default `MXN`. |
| `stock` | no | 3 decimales; vacío = sin control de inventario (`null`). |
| `description` | no | máx. 4000. |
| `category` | no | minúsculas, máx. 60; se agrega a `Product.tags`. |
| `active` | no | `false`, `0`, `no`, `inactive`, `inactivo`, `disabled`, `archived`, `off` = inactivo. Ausente = activo. |
| `externalId` | no | id del sistema origen. Default = `sku`. |
| `imageUrl` | no | URL o arreglo de URLs / objetos `{ url }`. **Solo se cuenta** (ver abajo). |

## Motor de sincronización (`sync-engine.ts`)

Un ítem = un `Product` con una `ProductVariant` del mismo SKU.

1. Busca la variante por `(originSystem = fuente, originExternalId)`; si no,
   por `(tenantId, sku)` (así adopta productos capturados a mano).
2. Si existe: compara campo por campo y escribe solo lo que cambió
   (`updated`); si nada cambió, `skipped`. Idempotente: correr dos veces el
   mismo feed no genera escrituras.
3. Si no existe y está activo: crea producto + variante en `ACTIVE`
   (`satProductCode 01010101`, `satUnitCode H87`, como el catálogo). Si no
   existe y viene inactivo: `skipped`.
4. Ítem inactivo existente: archiva la variante; el producto solo si no le
   queda ninguna variante activa.
5. `deactivateMissing`: archiva las variantes de **esta** fuente que no
   vinieron (por `originExternalId`) y los productos que se quedan vacíos.
   Con 0 ítems válidos no se archiva nada (un endpoint roto no vacía el
   catálogo). Otras fuentes y productos nativos no se tocan.
6. Errores de mapeo o de escritura por ítem no detienen la corrida: se
   cuentan en `stats.errors` y los primeros 10 van a `errorSample`.

`stats`: `{ fetched, mapped, created, updated, skipped, deactivated, errors, images }`.
Estado del run: `SUCCEEDED` (sin errores), `PARTIAL` (algún ítem falló),
`FAILED` (no se pudo conectar / mapeo inválido: `errorSample[0]` trae el motivo).

### Imágenes: decisión

`ProductImage` exige un objeto en **nuestro** storage (`storageKey` único +
`StorageObject`) y el borrado de imágenes limpia ese objeto. Guardar una URL
externa rompería ese contrato, y descargar imágenes de terceros implica
validar tipo/tamaño y hacer un fetch con guard anti-SSRF por cada una. Por
eso en esta versión **`imageUrl` se mapea y se muestra en la vista previa
pero no se importa**; `stats.images` dice cuántos ítems traían imagen.
Cuando el flujo de `ProductImage` admita ingestión por URL, el motor solo
tiene que llamarlo con `item.imageUrls`.

## Seguridad

- Toda URL (alta, edición, prueba y **antes de cada petición**) pasa por
  `integrations/url-guard.ts`: solo http/https, FQDN público, DNS resuelto a
  IPs públicas; sin seguir redirecciones.
- Timeout 20 s por petición; 2 reintentos con backoff (400 ms, 800 ms) solo
  ante red, 5xx o 429. Cuerpo máximo 20 MB.
- El scheduler no expone nada; corre con `actorId = null` y deja auditoría.

## Scheduler

`DataSourceSchedulerService` (en commerce-api, mismo patrón que el autocierre
de conversaciones: `setInterval` de 1 min con `unref`). Cada tick toma hasta
20 fuentes con `status ∈ {ACTIVE, ERROR}`, `nextRunAt <= now` y sin lock
vigente, y las lanza como `SCHEDULE`.

Lock: `DataSource.lockedAt` se toma con un `updateMany` condicional (atómico
entre réplicas). Un lock de más de 30 min se considera huérfano. Tras cada
run se recalcula `nextRunAt` desde la hora de fin.

Variable de entorno: `DATA_SOURCE_SCHEDULER_JOB=false` apaga el tick (réplicas
que no deben correr jobs, pruebas locales). No hay ninguna otra variable
nueva: el cifrado usa `TOKEN_ENCRYPTION_KEY_REF`.

## Pruebas

`apps/commerce-api/tests/data-source-*.test.ts`: JSONPath, mapeo y validación
de config, cliente REST (paginación por página/cursor, reintentos, guard),
cliente MCP (initialize/tools/list/tools/call, SSE), motor de upsert
idempotente con Prisma en memoria, cron/due-check y tick del scheduler.
