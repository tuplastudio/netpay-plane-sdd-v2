# Configuración de Evolution API

Guía práctica para conectar una instancia propia de Evolution API a `commerce-api`.
Complementa la especificación funcional en [`10-wha.md`](10-wha.md); este documento
es operativo, no normativo.

## Estado actual de la integración

Antes de configurar nada, ten en cuenta el estado real del código (T-WHA-03,
pendiente en el backlog):

- `POST /whatsapp/connect` únicamente guarda tus credenciales en la base de
  datos (tabla `WhatsAppConnection`). No crea la instancia en Evolution, no
  genera el QR ni registra el webhook por ti.
- El envío de mensajes (`sendText`) sí está implementado y funciona contra la
  API real de Evolution.
- El webhook de entrada (`/whatsapp/webhook/inbound/:tenantSlug`) espera un
  payload propio simplificado, **distinto** del payload nativo que Evolution
  envía (`messages.upsert`). Sin un adaptador, los mensajes entrantes no se
  procesan correctamente.
- El webhook de entrada no verifica firma ni secreto todavía. No lo expongas
  a Internet sin agregar esa protección primero.
- Las variables `EVOLUTION_BASE_URL` y `EVOLUTION_API_KEY_REF` en `.env`
  **no se usan** en el código: la configuración real vive por conexión, en
  la base de datos, vía el endpoint `/whatsapp/connect`.

## 1. Datos que necesitas de tu instancia de Evolution

- **Base URL** de tu instancia (ej. `https://evolution.tu-dominio.com`).
- **API key** (apikey) configurada en esa instancia.
- **Nombre de la instancia** (`instance`) que vas a usar dentro de Evolution.

## 2. Registrar la conexión en commerce-api

Con sesión iniciada como owner/admin del tenant, llama:

```bash
curl -X POST http://localhost:4000/api/v1/whatsapp/connect \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "provider": "EVOLUTION",
    "phoneNumber": "+52155XXXXXXXX",
    "credentials": {
      "baseUrl": "https://evolution.tu-dominio.com",
      "apiKey": "TU_API_KEY",
      "instance": "tu-instancia"
    }
  }'
```

Esto deja la conexión en estado `ACTIVE` en la base de datos y habilita el
envío de mensajes salientes (`POST {baseUrl}/message/sendText/{instance}`,
con header `apikey: {apiKey}`).

## 3. Configurar el webhook en Evolution API

commerce-api **no registra el webhook por ti**. Debes configurarlo tú mismo
en tu instancia de Evolution, apuntando a:

```
https://<tu-commerce-api-publico>/api/v1/whatsapp/webhook/inbound/{tenantSlug}
```

Donde `{tenantSlug}` es el slug de tu tenant (ej. `demo`).

Cómo se configura depende de tu versión de Evolution API; normalmente es
uno de:

- Un endpoint propio de Evolution, por ejemplo:
  ```bash
  curl -X POST https://evolution.tu-dominio.com/webhook/set/tu-instancia \
    -H "apikey: TU_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "url": "https://<tu-commerce-api-publico>/api/v1/whatsapp/webhook/inbound/demo",
      "events": ["MESSAGES_UPSERT"]
    }'
  ```
- O el panel/dashboard de tu instancia, si lo tiene habilitado.

Consulta la documentación de la versión específica de Evolution que tengas
instalada; el nombre exacto del endpoint y el formato del body varían entre
versiones.

## 4. Adaptar el payload de entrada (pendiente)

Evolution envía algo como:

```json
{
  "event": "messages.upsert",
  "instance": "tu-instancia",
  "data": {
    "key": { "remoteJid": "521...@s.whatsapp.net", "id": "ABC123" },
    "message": { "conversation": "hola" },
    "pushName": "Cliente"
  }
}
```

Pero `whatsapp.controller.ts` (`inboundWebhook`) espera:

```json
{
  "connectionId": "...",
  "provider": "EVOLUTION",
  "externalPhone": "521...",
  "body": "hola",
  "externalId": "ABC123"
}
```

Hasta que se implemente este mapeo (extraer `data.key.remoteJid` →
`externalPhone`, `data.message.conversation` → `body`,
`data.key.id` → `externalId`), los mensajes entrantes reales de Evolution
no llegarán en el formato correcto y no se procesarán.

## 5. Seguridad del webhook (pendiente)

El endpoint de entrada no valida firma ni secreto compartido. Antes de
exponerlo en producción:

- Agrega verificación de un secreto (header o query param) que solo tú y tu
  instancia de Evolution conozcan.
- Considera restringir por IP de origen si tu instancia de Evolution tiene
  IP fija.

## Resumen de endpoints relevantes

| Acción | Endpoint |
| --- | --- |
| Registrar conexión / credenciales | `POST /api/v1/whatsapp/connect` |
| Enviar mensaje saliente | `POST /api/v1/whatsapp/send` |
| Webhook de entrada (configúralo en Evolution) | `POST /api/v1/whatsapp/webhook/inbound/:tenantSlug` |
| Desconectar | `POST /api/v1/whatsapp/:id/disconnect` |
