# atiendeya-mcp — MCP de Atiende ya

Servidor [MCP](https://modelcontextprotocol.io) que expone la API de Atiende ya
(commerce-api: catálogo, clientes, cotizaciones, pedidos, pagos, envíos,
reportes, notificaciones, integraciones, uso, conversaciones de WhatsApp,
auditoría y, con una key global, administración de plataforma) como
herramientas para Claude o cualquier agente compatible con MCP.

Corre por **stdio** — el cliente (Claude Desktop, Claude Code, cualquier host
MCP) lo lanza como proceso local. No expone ningún puerto ni requiere
desplegarlo aparte. Publicado en npm como `atiendeya-mcp`.

## Instalar y correr

```bash
npx atiendeya-mcp
```

(o instalado globalmente: `npm install -g atiendeya-mcp` y luego `atiendeya-mcp`).
Necesita `COMMERCE_API_KEY` en el entorno — ver **Autenticación** abajo. Sin
ella, el proceso falla al arrancar con un mensaje explicando qué falta, no con
un error de red genérico en la primera tool que se intente usar.

## Autenticación

Todo pasa por una **API key** (`Authorization: Bearer npk_...`), nunca una
sesión de usuario. Hay dos tipos:

- **Key de tenant** (la normal): se crea desde el panel en **Empresa → API
  keys**, con los scopes que elijas. Solo puede operar la empresa que la
  emitió.
- **Key global** (T-IAM-09b, solo super-admin): se crea en **Plataforma →
  API keys globales**. Sin tenant fijo — cada llamada decide sobre cuál
  operar con `COMMERCE_TENANT_ID` (ver abajo). Siempre lleva TODOS los
  scopes; no es configurable. Al arrancar, el servidor detecta si la key es
  global y lo avisa por stderr (`⚠️ ... esta API key es GLOBAL ...`), para
  que nunca sea una sorpresa a media sesión.

En ambos casos, el MCP solo puede hacer lo que la key tenga permitido — todo
lo demás lo rechaza commerce-api con 403 (o 404 "Sin tenant" si falta
`X-Tenant-Id` con una key global). El servidor MCP no añade ni quita permisos
por su cuenta.

**Principio de menor privilegio:** usa una key de tenant con solo los scopes
que de verdad necesites, salvo que el caso de uso genuinamente cruce varias
empresas (soporte de plataforma, automatización cross-tenant) — ahí sí toca
key global, y con eso asumes que cualquier prompt que ese agente procese
puede, en teoría, terminar tocando cualquier empresa.

## Variables de entorno

| Variable | Requerida | Default | Descripción |
|---|---|---|---|
| `COMMERCE_API_KEY` | Sí | — | La API key (`npk_...`). |
| `COMMERCE_API_BASE_URL` | No | `https://api-easysell.tupla.dev/api/v1` | Base de la API. Cambiar para apuntar a local/staging. |
| `COMMERCE_TENANT_ID` | No | — | Solo tiene efecto con una key global: manda `X-Tenant-Id` en cada request para acotarla a una empresa. Con una key de tenant normal se ignora. |
| `COMMERCE_TIMEOUT_MS` | No | `30000` | Tope por request antes de abortar. Una conexión colgada no debe dejar la sesión MCP entera esperando para siempre. |

## Seguridad

- **`Authorization`/`X-Tenant-Id` nunca vienen del modelo**: cada tool los
  arma el propio servidor desde variables de entorno fijas al arrancar
  (`src/client.ts`); nada que el agente escriba en los argumentos de una
  tool puede cambiar quién llama ni sobre qué tenant, más allá de lo que la
  tool declara legítimamente (p. ej. un `id` de pedido).
- **Anotaciones de tool** (`readOnlyHint`/`destructiveHint`/`idempotentHint`/
  `openWorldHint`, spec de MCP): cada tool las declara — `GET` es
  `readOnlyHint`, `DELETE` y las mutaciones con efecto real difícil de
  deshacer (reembolsos, cancelaciones, desactivar una integración/empresa,
  mandar un mensaje de WhatsApp real) llevan `destructiveHint: true`. Un
  cliente MCP que las respeta (Claude Desktop, Claude Code) puede pedir
  confirmación antes de ejecutarlas. Son solo señales — commerce-api sigue
  siendo el único candado real vía scopes.
- **Timeout por request**: ver `COMMERCE_TIMEOUT_MS` arriba.
- **Nunca guardes la key en texto plano compartido**: el secreto (`npk_...`)
  se muestra una sola vez al crearlo. Si tu `.mcp.json` o
  `claude_desktop_config.json` se sincroniza, se respalda o se comparte,
  considera la key expuesta — revócala y crea una nueva si eso pasa. Preferir
  un gestor de secretos del sistema operativo cuando el cliente MCP lo
  soporte, en vez de dejar la key en el JSON de config.
- **Menor privilegio**: ver arriba. Una key con solo `catalog.read` no puede
  hacer nada si el proceso o el prompt se ven comprometidos, más allá de leer
  catálogo.
- El código es 100% código abierto en este repo (`apps/mcp-server/src`):
  audítalo — no hay llamadas de red a nada más que
  `COMMERCE_API_BASE_URL`, ni telemetría, ni logging del contenido de la key.

## Build (para desarrollo local del propio servidor)

```bash
pnpm --filter atiendeya-mcp build
```

Genera `apps/mcp-server/dist/main.js`.

## Configurar en Claude Code

```bash
claude mcp add atiendeya \
  --env COMMERCE_API_KEY=npk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  -- npx atiendeya-mcp
```

O agregando a mano en `.mcp.json` (raíz del proyecto o `~/.claude.json`):

```json
{
  "mcpServers": {
    "atiendeya": {
      "command": "npx",
      "args": ["atiendeya-mcp"],
      "env": {
        "COMMERCE_API_KEY": "npk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## Configurar en Claude Desktop

En `claude_desktop_config.json` (menú Claude → Settings → Developer → Edit
Config):

```json
{
  "mcpServers": {
    "atiendeya": {
      "command": "npx",
      "args": ["atiendeya-mcp"],
      "env": {
        "COMMERCE_API_KEY": "npk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## Cualquier otro agente / cliente MCP

Cualquier host que hable el protocolo MCP por stdio sirve: lanzar
`npx atiendeya-mcp` (o `node apps/mcp-server/dist/main.js` desde el repo) con
`COMMERCE_API_KEY` en el entorno del proceso. No hay nada específico de
Claude en el servidor — es un `McpServer` estándar del SDK oficial
(`@modelcontextprotocol/sdk`).

## Qué cubre

Una tool por endpoint de negocio: catálogo, clientes, cotizaciones, pedidos,
pagos, envío, pricing, reportes, notificaciones, integraciones, uso,
conversaciones/WhatsApp y auditoría — más, si la key es global, administración
de plataforma (`super_admin_*`: empresas, membresías, invitaciones, keys de
tenant y keys globales). Ver `src/registry/` — un archivo por dominio, cada
uno una lista declarativa de rutas (`RouteDef`, ver `src/registry/types.ts`)
que `src/tools.ts` convierte en tools MCP genéricamente. Las pocas rutas que
no son JSON puro (fotos de catálogo, PDF de cotización) están registradas a
mano en `src/registry/catalog-images.ts` y `src/registry/binary-downloads.ts`.

Quedan fuera a propósito: endpoints `public/*` (usan token de link
compartido, no API key), onboarding/QR de Evolution y rotación de webhook
secret (operativos, de una sola vez, mejor desde el panel), e impersonar
(mecanismo de cookie de sesión de navegador — una key global +
`COMMERCE_TENANT_ID` logra lo mismo sin necesitarlo).

## Desarrollo

```bash
pnpm --filter atiendeya-mcp dev     # tsx, sin build previo
pnpm --filter atiendeya-mcp typecheck
pnpm --filter atiendeya-mcp lint
```

Para probar interactivamente sin un cliente MCP completo, usa el
[MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector):

```bash
npx @modelcontextprotocol/inspector node apps/mcp-server/dist/main.js
```

## Publicar una versión nueva en npm

```bash
cd apps/mcp-server
pnpm build
npm version patch   # o minor/major
npm publish
```

Requiere 2FA en la cuenta npm (no un token con bypass-2FA — npm los está
restringiendo para publish directo): `npm publish` pide el código OTP en el
momento.
