# @cgalaviz/easysell-mcp — MCP de Easy Sell

Servidor [MCP](https://modelcontextprotocol.io) que expone la API de Easy Sell
(commerce-api: catálogo, clientes, cotizaciones, pedidos, pagos, envíos,
reportes, notificaciones, integraciones, uso, conversaciones de WhatsApp,
auditoría y, con una key global, administración de plataforma) como
herramientas para Claude o cualquier agente compatible con MCP.

Corre por **stdio** — el cliente (Claude Desktop, Claude Code, cualquier host
MCP) lo lanza como proceso local. No expone ningún puerto ni requiere
desplegarlo aparte. Publicado en npm como `@cgalaviz/easysell-mcp` (el bin se
llama `easysell-mcp`).

## Instalar y correr

```bash
npx @cgalaviz/easysell-mcp
```

(o instalado globalmente: `npm install -g @cgalaviz/easysell-mcp` y luego
`easysell-mcp`). Necesita `COMMERCE_API_KEY` en el entorno — ver **Autenticación**
abajo. Sin ella, el proceso falla al arrancar con un mensaje explicando qué
falta, no con un error de red genérico en la primera tool que se intente usar.

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
pnpm --filter @cgalaviz/easysell-mcp build
```

Genera `apps/mcp-server/dist/main.js`.

## Configurar en Claude Code

```bash
claude mcp add easysell \
  --env COMMERCE_API_KEY=npk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  -- npx @cgalaviz/easysell-mcp
```

O agregando a mano en `.mcp.json` (raíz del proyecto o `~/.claude.json`):

```json
{
  "mcpServers": {
    "easysell": {
      "command": "npx",
      "args": ["@cgalaviz/easysell-mcp"],
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
    "easysell": {
      "command": "npx",
      "args": ["@cgalaviz/easysell-mcp"],
      "env": {
        "COMMERCE_API_KEY": "npk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## Cualquier otro agente / cliente MCP

Cualquier host que hable el protocolo MCP por stdio sirve: lanzar
`npx @cgalaviz/easysell-mcp` (o `node apps/mcp-server/dist/main.js` desde el
repo) con `COMMERCE_API_KEY` en el entorno del proceso. No hay nada específico
de Claude en el servidor — es un `McpServer` estándar del SDK oficial
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
pnpm --filter @cgalaviz/easysell-mcp dev     # tsx, sin build previo
pnpm --filter @cgalaviz/easysell-mcp typecheck
pnpm --filter @cgalaviz/easysell-mcp lint
```

Para probar interactivamente sin un cliente MCP completo, usa el
[MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector):

```bash
npx @modelcontextprotocol/inspector node apps/mcp-server/dist/main.js
```

## API keys — guía completa

Hay dos tipos y son cosas distintas.

### Key de tenant (la que vas a usar el 99% del tiempo)

1. **Panel** → **Empresa → API keys** → **"Crear API key"**.
2. Nombre: algo descriptivo (ej. `"MCP Claude Code local"`, `"Agente chat producción"`).
3. Scopes: **mínimo privilegio**. Para un agente de chat que cotiza, cobra y
   lee catálogo: `catalog.read`, `customers.read`, `quotes.write`, `orders.write`,
   `chat.read`, `chat.write`. Para reporting/auditoría sumá `payments.read`,
   `audit.read`. **Nunca** pongas `tenant.admin` o `apikeys.manage` salvo que la
   tool específica lo pida.
4. Sin expiración, o 90/180 días si querés rotación automática. Una key eterna
   es una fuga permanente si se filtra.
5. **La key completa (`npk_...`) se muestra UNA sola vez** al crearla. Copiala
   a un gestor de secretos del sistema (1Password CLI, macOS Keychain,
   `gpg`-encrypted file) ANTES de cerrar el modal.
6. La key queda asociada a UN tenant — si el agente debe operar varias
   empresas, necesitás una key por tenant, o una key global.

### Key global (T-IAM-09b — solo super-admin de plataforma)

Cubre TODOS los tenants sin que la API key quede atada a uno. Pensada para
soporte de plataforma y automatizaciones cross-tenant.

1. **Panel** → **Plataforma → API keys globales** → **"Crear API key global"**.
2. No hay scopes que elegir — siempre lleva todos.
3. La key se crea en la cuenta de un humano (sesión de panel); una key global
   **no puede emitir más keys globales** por sí sola (esto es por diseño).
4. Para acotar a un tenant puntual sin perder los permisos, export
   `COMMERCE_TENANT_ID=<uuid>` y el header `X-Tenant-Id` se manda solo. Sin
   esa env, la key opera sobre cualquier empresa.

### Convención operativa

- **Una key por cliente MCP / por despliegue**: Claude Desktop en la laptop
  del dueño, Claude Code en CI, el agente de chat en el contenedor del
  cliente — cada uno su propia key. Si una se filtra, revocas esa y las
  demás siguen.
- **Rotación**: cuando un empleado del cliente que tenía acceso a la key se
  va, o cada 90-180 días como política, revocá la key en el panel y emití
  una nueva. El equipo de Tupla no necesita intervenir.
- **Logs**: si tu `.mcp.json` o `claude_desktop_config.json` se sincroniza
  (iCloud, backup, dotfiles repo), se respalda o se comparte, considerá la
  key expuesta — revocala y emití una nueva.
- **Menos es más**: si la tool que vas a usar no necesita `tenant.admin` para
  funcionar (ver el README de cada tool), no le des ese scope a la key.

## Publicar una versión nueva en npm

El paquete está bajo el scope personal `@cgalaviz/` (la cuenta npm del autor).
Como ya publicaste `atiendeya-mcp` antes, la cuenta tiene historial y no
requiere pasos previos.

```bash
cd apps/mcp-server
npm login                 # user + 2FA OTP
pnpm --filter @cgalaviz/easysell-mcp build
npm version patch          # o minor/major
npm publish               # corre typecheck+lint+test+build (prepublishOnly)
```

`npm publish` exige **2FA en el momento del publish** (no un token con
bypass-2FA — npm los está restringiendo para publish directo).

### Verificar después de publicar

```bash
npm view @cgalaviz/easysell-mcp version bin engines
npx @cgalaviz/easysell-mcp < /dev/null   # arranca: "140 tools registradas"
```

Si el publish falla con `404 Not Found - PUT`, lo más probable es que la
sesión de npm haya expirado o que el usuario autenticado no sea `cgalaviz` —
verificá con `npm whoami` y `npm login` de nuevo si hace falta.
