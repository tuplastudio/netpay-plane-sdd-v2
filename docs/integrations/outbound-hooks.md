# Hooks salientes (webhooks REST y servidores MCP)

Easy Sell avisa a tus sistemas cuando termina una acción de negocio: se creó
un pedido, se acreditó un pago, un cliente pidió hablar con una persona…
Cada aviso es una **entrega** a un **hook** que configuras por empresa en
*Administración → Hooks salientes* (o por API en `/api/v1/hooks`).

Un hook puede ser:

- **REST**: un `POST` JSON firmado a tu endpoint.
- **MCP**: una llamada `tools/call` a una herramienta de tu servidor MCP
  (Streamable HTTP), con los argumentos armados a partir del evento.

## Eventos

| Evento | Cuándo se emite | `data` |
| --- | --- | --- |
| `order.created` | Se creó un pedido (directo, cobro rápido o desde una cotización aceptada). | `orderId, status, source, quoteId, customerId, description, subtotal, discount, tax, shipping, total, currency, createdAt, paidAt` |
| `order.paid` | La pasarela confirmó el cobro y el pedido pasó a `PAID`. | igual que `order.created`, con `status: "PAID"` y `paidAt` |
| `quote.issued` | Una cotización pasó de borrador a emitida. | `quoteId, status, customerId, subtotal, discount, tax, shipping, total, currency, issuedAt, acceptedAt, expiresAt` |
| `quote.accepted` | El cliente o un vendedor aceptó la cotización. | igual que `quote.issued`, con `status: "ACCEPTED"` |
| `payment.succeeded` | La pasarela capturó un cobro. `orderPaid` dice si el pedido pasó a `PAID` (puede ser `false` si el pedido ya estaba cancelado/vencido: cobro huérfano, hay que reembolsar). | `sessionId, orderId, amount, currency, status, paymentMethod, orderPaid, capturedAt` |
| `payment.failed` | Un intento de cobro falló. | `sessionId, orderId, amount, currency, status, paymentMethod, failedAt` |
| `customer.created` | Se dio de alta un cliente (panel/API → `source: "panel"`; primer mensaje por WhatsApp → `source: "whatsapp"`). | `customerId, fullName, email, phone, source, createdAt` |
| `conversation.handoff` | Una conversación pasó a atención humana: el agente escaló (`source: "agent"`) o una persona la tomó/asignó (`source: "human"`). | `conversationId, customerId, assignedUserId, source, handoffAt` |
| `product.updated` | Se editó un producto (`variantId: null`) o una variante (precio, existencias, estado…). | `productId, variantId, sku, title, status, price, currency, stock, version, updatedAt` |
| `ping` | Lo manda el botón **Probar**. No se puede suscribir. | `message: "pong", hookId` |

`GET /api/v1/hooks/events` devuelve este catálogo con un ejemplo completo de
cada payload. Los importes van como cadena con dos decimales (`"1160.00"`).

## Payload

Toda entrega lleva el mismo sobre:

```json
{
  "id": "2f1e0d9c-8b7a-4695-8f4e-3d2c1b0a9f8e",
  "event": "order.paid",
  "occurredAt": "2026-01-15T17:20:00.000Z",
  "tenantId": "00000000-0000-4000-8000-000000000000",
  "data": { "orderId": "5f0c2a1e-…", "status": "PAID", "total": "1160.00", "currency": "MXN" },
  "version": 1
}
```

- `id` identifica el **evento**: si el mismo evento va a dos hooks, o se
  reintenta, el `id` no cambia. Úsalo para deduplicar.
- `version` es la versión del contrato del sobre (hoy `1`).
- No se mandan tokens, hashes ni datos fiscales completos. `customer.created`
  incluye nombre, correo y teléfono porque son el contenido del evento.

### Headers de una entrega REST

| Header | Contenido |
| --- | --- |
| `Content-Type` | `application/json` |
| `User-Agent` | `EasySell-Hooks/1.0` |
| `X-EasySell-Event` | nombre del evento (`order.paid`) |
| `X-EasySell-Event-Id` | `id` del evento |
| `X-EasySell-Delivery` | id de la entrega (cambia en cada reintento) |
| `X-EasySell-Attempt` | número de intento (1, 2, 3…) |
| `X-EasySell-Signature` | `t=<unix seconds>,v1=<hex>` (ver abajo) |
| `Authorization` / header propio | según la autenticación configurada |
| los que agregues en «Headers extra» | tal cual |

Responde **2xx** (cualquier cuerpo) en menos de **10 s**. Cualquier otra cosa
—3xx incluidos: no se siguen redirecciones— cuenta como fallo y se reintenta.

## Autenticación

Además de la firma (siempre presente), cada hook puede llevar:

| Método | Qué se manda |
| --- | --- |
| `NONE` / `HMAC` | nada más que la firma |
| `BEARER` | `Authorization: Bearer <token>` |
| `API_KEY_HEADER` | `<Nombre del header>: <api key>` (por defecto `X-API-Key`) |
| `BASIC` | `Authorization: Basic base64(usuario:contraseña)` |

La credencial se guarda cifrada (AES-256-GCM con la clave de
`TOKEN_ENCRYPTION_KEY_REF`) y no se vuelve a mostrar.

## Verificación de la firma

`X-EasySell-Signature: t=1700000000,v1=dab1055a…`

- `t`: marca de tiempo Unix (segundos) de cuando se firmó.
- `v1`: `HMAC-SHA256(secreto, "<t>.<cuerpo crudo>")` en hexadecimal.

El **secreto de firma** (`whsec_…`) se muestra una sola vez al crear el hook
(o al rotarlo). Para verificar:

1. Toma el cuerpo **crudo** de la petición (bytes tal cual, sin re-serializar).
2. Recalcula `HMAC-SHA256(secreto, t + "." + cuerpo)`.
3. Compara con `v1` en tiempo constante.
4. Rechaza si `|ahora − t|` supera tu tolerancia (recomendado: 5 minutos).

Vector de prueba (el mismo que fija `tests/outbound-hook-signature.test.ts`):

```
secreto : whsec_test_secret
t       : 1700000000
cuerpo  : {"id":"evt-1","event":"ping","occurredAt":"2026-01-15T17:05:00.000Z","tenantId":"t-1","data":{"message":"pong"},"version":1}
v1      : dab1055a077a7520b8691f229b830e7e93aa3fc21ba7379fc1f1408feb932146
```

### Node.js (Express)

```js
import crypto from "node:crypto";
import express from "express";

const SECRET = process.env.EASYSELL_HOOK_SECRET; // whsec_…
const TOLERANCE_S = 300;

function verify(header, rawBody) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > TOLERANCE_S) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const app = express();
// El cuerpo tiene que llegar crudo: nada de express.json() antes de verificar.
app.post("/webhooks/easysell", express.raw({ type: "application/json" }), (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verify(req.get("x-easysell-signature") ?? "", raw)) return res.status(401).end();
  const event = JSON.parse(raw);
  // Idempotencia: guarda event.id y descarta repetidos.
  console.log(event.event, event.data);
  res.status(204).end();
});
```

### Python (FastAPI)

```python
import hmac, hashlib, time
from fastapi import FastAPI, Request, HTTPException

SECRET = b"whsec_..."
TOLERANCE_S = 300
app = FastAPI()

def verify(header: str, raw_body: bytes) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    try:
        t = int(parts["t"])
        given = parts["v1"]
    except (KeyError, ValueError):
        return False
    if abs(int(time.time()) - t) > TOLERANCE_S:
        return False
    expected = hmac.new(SECRET, f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, given)

@app.post("/webhooks/easysell")
async def easysell_hook(request: Request):
    raw = await request.body()
    if not verify(request.headers.get("x-easysell-signature", ""), raw):
        raise HTTPException(status_code=401)
    event = await request.json()
    # Idempotencia: guarda event["id"] y descarta repetidos.
    return {"ok": True}
```

## Hooks MCP

Para un hook de tipo **MCP** la plataforma actúa como cliente Streamable HTTP
contra la URL configurada:

1. `initialize` (se conserva `Mcp-Session-Id` si el servidor lo devuelve),
2. `notifications/initialized`,
3. `tools/call` con `name = <Nombre de la herramienta>` y `arguments` = la
   plantilla resuelta.

Cada petición lleva los mismos headers de autenticación/firma que un hook REST
(la firma es sobre el cuerpo JSON-RPC de esa petición). Se aceptan respuestas
JSON o `text/event-stream`. Un `error` JSON-RPC o un resultado con
`isError: true` cuentan como fallo y se reintentan.

### Plantilla de argumentos

JSON con placeholders `{{ruta}}` sobre `{ event: <sobre>, data: <sobre.data> }`:

```json
{
  "orderId": "{{event.data.orderId}}",
  "total": "{{data.total}}",
  "lineas": "{{data.lines}}",
  "nota": "Pedido {{data.orderId}} pagado el {{event.occurredAt}}"
}
```

- Un placeholder que ocupa toda la cadena conserva el tipo del valor (número,
  objeto, arreglo, `null`).
- Dentro de texto se interpola; los objetos se serializan en JSON.
- Ruta inexistente → `null` (exacto) o `""` (interpolado).
- Sin plantilla se manda `{ "event": <sobre> }`.

## Reintentos

Cada hook tiene `{ maxAttempts, backoffSeconds }` (por defecto 5 y 30). Tras
un fallo la entrega espera `backoffSeconds · 2^(intento−1)` segundos (tope 1 h):
con 30 s → 30 s, 60 s, 120 s, 240 s. Agotados los intentos la entrega queda
**agotada** (`DEAD`) y solo se reenvía a mano con **Reintentar** (un intento
más, ahora).

Estados de una entrega: `PENDING` (en cola) → `SUCCESS` | `FAILED` (volverá a
intentar en `nextAttemptAt`) | `DEAD`.

El despachador corre dentro de `commerce-api` cada 5 s, toma como mucho 25
entregas por pasada con un lock optimista (varias instancias del API pueden
correrlo a la vez sin duplicar envíos) y respeta un timeout de 10 s por
petición. `OUTBOUND_HOOKS_DISPATCHER=off` apaga el barrido en una instancia
concreta (las entregas se siguen encolando).

Un hook **pausado** no recibe entregas nuevas y sus pendientes se marcan
agotadas con «Hook deshabilitado»; al reactivarlo puedes reintentarlas.

## Seguridad

- La URL de destino tiene que ser pública: se rechazan IPs privadas,
  loopback, link-local, metadata de nube y dominios internos, con resolución
  DNS justo antes de cada envío (misma guardia que las integraciones).
- No se siguen redirecciones.
- Secretos y credenciales cifrados en reposo; nunca salen por el API.
- Toda acción del panel (crear, editar, borrar, probar, rotar, reintentar)
  queda en `AuditLog` con acciones `hook.*`.

## API

| Método | Ruta | Scope |
| --- | --- | --- |
| `GET` | `/api/v1/hooks` | `integrations.read` |
| `POST` | `/api/v1/hooks` | `integrations.write` — responde `{ hook, signingSecret }` |
| `GET` | `/api/v1/hooks/events` | `integrations.read` |
| `GET` | `/api/v1/hooks/:id` | `integrations.read` |
| `PATCH` | `/api/v1/hooks/:id` | `integrations.write` |
| `DELETE` | `/api/v1/hooks/:id` | `integrations.write` |
| `POST` | `/api/v1/hooks/:id/test` | `integrations.write` — manda `ping` y devuelve la entrega |
| `POST` | `/api/v1/hooks/:id/rotate-secret` | `integrations.write` — `{ signingSecret }` |
| `GET` | `/api/v1/hooks/:id/deliveries?status&cursor&limit` | `integrations.read` |
| `GET` | `/api/v1/hooks/deliveries/:id` | `integrations.read` — payload y respuesta completos |
| `POST` | `/api/v1/hooks/deliveries/:id/retry` | `integrations.write` |

Cuerpo de `POST /hooks`:

```json
{
  "name": "ERP",
  "kind": "REST",
  "targetUrl": "https://api.tu-empresa.com/webhooks/easysell",
  "authType": "BEARER",
  "credential": "token-secreto",
  "events": ["order.created", "order.paid"],
  "headers": { "X-Source": "easysell" },
  "retryPolicy": { "maxAttempts": 5, "backoffSeconds": 30 }
}
```

Para MCP agrega `"kind": "MCP"`, `"toolName": "registrar_pedido"` y, opcional,
`"argsTemplate": { … }`.
