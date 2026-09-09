# Contratos canónicos REST, comandos internos y eventos V2

Este documento define los contratos a convertir en OpenAPI/JSON Schema en T-FND-02. No son endpoints ya construidos. Las rutas externas Meta/Evolution/OpenRouter no se inventan aquí: sus adapters se fijan contra el proveedor. Dummy tiene API propia en SPEC-PAY.

## 1. Reglas comunes

Base portal/integración `/api/v1`; todas las rutas de tablas se concatenan a esa base salvo `/public`, `/webhooks` y `/internal` que también viven bajo `/api/v1` con guardias diferentes. Métodos mutantes JSON requieren Content-Type application/json; raw webhook se conserva antes de parseo.

`H` sesión humana, `K` API key, `S` servicio interno, `P` capability/sesión comprador, `V` proveedor. Scope indicado además de auth. `I` requiere Idempotency-Key string 8–128; `C` requiere If-Match con lockVersion decimal como ETag entre comillas. Comandos con ambas propiedades usan ambas. Mutación replay devuelve misma representación con `Idempotent-Replayed:true`, o status original si está pendiente. 202 siempre incluye statusUrl.

DTOs strict: campo no listado se rechaza. Campos con `?` opcionales; para PATCH omitir preserva, null limpia solo si declarado nullable en esquema. Nunca permitir campos de servidor tenantId/status/total/createdBy en requests salvo comandos explícitos que lo requieran. IDs UUID reales; `example` en ejemplos no es UUID ejecutable y debe sustituirse por fixture ID válido en generación de contrato.

Listas admiten limit1–100 default25, cursor opaco y filtros listados; fechas ISO. Cursor incluye tenant/filtros/order y se firma; cambiar filtros requiere cursor nuevo. No permitir sort SQL libre. Tests de contrato de todos los endpoints comprueban auth, scope, body válido, inválido, recurso ajeno y replay/conflicto cuando aplica; los casos no cubiertos por el AC local se agregan al test parametrizado del módulo, no se omiten. Orden default createdAt DESC,id DESC; productos usan updatedAt. List response Page<T>; objetos Resource<T> con lockVersion y allowedActions calculadas.

`Resource<T>={data:T,requestId}`; `Page<T>={data:T[],page:{nextCursor:string|null,hasMore:boolean},requestId}`; `Job={id,status,statusUrl}`; `CommandResult={resourceId,status,lockVersion}`. Respuesta exitosa de DELETE/revoke puede 204 sin body; no declarar 204 con JSON.

Errores globales de FND se suman a los particulares de tabla. 404 oculta existencia de recursos ajenos. 409 VERSION_CONFLICT incluye currentVersion permitido, no información de otra empresa. 422 errores específicos: INVALID_SAT_KEY, INVALID_QUANTITY, TOTAL_OUT_OF_RANGE, DELIVERY_UNAVAILABLE, FISCAL_INCOMPLETE. 409 PRICE_CHANGED incluye nuevo preview autorizado. 410 LINK_UNAVAILABLE solo público. 503 PROVIDER_UNAVAILABLE no equivale a pago FAILED.

## 2. Esquemas de entrada compartidos

| Schema | Campos exactos / reglas |
| --- | --- |
| AddressInput | recipient:string1..160, country:"MX", postalCode:5digits, region:string1..100, city:string1..100, locality?:string0..100, street:string1..160, exterior:string1..30, interior?:string0..30, instructions?:string0..300. |
| DeliveryInput | Discriminada: `{mode:"PICKUP",pickupLocationId:UUID}` o `{mode:"FLAT_SHIPPING",address:AddressInput}`. |
| DiscountInput | `{type:"PERCENT",value:decimal0..100}` o `{type:"FIXED",value:Money}`; no ambos. |
| QuoteLineInput | `{variantId:UUID,quantity:Quantity,discount?:DiscountInput}`. Campos de precio prohibidos en API normal. |
| FreeFormLineInput | `{description:string1..300,quantity:"1.000",totalIncluded:Money,taxProfileId:UUID,satProductServiceKey?:string,satUnitKey?:string}`; solo cobro rápido/política autorizada. |
| CustomerInput | displayName:string1..160, phone?:E164, email?:email, externalId?:string1..128, addresses?:AddressInput[] max10. |
| VariantInput | sku:string1..64, attributes:object tipado, price:Money, currency:"MXN",taxProfileId:UUID,priceIncludesTax:boolean,satProductServiceKey?:8digits,satUnitKey?:string2..3,commercialUnit:string1..30,packSize?:Quantity,quantityMin:Quantity,quantityMax:Quantity,quantityStep:Quantity,inventoryMode:"NONE"|"LOCAL"|"EXTERNAL". |
| ProductInput | name:string1..160,description?:string0..10000,type:"PRODUCT"|"SERVICE",categoryId?:UUID,brand?:string0..100,tags?:string[]max20,variants:VariantInput[]1..200,aliases?:string[]max30. |
| QuoteInput | customerId?:UUID,externalId?:string1..128,currency:"MXN",items:QuoteLineInput[]1..200,delivery:DeliveryInput,discount?:DiscountInput,validUntil:dateTime,notes?:string0..2000. |
| QuotePreview | líneas snapshot/totals/calculationVersion/previewHash/configVersion/expiresAt/missingFields; `expiresAt` del preview10min no es vigencia comercial. |
| Totals | subtotalBeforeDiscount:Money,discount:Money,taxBase:Money,tax:Money,shippingTotal:Money,grandTotal:Money,taxBreakdown:{rate:decimal,base:Money,tax:Money}[],currency:"MXN",calculationVersion:string. shippingTotal es informativo y ya incluido en grandTotal. |
| QuickChargeInput | concept:string1..300,totalIncluded:Money,taxProfileId:UUID,customerId?:UUID,expiresAt:dateTime,notes?:string0..2000. |
| SendInput | connectionId:UUID,customerId:UUID,purpose enum permitido,locale:"es_MX"; destino deriva del cliente/conexión. |
| CheckoutPrepareInput | delivery:DeliveryInput,contact:{displayName:string,phone?:E164,email?:email},expectedContentHash:string. |
| CheckoutConfirmInput | revisionId:UUID,contentHash:string,termsVersion:string,accepted:true. No input amount ni status. |
| RefundInput | amount:Money,reason:string1..500. |
| WebhookInput | url:HTTPS,events:string[]allowlist,description?:string0..200,includeLinks:boolean. |
| ExternalProductInput | externalVersion?:integer>=0,product:ProductInput,externalVariantMappings?:{sku,externalId}[]; autoridad definida por integración. |
| HumanMessageInput | localMessageId:UUID,text?:string1..8000,mediaId?:UUID,replyToMessageId?:UUID,expectedControlVersion:integer. Al menos text o mediaId. |

Money regex `^(0|[1-9][0-9]{0,15})\.[0-9]{2}$`, restricciones de importe por campo; Quantity `^(0|[1-9][0-9]{0,5})\.[0-9]{3}$`, positivo cuando representa venta. Rates porcentaje del API se convierten a factor decimal explícito. Regex no sustituye máximo total de negocio. Fechas se comparan en servidor.

## 3. Auth, configuración y clientes

| Operación | Auth/scope | Input | Output / errores específicos |
| --- | --- | --- | --- |
| POST /auth/login | Público rate limitado | email,password |200 sesión o challengeId MFA;401 INVALID_CREDENTIALS. |
| POST /auth/mfa/verify | Challenge | challengeId,code |200 sesión;401/410. |
| POST /auth/logout | H | CSRF |204 invalida. |
| GET /auth/me | H | — |200 user,memberships,activeTenant,permissions. |
| POST /auth/switch-tenant | H | tenantId |200 sesión rotada,permissions;403 membership. |
| POST /auth/forgot-password | Público | email |202 mensaje uniforme. |
| POST /auth/reset-password | Token | token,password |204;410 usado/vencido. |
| POST /auth/mfa/enroll | H recent-auth | password/current challenge |200 enrollmentSecret/QR temporal; confirm separado. |
| POST /auth/mfa/enroll/confirm | H | code |200 recoveryCodes una vez. |
| POST /auth/mfa/recover | Challenge | challengeId,recoveryCode |200 sesión, invalida código. |
| GET /settings | H settings.read |—|200 configVersion/config. |
| PATCH /settings | H settings.write C | campos config permitidos |200 nueva versión;409 VERSION_CONFLICT. |
| GET /memberships | H users.manage |status,cursor|Page<Membership>. |
| POST /memberships/invite | H users.manage I |email,roleId|202 inviteJob;403 role no permitido. |
| POST /auth/invitations/accept | Token I |token,password,displayName|200 membership;410. |
| PATCH /memberships/{id} | H users.manage C |roleId?,status?|200 Membership;409 LAST_OWNER. |
| GET /api-credentials | H integrations.manage |cursor|Page<MaskedCredential>. |
| POST /api-credentials | H integrations.manage I |name,integrationId?,scopes,expiresAt?|201 credential + secret una vez. |
| POST /api-credentials/{id}/revoke | H integrations.manage I |reason|204. |
| GET /customers | H/K customers.read |q,status,cursor|Page<CustomerSummary>. |
| POST /customers | H/K customers.write I |CustomerInput|201 Customer. |
| GET /customers/{id} | H/K customers.read |—|200 Customer redacted por scope. |
| PATCH /customers/{id} | H/K customers.write C |campos Customer editables|200;409. |
| POST /customers/{id}/archive | H customers.write I C |reason|200 CommandResult. |
| POST /customers/{id}/addresses | H/K customers.write I |AddressInput + label|201 Address. |
| PATCH /customers/{id}/addresses/{addressId} | H/K customers.write C |AddressInput parcial|200. |
| POST /customers/{id}/consents | H/S customers.consent I |purpose,status,source,proofRef?|201 ConsentEvent. |
| GET /customers/{id}/history | H customers.read |type,cursor|Page<TimelineEntry>. |
| PATCH /customers/{id}/fiscal-data | H customers.fiscal C |rfc?,legalName?,fiscalPostalCode?,taxRegime?,cfdiUse?|200 datos con máscara;422 formato. |

## 4. Catálogo, stock y medios

| Operación | Auth/scope | Input | Output / errores específicos |
| --- | --- | --- | --- |
| GET /products | H/K products.read |q,status,categoryId,cursor|Page<ProductSummary>. |
| POST /products | H/K products.write I |ProductInput|201 Product DRAFT;409 SKU_EXISTS. |
| GET /products/{id} | H/K products.read |—|200 Product con variants/media/lockVersion. |
| PATCH /products/{id} | H/K products.write C |campos producto, no precio variante|200;409 FIELD_OWNED_EXTERNALLY. |
| POST /products/{id}/variants | H/K products.write I C |VariantInput|201 Variant. |
| PATCH /products/{id}/variants/{variantId} | H/K products.write C |VariantInput parcial|200;409 conflicto SKU/versión. |
| POST /products/{id}/activate | H/K products.write I C |—|200;422 INVALID_SAT_KEY/INCOMPLETE. |
| POST /products/{id}/archive | H/K products.write I C |reason|200. |
| POST /products/{id}/restore-draft | H/K products.write I C |—|200 DRAFT. |
| POST /products/{id}/duplicate | H products.write I |newName|201 DRAFT con SKUs temporales y skuNeedsReview=true. |
| GET /sat/product-keys | H/K products.read |q,asOf,cursor|Page<SatEntry>. |
| GET /sat/unit-keys | H/K products.read |q,asOf,cursor|Page<SatEntry>. |
| GET /tax-profiles | H/K products.read |active,cursor|Page<TaxProfile>. |
| POST /tax-profiles | H settings.write I |name,mode,rate|201 versión de perfil. |
| POST /tax-profiles/{id}/revisions | H settings.write I C |mode,rate,reason|201 nuevo perfil versionado. |
| GET /variants/{id}/availability | H/K products.read |quantity?|200 mode,available?,asOf. |
| POST /variants/{id}/inventory-adjustments | H inventory.write I C |newOnHand,reason|201 Movement;409 BELOW_RESERVED. |
| POST /media/upload-intents | H media.write I |kind,mime,bytes,checksum|201 uploadUrl,mediaId,expiresAt. |
| POST /media/{id}/finalize | H media.write I |checksum|202 Job→VALIDATED/REJECTED. |
| POST /products/{id}/media | H products.write I C |mediaId,position|201 binding;422 MEDIA_NOT_READY. |
| DELETE /products/{id}/media/{mediaId} | H products.write C |—|204 desvincula. |
| POST /product-imports | H/K products.write I |mediaId,mode:DRY_RUN,integrationId?|202 Job. |
| POST /product-imports/{id}/commit | H/K products.write I |dryRunHash|202 Job;409 HASH_CHANGED. |
| GET /product-imports/{id} | H/K products.read |—|200 progreso/conteos/errorsUrl?. |
| POST /product-imports/{id}/retry-failed | H/K products.write I |—|202 Job nuevo vinculado. |

## 5. Ventas, checkout y pagos

| Operación | Auth/scope | Input | Output / errores específicos |
| --- | --- | --- | --- |
| POST /quotes/preview | H/K/S quotes.create |QuoteInput|200 QuotePreview;422 QUANTITY_RULE. |
| POST /quotes | H/K/S quotes.create I |QuoteInput|201 Quote DRAFT. |
| GET /quotes | H/K quotes.read |status,customerId,source,from,to,cursor|Page<QuoteSummary>. |
| GET /quotes/{id} | H/K quotes.read |revisionNo?|200 QuoteVersion + allowedActions. |
| PATCH /quotes/{id}/draft | H/K quotes.create C |QuoteInput parcial|200;409 IMMUTABLE_VERSION. |
| POST /quotes/{id}/issue | H/K/S quotes.issue I C |previewHash|200 QuoteIssued + checkoutUrl;409 PRICE_CHANGED. |
| POST /quotes/{id}/revisions | H quotes.create I C |reason|201 QuoteVersion DRAFT. |
| POST /quotes/{id}/duplicate | H quotes.create I |—|201 Quote DRAFT nuevo. |
| POST /quotes/{id}/cancel | H/K quotes.cancel I C |reason|200;409 STATE_CONFLICT. |
| POST /quotes/{id}/send | H/K/S quotes.send I |SendInput|202 Notification job. |
| POST /quotes/{id}/documents | H/K quotes.read I |revisionNo,format:PDF|202 Job. |
| POST /quick-charges | H/K quickcharges.create I |QuickChargeInput|201 Order + checkoutUrl. |
| POST /orders | H/K orders.create I |customerId?,externalId?,currency,items,delivery,notes?|201 Order directo PENDING_PAYMENT. |
| GET /orders | H/K orders.read |status,paymentStatus,source,customerId,from,to,cursor|Page<OrderSummary>. |
| GET /orders/{id} | H/K orders.read |—|200 Order + currentRevision + financialSummary. |
| POST /orders/{id}/revisions | H orders.update I C |items?,delivery?,reason|201 revisión propuesta;409 ACTIVE_PAYMENT. |
| POST /orders/{id}/cancel | H orders.cancel I C |reason|202/200 según sesión;409 STATE_CONFLICT. |
| POST /orders/{id}/fulfillment | H orders.fulfill I C |targetState,tracking?,reason?|200;409 PAYMENT_REQUIRED. |
| GET /payments | H payments.read |status,orderId,from,to,cursor|Page<PaymentAttempt>. |
| GET /payments/{id} | H/K payments.read |—|200 PaymentDetail livemode=false. |
| POST /payments/{id}/reconcile | H payments.reconcile I |—|202 Job. |
| POST /payments/{id}/refunds | H payments.refund I |RefundInput|202 Refund;409 REFUND_EXCEEDS_AVAILABLE. |
| GET /refunds/{id} | H payments.read |—|200 RefundStatus. |
| GET /incidents | H incidents.read |state,type,cursor|Page<Incident>. |
| POST /incidents/{id}/resolve | H incidents.resolve I C |resolution:FULFILL/REFUND/ACKNOWLEDGE,reason,relatedActionId?|200 o202;409 acción sin completar. |
| GET /public/quotes/{token} | P |—|200 PublicQuote;410 LINK_UNAVAILABLE. |
| POST /public/quotes/{token}/accept | P I |quoteVersionId,contentHash,termsVersion,accepted:true|201 OrderRef o replay200. |
| POST /public/quotes/{token}/reject | P I |reason?|200. |
| GET /public/orders/{token} | P |—|200 PublicOrder mínimo. |
| POST /public/orders/{token}/checkout/prepare | P I |CheckoutPrepareInput|200 revisión/diff;409 ACTIVE_PAYMENT. |
| POST /public/orders/{token}/checkout/confirm | P I |CheckoutConfirmInput|202 CheckoutSession. |
| GET /public/orders/{token}/checkout/{id} | P |—|200 status,redirectUrl?,expiresAt?,reason?. |
| GET /public/orders/{token}/payment-status | P |—|200 resumen simulado,asOf,canRetry. |
| POST /public/orders/{token}/verify-contact | P rate limitado |—|202 challenge al canal guardado. |
| POST /public/orders/{token}/verify-contact/confirm | P |challengeId,code|200 permiso temporal10min. |
| POST /links/{id}/revoke | H links.manage I C |reason|204; no cancela pago por sí solo. |

GET resultado público jamás incluye provider secrets, ledger bruto, notas privadas o datos fiscales. Un reembolso solicitado vía payments/{id} se resuelve a la transacción exitosa del intento; si no existe, 409 NO_SUCCESSFUL_TRANSACTION.

## 6. Canales, chat, integraciones y reportes

| Operación | Auth/scope | Input | Output |
| --- | --- | --- | --- |
| GET /whatsapp/connections | H channels.read |cursor|Page<Connection>. |
| POST /whatsapp/connections | H channels.manage I |provider,name|201 Connection. |
| POST /whatsapp/connections/{id}/connect | H channels.manage I |provider-specific configuration reference|202 onboardingUrl? / statusUrl. |
| GET /whatsapp/meta/callback | H + state |code,state|Redirige a estado portal; intercambio servidor. |
| GET /whatsapp/connections/{id}/status | H channels.read |—|200 state/capabilities/health. |
| GET /whatsapp/connections/{id}/qr | H channels.manage |—|200 qr,expiresAt o409 WRONG_PROVIDER. |
| POST /whatsapp/connections/{id}/disconnect | H channels.manage I |reason|202 Job. |
| GET /templates | H channels.read |connectionId,status,cursor|Page<Template>. |
| POST /templates/sync | H channels.manage I |connectionId|202 Job. |
| GET /conversations | H conversations.read |state,assignedTo,q,cursor|Page<Conversation>. |
| GET /conversations/{id}/messages | H conversations.read |before,limit|Page<Message>. |
| POST /conversations/{id}/messages | H conversations.manage I |HumanMessageInput|202 Notification. |
| POST /conversations/{id}/handoff | H/S conversations.manage I |expectedControlVersion,assignedTo?,reason|200 Conversation. |
| POST /conversations/{id}/resume | H conversations.manage I |expectedControlVersion,summary|200 Conversation. |
| GET /realtime | H |topics allowlist,lastEventId?|SSE filtrado tenant/permissions. |
| POST /integrations | H integrations.manage I |name,externalSystem,ownership|201 Integration. |
| PATCH /integrations/{id} | H integrations.manage C |enabled?,ownership?|200. |
| PUT /integrations/{id}/products/{externalId} | K products.write I |ExternalProductInput|200/201 mapping/version. |
| GET /events | H/K integrations.read |cursor,types,from|Page<DomainEvent>;410 CURSOR_EXPIRED. |
| POST /webhook-subscriptions | H integrations.manage I |WebhookInput|201 PENDING_VERIFY + secret una vez. |
| PATCH /webhook-subscriptions/{id} | H integrations.manage C |events?,active?,description?|200; URL nueva exige reverificación. |
| POST /webhook-subscriptions/{id}/verify | H integrations.manage I |—|202 challenge job. |
| POST /webhook-subscriptions/{id}/rotate-secret | H integrations.manage I |—|200 secret una vez,keyId. |
| GET /webhook-deliveries | H integrations.read |subscriptionId,eventId,status,cursor|Page<Delivery>. |
| POST /webhook-deliveries/{id}/retry | H integrations.manage I |reason|202 Job. |
| GET /notifications | H notifications.read |resourceId,state,cursor|Page<Notification>. |
| GET /orders/{id}/timeline | H orders.read |cursor|Page<TimelineEntry>. |
| GET /reports/summary | H reports.read |from,to,timezone,source?,sellerId?|200 Metrics + asOf + livemode=false. |
| POST /reports/exports | H reports.export I |reportType,filters,format:CSV|202 Job. |
| GET /jobs/{id} | H/K job owner/scope |—|200 JobDetail/resultUrl?. |
| GET /audit | H audit.read |entityType,entityId,actor,from,to,cursor|Page<AuditEntry>. |

## 7. Entradas de proveedor y comandos internos

GET /webhooks/whatsapp/meta implementa challenge oficial; POST misma ruta verifica firma, resuelve phone binding y persiste inbox. POST /webhooks/whatsapp/evolution/{connectionRef} exige autenticación acordada con release/gateway. POST /webhooks/payments/dummy verifica firma/tenant mapping por merchant. Éxito durable202; firma inválida401/403; payload inválido400; DB no disponible503 para que el proveedor reintente. No se ejecuta agente antes del ACK.

POST /internal/agent-tools/{toolName} exige S + audiencia commerce-tools, invocationId, conversationId y args del schema AIA. Tenant procede del token. Response `{data,invocationId,requestId}`; mutantes I, controlVersion validada. Registro allowlist no admite toolName dinámico arbitrario. GET /internal/health y /internal/ready solo red operativa, sin dump de config.

## 8. Catálogo de eventos de dominio

Todos contienen envelope INT. `aggregate.version` se incrementa por cambio del agregado, no por cada intento de entrega. Un comando puede emitir varios eventos con misma versión agregada y distintos eventId/type. Los consumidores no descartan tipos distintos de igual versión; deduplican por eventId.

| Evento | Aggregate / data requerida | Consumidores |
| --- | --- | --- |
| product.created/updated/activated/archived | product; productId,variantIds,sourceVersion,changedFields | Indexer, integraciones. |
| inventory.changed | variant; variantId,available,asOf | Búsqueda informativa/integraciones. |
| customer.reminders_opted_out | customer; customerId,channel,purpose | Reminder canceller. |
| quote.issued | quote; quoteId,quoteVersionId,total,currency,validUntil,linkRef | Timeline, webhook, envío solicitado separado. |
| quote.accepted | quote; quoteVersionId,orderId,acceptedAt | Timeline/integraciones. |
| quote.rejected/expired/superseded/canceled | quote; quoteVersionId,reason?,replacementVersionId? | Reminders/timeline/integraciones. |
| order.created | order; orderId,source,externalRefs,total,currency | Confirmación de recepción. |
| order.revision_accepted | order; revisionId,contentHash,total | Timeline. |
| payment.create.requested | order; attemptId,operationKey | Worker pagos interno, no clientes. |
| payment.link_created | order; attemptId,checkoutSessionId,expiresAt,linkRef | Checkout/timeline/webhook autorizado. |
| payment.pending/succeeded/failed | order; orderId,attemptId,transactionId? éxito requerido,amount,currency,reason? | Notificaciones/integ/reportes. |
| payment.refund_requested | order; refundId,transactionId,amount | Worker refund interno. |
| payment.refunded | order; refundId,transactionId,amount | Reportes/integraciones. |
| payment.disputed | order; disputeId,transactionId,amount,state | Incidencias/finanzas. |
| order.confirmed/canceled/closed | order; orderId,reason?,revisionId | Timeline/notificaciones/integraciones. |
| order.fulfillment_updated | order; orderId,fromState,toState,tracking? | Atención/integraciones. |
| incident.opened/resolved | order; incidentId,type,resolution? | Finanzas/alertas. |
| message.received | conversation; messageId,kind,controlVersion | Agent scheduler. |
| conversation.handoff_requested | conversation; reason,assignedTo?,controlVersion | Bandeja/alertas. |
| whatsapp.connection_changed | connection; fromState,toState,reasonCode? | UI/notificaciones salud. |
| notification.requested | notification; notificationId | Dispatcher interno. |
| notification.delivery_updated | notification; status,providerMessageId? | Timeline. |

Eventos internos no se ofrecen en subscriptions externas. Quote.issued y order.created no se cuentan como “enviados”; Notification gestiona entrega. Todo evento financiero DUMMY conserva livemode=false. Configuración `includeLinks` solo expone checkoutUrl resuelta al serializar para destinos autorizados; base outbox guarda linkRef.

## 9. Ejemplos completos de operaciones críticas

Ejemplo de body al crear cotización (IDs de fixture UUID válidos):

```json
{
  "customerId": "01991940-0000-7000-8000-000000000001",
  "externalId": "ERP-Q-10",
  "currency": "MXN",
  "items": [
    {"variantId": "01991940-0000-7000-8000-000000000010", "quantity": "2.000"}
  ],
  "delivery": {"mode": "PICKUP", "pickupLocationId": "01991940-0000-7000-8000-000000000020"},
  "validUntil": "2026-09-15T18:00:00Z"
}
```

Ejemplo confirmación de checkout sin precio manipulable:

```json
{
  "revisionId": "01991940-0000-7000-8000-000000000030",
  "contentHash": "sha256:fixture-content-hash",
  "termsVersion": "terms-2",
  "accepted": true
}
```

Ejemplo evento externo:

```json
{
  "eventId": "01991940-0000-7000-8000-000000000050",
  "type": "payment.succeeded",
  "schemaVersion": "1.0",
  "occurredAt": "2026-09-08T18:30:00Z",
  "tenantId": "01991940-0000-7000-8000-000000000060",
  "aggregate": {"type": "order", "id": "01991940-0000-7000-8000-000000000070", "version": 4},
  "correlationId": "01991940-0000-7000-8000-000000000080",
  "causationId": "01991940-0000-7000-8000-000000000090",
  "origin": {"system": "netpay-plane", "integrationId": null},
  "livemode": false,
  "data": {
    "orderId": "01991940-0000-7000-8000-000000000070",
    "attemptId": "01991940-0000-7000-8000-000000000100",
    "transactionId": "dummy_tx_fixture_1",
    "amount": "232.00",
    "currency": "MXN"
  }
}
```

`contentHash` del ejemplo es ilustrativo; fixtures ejecutables deben calcular SHA256 real. La prueba de contrato valida formato y semántica en vez de utilizar el literal como hash válido.


## 10. Configuración de conectores y contratos administrativos auxiliares

ConnectionCreate `{provider:"META_CLOUD"|"EVOLUTION_BAILEYS",name:string1..100}`. Connect para Meta: unión discriminada `{mode:"EMBEDDED_SIGNUP"}` o `{mode:"MANUAL",wabaId:string,phoneNumberId:string,accessTokenSecretRef:string}`; los secret refs solo pueden ser creados por el gestor del tenant. Connect Evolution: `{mode:"QR",deploymentId:UUID}`; deploymentId referencia un host/secret gestionado, nunca una URL y API key elegidas por el comprador. Configuración de servicio Evolution es administración de plataforma y no accesible a vendedores.

| Operación adicional | Auth / input | Resultado |
| --- | --- | --- |
| GET/POST /categories | H products.read/write; POST name,parentId? + I | Lista /201 Category; profundidad≤3 y sin ciclos. |
| PATCH /categories/{id} | H products.write C; name?,parentId? |200;409 CATEGORY_CYCLE. |
| POST /products/{id}/variants/{variantId}/archive | H/K products.write I C; reason |200, no se borra snapshot. |
| PUT /products/{id}/aliases | H products.write I C; aliases:string[]max30 |200 lista normalizada. |
| POST /integrations/{id}/field-overrides | H integrations.manage I; entityType,entityId,field,value,reason,expiresAt? |201 override auditable. |
| POST /field-overrides/{id}/revoke | H integrations.manage I; reason |200; agenda resync. |
| POST /template-mappings | H channels.manage I; connectionId,purpose,providerTemplateName,language,variableMapping |201 mapping; valida variables requeridas. |
| PATCH /template-mappings/{id} | H channels.manage C; enabled?,variableMapping? |200;422 mismatch. |
| POST /conversations/{id}/customer-link | H conversations.manage I; customerId,expectedControlVersion,reason |200;409 IDENTITY_CONFLICT. |
| POST /orders/{id}/close | H orders.manage I C; reason? |200;409 OPEN_INCIDENT_OR_FULFILLMENT. |
| POST /incidents/{id}/assign | H incidents.manage I C; userId |200 Incident. |
| POST /privacy/exports | H privacy.manage I; customerId,purpose |202 job privado auditado. |
| POST /privacy/erasure-requests | H privacy.manage I; customerId,reason |202 job aplica retención/holds. |
| POST /retention-holds | H privacy.manage I; entityType,entityId,reason |201 hold. |
| POST /retention-holds/{id}/release | H privacy.manage I; reason |200 y programa reevaluación. |

Read models mínimos: ProductSummary id/name/status/thumbnail/variantCount/priceRange/lockVersion; QuoteSummary id/folio/revision/state/customerName/total/validUntil/deliveryStatus; OrderSummary id/folio/source/commercialState/financialSummary/fulfillmentState/currentRevision/total/livemode; PaymentDetail attemptId/orderId/status/provider/amount/currency/asOf/transactions/refunds/incidents/livemode. Valores de identidad/datos sensibles pasan por serializer de scope. Las respuestas detalladas incluyen campos del diccionario relacional pertinentes al agregado, excluyendo hashes/secret refs y tablas internas.

OTP público: challenge aleatorio de6dígitos, hash almacenado, TTL5min, máximo5 intentos, cooldown60s, máximo3 emisiones/h por recurso/destino. Enviar solo al contacto registrado sin permitir que input cambie destino; si no existe canal válido, `409 VERIFICATION_UNAVAILABLE` y soporte del vendedor. No devolver OTP en API fuera de fixture privado. Firma del contenido aceptado se recalcula después de modificaciones autorizadas.

SendInput purpose debe corresponder al recurso/endpoint; caller no puede enviar PAYMENT_SIMULATED_SUCCESS desde /quotes/{id}/send. Los mensajes financieros nacen de evento verificado, no de una petición libre de texto del agente.
