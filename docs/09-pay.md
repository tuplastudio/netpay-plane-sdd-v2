# SPEC-PAY — Pasarela dummy, conciliación, reembolsos y escenarios

Versión: 2.0. Estado: especificado; implementación pendiente.

## Propósito y límite

Pasarela DUMMY es el único PaymentProvider de V2. Ninguna credencial NetPay/Stripe ni SDK financiero se instala. No hay campos de tarjeta, CVV, cuenta bancaria ni dinero real. Todos los registros/eventos llevan provider=DUMMY y livemode=false; UI, PDF, WhatsApp y reportes usan la palabra “simulado”. No emitir recibos que puedan confundirse con comprobantes bancarios.

Dummy es un servicio HTTP separado con base propia, reloj inyectable en tests y secretos distintos de commerce. Puede iniciar, consultar, cancelar, completar escenarios y reembolsar. Commerce solo verifica por API/HMAC, como haría con un proveedor externo. No accede a tablas dummy directamente.

## Contrato PaymentProvider

`createCheckout({merchantAccountRef,operationKey,orderRef,revisionRef,amount,currency,expiresAt,returnUrl})` → `{providerSessionId,status,checkoutUrl,expiresAt,livemode:false}`. `findByOperationKey`, `getStatus(sessionId)`, `cancel(sessionId)`, `refund({transactionId,refundKey,amount})`, `getRefundStatus` y `verifyWebhook(rawBody,headers)`.

returnUrl se obtiene de config allowlist y ruta fija, no de input libre del cliente. operationKey única por cuenta. Create repetido con mismo body devuelve sesión original; distinto body 409. Una sesión solo tiene una transición final de pago; para escenario de sobrepago usar dos sesiones distintas del mismo orderRef. Session `CREATED` → PENDING → SUCCEEDED/FAILED/CANCELED/EXPIRED. `UNKNOWN` solo existe del lado comercio cuando no conoce el resultado, nunca como verdad final del simulador.

## API del simulador

| Método/ruta | Auth | Contrato |
| --- | --- | --- |
| POST /dummy/v1/sessions | Service key | Campos createCheckout; 201 o replay 200. |
| GET /dummy/v1/sessions/{id} | Service key | Estado, reference, amount, currency, merchant, transaction y timestamps. |
| GET /dummy/v1/sessions/by-operation/{key} | Service key | 200 encontrado/404 ausente verificable. |
| POST /dummy/v1/sessions/{id}/cancel | Service key | 200 terminal cancelado; 409 si ya pagado. |
| POST /dummy/v1/refunds | Service key | transactionId, refundKey, amount, reason; 202. |
| GET /dummy/v1/refunds/{id} | Service key | Estado y amount. |
| GET /dummy/checkout/{token} | Capability limitada | Pantalla marcada simulador sin datos financieros. |
| POST /dummy/checkout/{token}/submit | Sesión + CSRF | Acción aprobar/rechazar/cancelar en modo demostración. |
| POST /dummy/control/scenarios | Rol simulation.manage | Crear plan de fallos para una sesión/cuenta de test. |
| POST /dummy/control/events/{id}/replay | Rol simulation.manage | Reemitir evento conservando ID lógico. |

Controles avanzados solo para operador autenticado o test harness en red privada. El comprador de la demo puede elegir aprobación/rechazo visible, pero no importe, merchant, orderRef, event payload, duplicados ni estado arbitrario del comercio.

## Catálogo de escenarios deterministas

| ID | Configuración/acción | Verdad dummy | Resultado comercio esperado |
| --- | --- | --- | --- |
| D01 | APPROVE inmediatamente | SUCCEEDED, transaction única | PAID simulado y CONFIRMED, consume reserva una vez. |
| D02 | DECLINE | FAILED con razón de simulación | UNPAID, liberar reserva; habilitar nuevo intento. |
| D03 | PENDING_THEN_SUCCESS 60 s | PENDING hasta reloj t+60 | Pendiente antes; éxito solo tras verificar. |
| D04 | PENDING_THEN_FAILURE 60 s | PENDING→FAILED | No confirmar durante espera. |
| D05 | EXPIRE | EXPIRED a expiresAt | Sin pago, libera reserva. |
| D06 | USER_CANCEL | CANCELED | Pedido puede reintentar, no se cancela necesariamente la venta. |
| D07 | CREATE_TIMEOUT_AFTER_COMMIT | Sesión persistida, respuesta omitida | UNKNOWN; findByOperationKey recupera la misma sesión. |
| D08 | DROP_WEBHOOK | Pago existe, ningún evento entregado | Reconciler descubre éxito por consulta. |
| D09 | DUPLICATE_WEBHOOK ×3 | Un evento/una transacción | Inbox procesa una vez. |
| D10 | REORDER_PENDING_AFTER_SUCCESS | Éxito, luego mensaje antiguo | No regresa a pendiente. |
| D11 | INVALID_SIGNATURE | Evento modificado | 401/403, ninguna mutación, alerta técnica. |
| D12 | WRONG_AMOUNT/CURRENCY/MERCHANT | Evento o sesión no corresponde | Incidencia, no confirmar pedido. |
| D13 | LATE_SUCCESS | Paga tras expirar/revocar/cancelar | Registrar ingreso e incidencia, no entregar automáticamente. |
| D14 | DOUBLE_SESSION_SUCCESS | Dos transacciones de dos sesiones | Sobrepago registrado, entrega única. |
| D15 | REFUND_SUCCESS/FAILURE | Reembolso termina por escenario | Net refleja solo reembolso exitoso. |
| D16 | STATUS_UNAVAILABLE | Consulta 503 temporal | UNKNOWN, backoff, sin recordar cobro como fallido. |
| D17 | CRASH_BEFORE_WEBHOOK_ACK | Comercio confirma y conexión cae | Replay no duplica notificación lógica ni stock. |

D13/D14 son inyecciones controladas de sandbox, no rutas normales de pago de sesión terminal. El control registra actor, escenario y evidencia; no expone esta capacidad al checkout público. El estado de pago final requiere autenticación de servicio y verificación aun dentro de una demo.

## Webhooks y conciliación

Evento dummy contiene eventId, eventType payment.succeeded/payment.failed/payment.pending/refund.succeeded/refund.failed, occurredAt, sessionId, transactionId cuando existe, orderRef, revisionRef, merchantAccountRef, amount, currency, livemode=false y sequence. Firma SHA256 HMAC de timestamp + punto + bytes exactos del body; headers X-Dummy-Event-Id, X-Dummy-Timestamp, X-Dummy-Signature. Secret por cuenta, ventana de 5 min, comparación constante. Reintentos mantienen ID y generan firma fresca.

Commerce valida firma, persiste inbox y responde 202; worker consulta estado dummy, compara cuenta/sesión/revisión/moneda/importe y registra transaction única en transacción con order/stock/outbox. Evento discordante no basta para confirmar, aunque esté firmado.

Pending/unknown se consultan cada 5 min; inmediatamente tras timeout o retorno con backoff 2/10/30 s. Tras 24 h sin resolución crear incidente y reducir frecuencia a 1 h, no marcar FAILED por timeout. Sweep diario compara sesiones y pagos por referencias; provider API debe permitir listado paginado `GET /dummy/v1/transactions?from&to&cursor` para esa conciliación. No depender del listado para acreditar sin cotejo individual.

## Reembolsos simulados

Se permiten parciales o totales sobre transacción pagada; esto no habilita cobro en parcialidades. Monto >0 y suma de reembolsos exitosos + pendientes ≤importe capturado, bloqueo por transacción. `REQUESTED`→PENDING→SUCCEEDED/FAILED; autorización con payments.refund y motivo. Al fallar se libera capacidad reservada; reintento técnico conserva refundKey, nuevo intento de negocio genera nueva solicitud.

Disputa simulada: OPEN/WON/LOST/CLOSED con referencia y amount; no borrar la transacción original. V2 registra disputa e incidencia, sin integrar redes financieras.

## Requisitos, tareas y aceptación

### REQ-PAY-01 / T-PAY-01 — Construir dummy y cuenta simulada

**Regla normativa:** Simulador no puede escribir en base comercial.

**Trabajo específico:** Crear servicio, esquema aislado, service auth, merchant fixtures, create/find/status/cancel y token checkout; operationKey unique y clock inyectable.

**Entregable esperado:** apps/dummy-gateway y contrato HTTP propio.

**Dependencias:** T-FND-06.

**AC-PAY-01 — prueba de aceptación:** Dos creates iguales devuelven sessionId idéntico; body distinto da 409; usuario SQL dummy no modifica order.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-PAY-01. Estado inicial: `TODO`.

### REQ-PAY-02 / T-PAY-02 — Crear checkout simulado

**Regla normativa:** Toda acción visible deja claro que no hay cobro real.

**Trabajo específico:** Implementar pantalla dummy sin tarjeta, resumen fijo, acciones approve/decline/cancel y CSRF; returnUrl allowlist y monto read-only.

**Entregable esperado:** dummy checkout pages y submit endpoint.

**Dependencias:** T-PAY-01.

**AC-PAY-02 — prueba de aceptación:** No existe PAN/CVV en DOM/API; cliente no puede cambiar amount; redirección a dominio arbitrario falla.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-PAY-02. Estado inicial: `TODO`.

### REQ-PAY-03 / T-PAY-03 — Implementar eventos y escenarios

**Regla normativa:** Cada escenario tiene una reproducción sin servicios financieros reales.

**Trabajo específico:** Crear scenario plan, scheduler con reloj, eventos HMAC y outbox del dummy, replay/drop/reorder/timeout knobs protegidos; registrar D01–D17.

**Entregable esperado:** dummy scenario engine, control API y fixtures de escenarios.

**Dependencias:** T-PAY-02.

**AC-PAY-03 — prueba de aceptación:** D07 conserva sesión tras timeout; D09 reenvía un eventId tres veces; no autorizado no activa D13/D14.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-PAY-03. Estado inicial: `TODO`.

### REQ-PAY-04 / T-PAY-04 — Integrar PaymentProvider

**Regla normativa:** Comercio usa contrato remoto y estado verificado.

**Trabajo específico:** Implementar DummyPaymentProvider, worker de creación, inbox firmado y verificación GET antes de confirmar; normalizar sin propagar payload bruto.

**Entregable esperado:** commerce-api/payments/providers/dummy y handlers.

**Dependencias:** T-PAY-03, T-ORD-06.

**AC-PAY-04 — prueba de aceptación:** D01 confirma con livemode=false; D11/D12 no confirman; return URL falsa no muta estado.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-PAY-04. Estado inicial: `TODO`.

### REQ-PAY-05 / T-PAY-05 — Conciliar pendientes y registrar ledger

**Regla normativa:** Una transacción se registra una vez y nunca se borra para ocultar errores.

**Trabajo específico:** Implementar reconciler inmediato/periódico, ledger immutable, comparación referencias/importes y transacción con order/stock/outbox; índices únicos provider/account/transaction.

**Entregable esperado:** payment reconciliation jobs y transaction service.

**Dependencias:** T-PAY-04.

**AC-PAY-05 — prueba de aceptación:** D08 se recupera en siguiente barrido; D10 no revierte; D14 conserva dos ingresos y una incidencia de sobrepago.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-PAY-05. Estado inicial: `TODO`.

### REQ-PAY-06 / T-PAY-06 — Reembolsar y registrar disputas simuladas

**Regla normativa:** Reembolsos pendientes reservan el saldo reembolsable.

**Trabajo específico:** Crear refund request/approve/execute/status con lock financiero; dummy refunds, flags de disputa y eventos; evitar operaciones simultáneas por encima del capturado.

**Entregable esperado:** refund/dispute services y dummy endpoints.

**Dependencias:** T-PAY-05.

**AC-PAY-06 — prueba de aceptación:** Dos refund de 70 sobre 100: solo uno se acepta; failure no reduce net; success 30 deja PARTIALLY_REFUNDED.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-PAY-06. Estado inicial: `TODO`.

### REQ-PAY-07 / T-PAY-07 — Entregar harness completo de pagos

**Regla normativa:** La simulación prueba fallos de integración sin atajos en negocio.

**Trabajo específico:** Automatizar D01–D17 a través de HTTP/broker, detener procesos en puntos críticos, capturar eventId/orderId y comprobar estados/stock/notification count.

**Entregable esperado:** tests/e2e/payments-dummy y reporte por escenario.

**Dependencias:** T-PAY-06.

**AC-PAY-07 — prueba de aceptación:** Todos D01–D17 tienen resultado reproducible; ningún test paga por UPDATE directo a orders.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-PAY-07. Estado inicial: `TODO`.
