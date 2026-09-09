# SPEC-ORD — Pedidos, revisiones de checkout y entrega

Versión: 2.0. Estado: especificado; implementación pendiente.

## Estado comercial y financiero

Order comercial PENDING_PAYMENT → CONFIRMED → CLOSED; PENDING_PAYMENT → CANCELED. Cancelar CONFIRMED exige flujo autorizado con incidencia/reembolso, no modificar directamente. Cumplimiento UNFULFILLED → PROCESSING → READY → SHIPPED → DELIVERED; pickup READY → DELIVERED. No iniciar cumplimiento sin pago confirmado y sin incidencia bloqueante. `CLOSED` requiere entrega terminada o cancelación/reembolso resueltos.

Resumen financiero derivado de PaymentTransactions/Refunds: UNPAID, PENDING, PAID, PARTIALLY_REFUNDED, REFUNDED. Disputas son bandera/entity independiente `hasOpenDispute`, no reemplazan balance. V2 corrige la sobrecarga del enum de V1. Due=total de revisión pagada; received=sum exitosos; refunded=sum reembolsos exitosos; net=received-refunded. Sobrepago existe si received>due; nunca se reduce borrando una transacción.

## Revisiones de checkout

OrderRevision: orderId, revisionNo, line snapshots, delivery, totals, termsVersion, contentHash, state DRAFT/ACCEPTED/LOCKED/REPLACED. Al aceptar cotización se crea revisión con productos congelados. Antes del pago puede cambiar entrega por POST prepare-checkout: crea nueva revisión con envío recalculado, deja productos/precios congelados. UI muestra diff y total. POST confirm-checkout acepta contentHash exacto; luego reserva e inicia intento.

Si existe PaymentAttempt PENDING/UNKNOWN, bloquear cambios; primero cancelar sesión y verificar estado. Dummy soporta cancelación. Una sesión confirmada pagada bloquea nuevas revisiones comerciales. Si varían productos/cantidades antes del pago, vendedor crea una revisión de pedido con aceptación nueva; V2 comprador no edita cantidades directamente. Este camino no crea otra cotización ni otro orderId.

## Saga de inicio de pago

1. Validar token/sesión comprador, revisión/hash, fecha y permisos.
2. Transacción: bloquear order, aceptar revisión, reservar stock, crear intento CREATED con operationKey y payment.create.requested outbox.
3. Worker llama dummy con key estable; timeout ambiguo → UNKNOWN y conciliación, no repetir con nueva key.
4. Registrar sessionId/URL/expiry y pasar PENDING; si expiró la revisión durante llamada, cancelar sesión y liberar según resultado verificado.
5. Frontend obtiene 202 y consulta checkout status hasta obtener redirectUrl.
6. Si fallo definitivo de creación, liberar reserva y permitir nuevo intento. Si desconocido, conservar hasta resolver o incidencia; worker de reservas respeta este estado y política de expiración.

## Seguridad pública y UX

`/q/{token}` y `/p/{token}` muestran resumen mínimo. Primer acceso establece sesión de comprador HttpOnly vinculada al recurso; el token sigue siendo capability revocable, no identidad fuerte. Para cambiar contacto/domicilio ya almacenado, se pide verificación adicional vía código al canal registrado; para primer checkout el comprador introduce sus propios datos. Si no hay canal verificado y ya hay datos sensibles, derivar modificación al vendedor.

Resultado `/checkout/result` usa checkout session, consulta backend y muestra “Pago simulado aprobado”, “Simulación pendiente” o “Simulación rechazada”. Query `success=true` no tiene autoridad. Poll inicial cada 2 s por 30 s, luego 10 s hasta 5 min; después botón consultar y seguimiento asincrónico. No spinner indefinido.

Token vencido/revocado devuelve 410 público con mensaje sin detalle del cliente. Enlace consumido por pago permite recibo simulado mientras siga vigente pero no crear otro intento. Acción de revocar bloquea lectura futura; no cancela sesión dummy por sí sola.

## Requisitos, tareas y aceptación

### REQ-ORD-01 / T-ORD-01 — Crear pedidos y snapshots

**Regla normativa:** Pedidos directos y provenientes de cotización usan el mismo agregado.

**Trabajo específico:** Crear Order/Items/Revision, unique quoteVersion, create API y timeline; validar referencias externas y modo simulado; order creator usado por QTE.

**Entregable esperado:** orders schema y OrderFactory.

**Dependencias:** T-PRC-06, T-CRM-05.

**AC-ORD-01 — prueba de aceptación:** Quote aceptada y quick charge producen estructura equivalente; misma externalId no duplica pedido.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-ORD-01. Estado inicial: `TODO`.

### REQ-ORD-02 / T-ORD-02 — Gestionar revisiones y entrega

**Regla normativa:** Cambios en envío requieren nueva aceptación y no mutan intentos activos.

**Trabajo específico:** Implementar prepare revision/diff/contentHash y accept; bloquear PENDING/UNKNOWN y preservar precio comercial de quote.

**Entregable esperado:** checkout revision service y endpoints.

**Dependencias:** T-ORD-01.

**AC-ORD-02 — prueba de aceptación:** Cambiar dirección muestra nuevo total; confirmar hash antiguo falla; intento activo bloquea cambio.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-ORD-02. Estado inicial: `TODO`.

### REQ-ORD-03 / T-ORD-03 — Orquestar inicio de checkout

**Regla normativa:** Reserva e intento nacen juntos; llamada externa ocurre tras commit.

**Trabajo específico:** Crear saga outbox de start, estados consultables y compensación según resultado; port PaymentProvider y reserva PRC; worker idempotente.

**Entregable esperado:** checkout orchestrator y payment.create consumer.

**Dependencias:** T-ORD-02.

**AC-ORD-03 — prueba de aceptación:** Caer después de reservar no pierde el intento; reanudar emite un único comando lógico al PaymentProvider fixture. Integración dummy se verifica en PAY-04/PAY-07.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-ORD-03. Estado inicial: `TODO`.

### REQ-ORD-04 / T-ORD-04 — Implementar acceso público y resultado

**Regla normativa:** URL pública no puede modificar importes ni acceder a otros recursos.

**Trabajo específico:** Crear token middleware, sesión comprador, verificación adicional, DTO mínimo, preview/result polling; GET sin side effects y noindex.

**Entregable esperado:** public API, token guard y redacted serializers.

**Dependencias:** T-ORD-03.

**AC-ORD-04 — prueba de aceptación:** success=true no paga; token de quote A no consulta order B; prefetch no acepta ni reserva.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-ORD-04. Estado inicial: `TODO`.

### REQ-ORD-05 / T-ORD-05 — Cancelar y controlar cumplimiento

**Regla normativa:** Entrega depende de pago verificado y ausencia de incidencia.

**Trabajo específico:** Implementar cancel unpaid con cancel provider job, fulfillment transitions, roles y tracking opcional; pickup salta envío.

**Entregable esperado:** order lifecycle y fulfillment commands.

**Dependencias:** T-ORD-04.

**AC-ORD-05 — prueba de aceptación:** No pagado no puede pasar PROCESSING; cancel pending no borra intento; pickup READY→DELIVERED es válido.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-ORD-05. Estado inicial: `TODO`.

### REQ-ORD-06 / T-ORD-06 — Resolver incidencias y cerrar

**Regla normativa:** Pago tardío/sobrepago conserva evidencia y bloquea entrega automática.

**Trabajo específico:** Crear Incident OPEN/IN_REVIEW/RESOLVED, tipos LATE_PAYMENT/OVERPAYMENT/STOCK_MISSING, resolución cumplir/reembolsar autorizada; cierre y auditoría.

**Entregable esperado:** incidents module y finance resolution commands.

**Dependencias:** T-ORD-05.

**AC-ORD-06 — prueba de aceptación:** Pago en cancelada crea incidencia; resolución sin motivo no cierra; dos pagos no generan dos entregas.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-ORD-06. Estado inicial: `TODO`.
