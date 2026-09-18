# Pendientes — sesión 16-17 Sep 2026

Estado al cierre del 17 Sep 2026. Los tres issues abiertos quedaron
resueltos en código y verificados en local (stack completo: web 3000 →
commerce-api → dummy-gateway, y alta real contra Evolution 2.3.7). Lo que
queda es **desplegar y fijar variables en el droplet y en Vercel**
(ver "Qué falta en producción" al final).

---

## A. Checkout público — `/pay/*` en Vercel ✅ resuelto en código

**Causa**: Vercel no invocaba `middleware.ts` para `/pay/*` (servía el 404
pre-generado de Next antes de llegar al middleware) por más que el `matcher`
lo incluyera. Además el bloque del middleware armaba el destino sin `/api/v1`
(`${API_INTERNAL_URL}/payments/dummy-proxy/...`), así que aunque hubiera
corrido habría dado 404 en el API.

**Fix**:

- `apps/web/src/app/pay/[[...path]]/route.ts`: route handler real del App
  Router (no depende del matcher). Reenvía `GET/HEAD/POST /pay/<resto>` a
  `${API_INTERNAL_URL}/api/v1/payments/dummy-proxy/<resto>`.
- `apps/web/src/middleware.ts`: vuelve al matcher regex original (el
  matcher reducido de la sesión anterior había dejado sin protección las
  rutas con sesión y sin redirect `/`). El bloque `/pay` desaparece.
- `apps/dummy-gateway/src/hosted-page.ts`: la página hosted arma sus
  llamadas **relativas al prefijo** desde el que se sirve (`BASE =
  location.pathname` sin `/checkout/<id>/hosted`). Antes hacía
  `fetch('/checkout/sessions/…')` absoluto, que detrás de `/pay` caía en
  el 404 del web. Esto era un segundo bloqueador que no estaba
  documentado.
- `apps/commerce-api/src/payments/payment.controller.ts`: el proxy
  `dummy-proxy/**` ya no es un proxy abierto: solo pasan
  `GET /checkout/<id>/hosted` y `POST /checkout/sessions/<id>/(capture|fail)`
  y **nunca inyecta la service key** (antes cualquiera podía crear sesiones
  desde Internet a través del proxy público).

**Cadena verificada en local** (`DUMMY_PUBLIC_URL=http://localhost:3000/pay`):

```
POST /orders/public/<token>/checkout → checkoutUrl = http://localhost:3000/pay/checkout/<id>/hosted
GET  /pay/checkout/<id>/hosted        → 200 HTML (route handler → API → gateway)
POST /pay/checkout/sessions/<id>/capture {paymentMethod:"SPEI"} → 200
webhook gateway → API_SELF_URL/api/v1/payments/webhook → pedido PAID, sesión CAPTURED con paymentMethod=SPEI
GET  /pay/healthz, POST /pay/checkout/sessions → 404 (fuera de la allowlist)
```

Variables en producción: `DUMMY_PUBLIC_URL=https://easysell.web.tupla.dev/pay`
en el `.env` del droplet (commerce-api). En Vercel `API_INTERNAL_URL` ya
apunta al API; no hace falta nada más.

---

## B. OpenRouter 401 "User not found" 🟡 requiere cambiar la key en prod

La key que aparecía en el error (`sk-or-v1-fc05…`) está revocada. La key del
`.env` local (`sk-or-v1-18c1…`) se verificó contra
`GET https://openrouter.ai/api/v1/auth/key`: activa, sin límite, uso
mensual $15.66.

**Fix (sin código)**: en el droplet, `OPENROUTER_KEY_REF=sk-or-v1-18c1…`
en el `.env` de agent-v2 y recrear el contenedor. Si el tenant tiene una
key propia en `/agent → Configuración`, borrarla o sustituirla por una
válida: agent-v2 ya degrada al modelo/key de plataforma cuando la del
tenant falla, pero si la de plataforma también es la revocada no hay a qué
degradar y responde con `_FALLBACK_REPLY`.

---

## C. Refetch cada 3 s en el checkout público ✅

`apps/web/src/app/checkout/[token]/page.tsx`: cero polling en
`CHECKOUT_OPEN`; 10 s solo en `AWAITING_PAYMENT` (después del click en
"Pagar"). Mensajes de error del botón "Pagar ahora" ahora distinguen link
inválido (404), pedido que ya no acepta pagos (400), rate limit (429) y
pasarela caída.

---

## D. Métodos de pago (nuevo, pedido en esta sesión) ✅

El gateway simula **CARD, SPEI y OXXO**:

- Página hosted con selector (tabs). SPEI muestra CLABE `646180…`,
  beneficiario, concepto e importe; OXXO muestra referencia de 14 dígitos,
  comisión y vencimiento. Ambos se "confirman" con un botón (sandbox).
- `POST /checkout/sessions` acepta `paymentMethods: ["CARD","SPEI"]`
  (default: los tres); la captura rechaza un método no habilitado
  (`RULE_VIOLATION`) o desconocido (`VALIDATION_FAILED`).
- El webhook lleva `paymentMethod` y `paymentReference`; commerce-api lo
  persiste en `CheckoutSession.paymentMethod` (**migración
  `0011_checkout_session_payment_method.sql`**) y lo nombra en el ledger
  ("Transferencia SPEI ref …", "Visa •••• 4242").
- `PAYMENT_METHODS=CARD,SPEI,OXXO` en el `.env` del API acota lo que ve el
  cliente. Vacío = todos.
- `/payments` y `/payments/:id` muestran el método.
- El gateway exige la service key si arranca con `DUMMY_SERVICE_KEY_REF`
  (misma variable que manda commerce-api; antes el API leía
  `DUMMY_SERVICE_KEY`, que nadie define, y usaba siempre `npk_test_local`).

---

## E. Alta de WhatsApp en Evolution sin ngrok (nuevo) ✅

Ver `docs/evolution-api-setup.md`. Resumen:

- `provision` crea la instancia, registra el webhook en Evolution con
  `?secret=` y deja la conexión `PENDING` con el hash del secreto. Antes el
  secreto se generaba en `finalize` pero nunca se le pasaba a Evolution, así
  que todos los webhooks se rechazaban (por eso `webhookSecretHash` estaba
  en NULL a mano).
- `connection.update` con `open` activa la conexión sola (y toma el número
  del `wuid`); `close` + 401 la marca `ERROR`. `finalize` sigue existiendo y
  es idempotente.
- `connect` manual (credenciales) también registra el webhook.
- `PATCH /whatsapp/:id/webhook-url` reapunta la instancia en Evolution.
- La URL base sale de **`API_PUBLIC_URL`** (nuevo; prod:
  `https://api-easysell.tupla.dev`) → `PUBLIC_BASE_URL` → localhost. El
  `.env` local ya no apunta a ngrok.

Verificado contra `https://esca-evolution.lab.esca.dev` (v2.3.7): instancia
creada, `GET /webhook/find/<instancia>` devuelve la URL con secreto y los
eventos `MESSAGES_UPSERT, CONNECTION_UPDATE`; un `connection.update` `open`
firmado activa la fila; sin secreto se rechaza; la instancia de prueba se
borró después.

---

## Producción (18 Sep 2026, 02:05 UTC) ✅ desplegado y verificado

- **Backend**: GitHub Actions `deploy-backend.yml` (compose.prod + `.env.prod`
  en `/opt/netpay-build`) corrió con `44f767f`, `11dfe86`, `568b755` y
  `feea731`. Stack completo arriba: commerce-api, dummy-gateway,
  commerce-worker, agent-v2, agent-service, web. Env verificado en el
  contenedor: `PUBLIC_BASE_URL=https://easysell.web.tupla.dev`,
  `API_SELF_URL=http://commerce-api:4000` (antes `http://<ip>:13000`, el
  webhook de pagos no llegaba), `DUMMY_PUBLIC_URL=…/pay`.
- **Neon**: aplicadas a mano `0010` (faltaba: `/customers` daba 500 por
  `CustomerConsent.note`) y `0011`. El paso `prisma migrate deploy` del
  workflow es un no-op con migraciones SQL planas.
- **Web**: los pushes a `main` generan deployments **preview** en Vercel
  (target=preview); el dominio siguió sirviendo un deploy viejo hasta correr
  `vercel deploy --prod --yes` **desde la raíz del repo** (rootDirectory es
  `apps/web`; desde `apps/web` falla). Para que el push a `main` sea
  producción: Vercel → Settings → Git → Production Branch = `main`.
- **Bug extra corregido**: el 201 de `POST /orders/public/:token/checkout`
  llegaba sin cuerpo a través de Vercel porque traía `Location`; "Pagar
  ahora" fallaba en prod. Quitado en API y filtrado en el middleware.
- **Evolution**: `POST /whatsapp/connect` re-registró el webhook de
  `easysell_demo-store_663r2w` con `?secret=`; `webhookSecretHash` ya no es
  NULL; un `connection.update` firmado activa y uno sin secreto se rechaza.
- **Flujo verificado en prod**: quick-charge → `/checkout/<token>` →
  `POST …/checkout` (JSON con `checkoutUrl` bajo `/pay`) → hosted 200 con
  selector de métodos → captura SPEI vía `/pay` → pedido `PAID`, sesión
  `CAPTURED` con `paymentMethod=SPEI`, ledger "Transferencia SPEI ref …".
- Pendiente de configuración (no bloquea): `.env.prod` no define
  `EVOLUTION_BASE_URL`/`EVOLUTION_API_KEY_REF` (compose.prod ya los pasa);
  sin ellos el alta de un tenant nuevo desde `/channels` responde
  "Evolution no está configurado". `OPENROUTER_KEY_REF` de `.env.prod`
  empieza por `sk-or-v1-p…`: verificar en https://openrouter.ai/keys que sea
  la activa (la del `.env` local `18c1…` sí lo está).

## Pendiente menor

- El alias `easysell.web.tupla.dev → netpay-plane-sdd-v2-*` cambia con cada
  deploy; si Vercel tarda en propagar, verificar con `vercel alias ls`.
- `tests/super-admin.test.ts` falla en local desde antes de esta sesión
  (`this.prisma.tenant.count is not a function`, fake de Prisma sin `count`).
  No está relacionado con estos cambios.
