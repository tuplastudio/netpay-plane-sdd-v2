# Configuración de Evolution API

Guía operativa para conectar WhatsApp vía Evolution API (Baileys) a
`commerce-api`. Complementa la especificación funcional en [`10-wha.md`](10-wha.md).

## Cómo funciona hoy (alta automática desde el portal)

Desde **/channels → Conectar → Evolution** el operador solo escribe (opcional)
el número y pulsa "Generar QR". El backend hace todo lo demás:

1. `POST /whatsapp/evolution/provision` crea la instancia
   `easysell_<tenant>_<sufijo>` en Evolution (`WHATSAPP-BAILEYS`, con QR).
2. Genera un **secreto de webhook**, lo guarda hasheado (argon2) en
   `WhatsAppConnection.webhookSecretHash` y registra en Evolution
   (`POST /webhook/set/{instance}`) la URL:

   ```
   {API_PUBLIC_URL}/api/v1/whatsapp/webhook/inbound/{tenantSlug}?secret=<secreto>
   ```

   con los eventos `MESSAGES_UPSERT` y `CONNECTION_UPDATE`.
3. La fila `WhatsAppConnection` queda `PENDING` con las credenciales
   (`baseUrl`, `apiKey`, `instance`) y el portal muestra el QR.
4. Cuando el cliente escanea, Evolution manda `connection.update` con
   `state: open`. El webhook (ya autenticado por el secreto) pone la conexión
   en `ACTIVE` y toma el número real del `wuid`. El portal, que también hace
   polling del estado, llama `POST /whatsapp/evolution/finalize/:instance`;
   ambos caminos son idempotentes.
5. A partir de ahí los `messages.upsert` (texto, audio, imagen) entran por el
   mismo webhook y el agente responde por `POST {baseUrl}/message/sendText/{instance}`.

Si el teléfono desvincula el dispositivo (`connection.update` con `close` y
`statusReason: 401`) la conexión pasa a `ERROR` con el motivo visible en la
tabla de canales; basta con repetir el alta.

**No hace falta ngrok ni tocar el panel de Evolution.** La URL registrada es
el dominio estable del API.

## Variables de entorno del API

| Variable | Qué es | Ejemplo prod |
| --- | --- | --- |
| `EVOLUTION_BASE_URL` | Instancia de Evolution de la plataforma (se usa si el tenant no trae la suya) | `https://esca-evolution.lab.esca.dev` |
| `EVOLUTION_API_KEY_REF` | API key global de esa instancia | `…` |
| `API_PUBLIC_URL` | Origen público del API. Evolution registra el webhook contra él. Si va vacío se usa `PUBLIC_BASE_URL` (el web reescribe `/api/v1/*` al API) | `https://api-easysell.tupla.dev` |
| `PUBLIC_BASE_URL` | Origen público del frontend (enlaces de cotización/pago) | `https://easysell.web.tupla.dev` |

Sin `EVOLUTION_BASE_URL`/`EVOLUTION_API_KEY_REF` el alta responde
`EVOLUTION_API_ERROR` (412) "Evolution no está configurado".

## Alta manual (instancia ya existente)

Si la instancia ya existe en Evolution, `POST /whatsapp/connect` con
`provider: "EVOLUTION"` y `credentials: { baseUrl, apiKey, instance }` guarda
las credenciales **y registra el webhook** en esa instancia con un secreto
nuevo (se devuelve en claro solo en esa respuesta como `webhookSecret`). Si
Evolution rechaza el registro, la conexión se guarda igual y `lastError`
explica por qué.

```bash
curl -X POST https://api-easysell.tupla.dev/api/v1/whatsapp/connect \
  -H "Content-Type: application/json" -b cookies.txt \
  -d '{"provider":"EVOLUTION","phoneNumber":"+52155XXXXXXXX",
       "credentials":{"baseUrl":"https://evolution.tu-dominio.com","apiKey":"TU_API_KEY","instance":"tu-instancia"}}'
```

## Cambiar la URL del webhook

`PATCH /whatsapp/:id/webhook-url` con `{ "webhookUrl": "https://…?secret=…" }`
guarda la URL y la reapunta en Evolution (conserva el secreto actual). Para
rotar el secreto: `POST /whatsapp/:id/rotate-webhook-secret` y después el
PATCH con la URL nueva.

## Seguridad del webhook

- El webhook exige el secreto en `?secret=` o en el header `x-webhook-secret`
  para cualquier payload nativo de Evolution. Sin secreto válido responde
  `{ ok: false, reason: "secreto de webhook inválido o ausente" }` y no procesa nada.
- El formato legacy (`{ connectionId, externalPhone, body }`) sigue existiendo
  para pruebas con curl; requiere conocer el `connectionId`.
- Los ecos de mensajes propios (`key.fromMe`) y los eventos sin texto se
  confirman con `ignored: true` sin tocar el agente.

## Resumen de endpoints

| Acción | Endpoint |
| --- | --- |
| Alta automática (instancia + QR + webhook) | `POST /api/v1/whatsapp/evolution/provision` |
| QR fresco / estado | `GET /api/v1/whatsapp/evolution/qr/:instance`, `GET …/state/:instance` |
| Confirmar alta (idempotente con la automática) | `POST /api/v1/whatsapp/evolution/finalize/:instance` |
| Borrar instancia (cancelar alta) | `DELETE /api/v1/whatsapp/evolution/instance/:instance` |
| Alta manual con credenciales | `POST /api/v1/whatsapp/connect` |
| Webhook que llama Evolution | `POST /api/v1/whatsapp/webhook/inbound/:tenantSlug?secret=…` |
| Enviar mensaje saliente | `POST /api/v1/whatsapp/send` |
| Desconectar | `POST /api/v1/whatsapp/:id/disconnect` |
