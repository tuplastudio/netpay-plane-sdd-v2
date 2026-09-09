# SPEC-INT — API de integración, webhooks y sincronización

Versión: 2.0. Estado: especificado; implementación pendiente.

## API como producto

Cada Integration tiene tenant, name, externalSystem, scopes, sourceOwnership, active, quotas y secretRefs. API key deriva tenant; no lo toma del payload. Integraciones pueden dar de alta catálogo/clientes, solicitar cotización, envío y consultar pedido/pago. No tienen permiso de reembolso por defecto.

ExternalReference única `(tenant,integration,entityType,externalId)`. Product upsert por ruta de integración, cliente por referencia y quote/order con externalId único dentro del tipo. externalVersion monotónica cuando el origen la proporciona; una versión vieja retorna conflicto y no pisa datos nuevos. Cuando origen no proporciona versión, usar hash de payload e If-Match para ediciones; no comparar relojes de servidores como autoridad.

Un import inicial y eventos incrementales usan los mismos casos de uso. FieldOwnership determina quién escribe description, price, inventory y fulfillment. UI muestra origen. Override LOCAL exige permiso, motivo y expiry opcional; el override activo gana hasta revocarse, después sincronización solicita snapshot del dueño. No aplicar “último write gana” silenciosamente para precios.

## Envelope y entrega saliente

`eventId` UUID, `type`, `schemaVersion=1.0`, `occurredAt`, `tenantId`, `aggregate:{type,id,version}`, `correlationId`, `causationId`, `origin:{system,integrationId}`, `livemode:false`, `data`. Datos limitados al evento, referencias externas opcionales. Link público solo en eventos de quote/link para suscripciones con scope `links.read`; nunca en logs. Esquema mayor nuevo para cambio incompatible; campo opcional añadido no rompe consumidor.

WebhookSubscription: HTTPS endpoint, subscribedTypes, secretRef, active, createdBy y policyVersion. Al registrar: validar URL, resolver DNS y comprobar endpoint mediante challenge firmado con nonce/expiración; activar al responder nonce de prueba. Challenge es mensaje técnico de integración solicitado, no comunicación a personas.

HMAC SHA256(timestamp + '.' + rawBody), headers X-Event-Id/X-Timestamp/X-Signature (`v1=<hex>`, key ID opcional). Tolerancia recomendada 5 min y comparación constante. Los ejemplos de firma son del contrato propio; no se confunden con Meta ni dummy. Redactar body sensible de logs conservando hash y código HTTP.

Política: timeout 10 s; 2xx éxito; 408/429/5xx/network reintentan 1m,5m,15m,1h,6h,24h con jitter; otros 4xx terminales, 410 desactiva suscripción y alerta. 429 respeta Retry-After con tope 24 h. 3xx no se siguen automáticamente. Tras agotar va DLQ. La primera entrega más los seis reintentos produce máximo 7 intentos automáticos.

Reenvío manual exige permiso y conserva eventId, pero crea delivery attempt nuevo y firma con timestamp actual. Garantía at-least-once, sin orden global. Consumers comparan aggregateVersion o vuelven a consultar estado; la plataforma ofrece GET /events con cursor y retención 30 días para recuperación.

## Seguridad y bucles

SSRF: HTTPS, sin credenciales embebidas, IPs públicas solamente, resolver y verificar destino al conectar, bloquear loopback/RFC1918/link-local/metadata/IPv6 privadas; no seguir redirects ni confiar solo en validación de registro. Para tests locales usar receptor interno preconfigurado en perfil test, no una excepción activable por clientes.

Origen y causationId preservados en comandos derivados. No notificar cambios de eco idénticos a su integración origen; cambios reales del dominio sí generan nuevo evento y referencia de causalidad. Consumers deduplican por eventId; product hash igual evita escritura y outbox innecesarios.

## Ejemplo de recorrido

ERP envía PUT producto EXT-1 → plataforma retorna variantId/version → ERP POST quote con externalId Q-10 → issue retorna preview link → evento quote.issued al CRM autorizado → comprador acepta/paga dummy → order.confirmed y payment.succeeded con livemode=false → ERP actualiza estado simulado. Si receptor no responde, venta continúa y delivery se reintenta.

## Requisitos, tareas y aceptación

### REQ-INT-01 / T-INT-01 — Registrar integraciones y referencias

**Regla normativa:** Identidad externa no colisiona entre sistemas o empresas.

**Trabajo específico:** Crear Integration/ExternalReference, scopes/sourceOwnership y endpoints de alta/estado/revocación; transacciones de upsert.

**Entregable esperado:** integration registry y reference resolver.

**Dependencias:** T-PAY-07, T-CAT-07.

**AC-INT-01 — prueba de aceptación:** Dos sistemas con externalId 1 no se pisan; misma integración/ID retorna mismo recurso.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-INT-01. Estado inicial: `TODO`.

### REQ-INT-02 / T-INT-02 — Sincronizar con control de conflictos

**Regla normativa:** Versiones antiguas no sobrescriben precio o stock nuevos.

**Trabajo específico:** Implementar upsert externalVersion/hash, propiedad por campo, override auditado y reanudación incremental; eliminar externo archiva sin cascade.

**Entregable esperado:** sync commands y fixtures ERP.

**Dependencias:** T-INT-01.

**AC-INT-02 — prueba de aceptación:** Versión 4 luego 3 conserva 4; eco con hash igual no genera evento; override bloquea update no autorizado.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-INT-02. Estado inicial: `TODO`.

### REQ-INT-03 / T-INT-03 — Suscribir endpoints verificables

**Regla normativa:** Un destino no se activa sin prueba de control y validación de red.

**Trabajo específico:** Crear subscriptions, secrets one-time, challenge nonce, DNS/SSRF guard y lista de eventos; secret rotation con 24 h coexistencia.

**Entregable esperado:** webhook subscription API y challenge worker.

**Dependencias:** T-INT-02.

**AC-INT-03 — prueba de aceptación:** Localhost y metadata bloqueados; endpoint que no devuelve nonce queda PENDING; secret viejo vence tras rotación.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-INT-03. Estado inicial: `TODO`.

### REQ-INT-04 / T-INT-04 — Publicar con firma e inbox del receptor de prueba

**Regla normativa:** Venta no espera al webhook externo.

**Trabajo específico:** Implementar dispatcher, firma bytes, delivery history, timeout/backoff por clase HTTP y DLQ; receptor fixture con dedup/orden.

**Entregable esperado:** webhook dispatcher y test receiver.

**Dependencias:** T-INT-03.

**AC-INT-04 — prueba de aceptación:** 500 reintenta 7 intentos totales; 400 termina; 429 espera; duplicado conserva eventId y receptor aplica una vez.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-INT-04. Estado inicial: `TODO`.

### REQ-INT-05 / T-INT-05 — Reprocesar y recuperar eventos

**Regla normativa:** Replay no equivale a nuevo evento comercial.

**Trabajo específico:** Crear retry manual, GET events cursor 30d, export de entregas y payload redacted; versiones y scopes links.read.

**Entregable esperado:** integration observability API y event feed.

**Dependencias:** T-INT-04.

**AC-INT-05 — prueba de aceptación:** Reintentar conserva eventId; subscription sin links.read no recibe token; cursor expirado devuelve instrucción de resync.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-INT-05. Estado inicial: `TODO`.

### REQ-INT-06 / T-INT-06 — Certificar flujo externo

**Regla normativa:** API y webhooks completan el recorrido sin manipular DB.

**Trabajo específico:** Crear test externo catálogo→quote→issue→accept→dummy→webhook; repetir requests, simular receptor caído y evento tardío.

**Entregable esperado:** tests/e2e/external-integration y colección HTTP.

**Dependencias:** T-INT-05.

**AC-INT-06 — prueba de aceptación:** Una cotización externa termina en pedido simulado pagado y evento recuperable tras caída, sin duplicados.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-INT-06. Estado inicial: `TODO`.
