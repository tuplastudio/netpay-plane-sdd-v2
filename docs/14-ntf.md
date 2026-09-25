# SPEC-NTF — Notificaciones, recordatorios, timeline y métricas

Versión: 2.0. Estado: especificado; implementación pendiente.

## Notificación lógica e intentos

Notification una vez por tenant + eventId + recipient + purpose + channel. DeliveryAttempt representa solicitudes técnicas, con providerMessageId y estado. Finalidad QUOTE_LINK/ORDER_RECEIVED/PAYMENT_SIMULATED_SUCCESS/PAYMENT_SIMULATED_FAILED/REMINDER/HANDOFF. Payload se renderiza con snapshot de negocio; totales no vienen del LLM. Todas las notificaciones de pago incluyen modo simulado.

Recordatorio default a +2h y +24h respecto al primer envío aceptado del link, máximo dos por obligación de pago. No programar si no hay canal habilitado/cliente/evidencia requerida. Si caduca antes, descartar. Al enviar revalidar: tenant activo para nuevas comunicaciones, pedido no pagado/no cancelado, revisión/enlace vigente, consentimiento, horario 09–19 local, canal conectado, ventana/plantilla y ausencia de estado UNKNOWN.

Si la hora cae fuera de horario, mover al siguiente inicio permitido solo si continúa vigente. Job unique orderId/policyVersion/ordinal; al pago/cancel/baja/revisión reemplazada cancelar pendientes. El envío ocurre fuera de transacción: para carreras usar reservation de notificación y recheck inmediatamente previo al adapter. Una confirmación financiera posterior al envío físico no puede retirar un mensaje ya enviado; registrar `sentBeforePaymentVerified`, no prometer eliminación retroactiva ni exactamente una entrega física.

## Mensajes base

| Finalidad | Texto funcional de referencia |
| --- | --- |
| Cotización | “Tu cotización {folio}: {total} MXN. Revisa los productos: {link}. El pago es simulado.” |
| Pedido recibido | “Recibimos el pedido {folio}. Está pendiente de pago simulado. Revisa aquí: {link}.” |
| Éxito | “Pago simulado aprobado para el pedido {folio}, por {total} MXN. No se realizó un cobro real.” |
| Fallo | “La simulación de pago del pedido {folio} fue rechazada. Puedes revisar el pedido e intentarlo de nuevo: {link}.” |
| Recordatorio | “Tu pedido {folio} sigue pendiente de pago simulado. El enlace vence {localExpiry}: {link}. Puedes pedir que dejemos de recordártelo.” |
| Humano | “Un asesor continuará contigo. Tu solicitud quedó registrada.” |

Son borradores funcionales para plantillas de la aplicación; su disponibilidad/aprobación en Meta se verifica en el conector.

## Timeline y analítica

Timeline combina eventos sin sobrescribir timestamps: entidad, evento, actor, origen, occurredAt/receivedAt y correlación. Excluir secretos, raw payloads, razonamiento IA y datos fiscales. `link.requested` incluye bots/prefetch; `preview.interacted` requiere evento de interacción cliente y tampoco es prueba absoluta de identidad. No llamar “leído” a un GET.

| Métrica | Fórmula / unidad |
| --- | --- |
| Cotizaciones emitidas | Count de QuoteVersion ISSUED por issuedAt, excluye DRAFT. |
| Aceptación por cohorte | Versiones aceptadas / emitidas en cohorte de issuedAt, corte asOf visible. |
| Pedidos creados | Count orderId por createdAt, distingue UI/API/WhatsApp. |
| Conversión a pago simulado | Pedidos de cohorte createdAt con transacción verificada / pedidos de esa cohorte. |
| Ingresos simulados brutos | Suma transacciones SUCCEEDED por succeededAt, no órdenes. |
| Reembolsos simulados | Suma Refund SUCCEEDED por completedAt. |
| Neto simulado | Ingresos de intervalo −reembolsos de intervalo; no equivale a utilidad. |
| Pendientes | Saldo de órdenes no canceladas sin pago, asOf, distingue UNKNOWN. |
| Tiempo de cobro simulado | succeededAt primero −order.createdAt, mediana/p95. |
| Recuperación recordatorios | Pago posterior a recordatorio, atribución descriptiva, no causalidad probada. |
| Matching y atención | Clarificaciones, humanos, acierto en eval y costo modelo por conversación. |

Reportes filtros fecha local, canal, vendedor, origen; almacenamiento UTC y límites semiabiertos [from,to). Export CSV async >1,000 filas, máximo 100,000 por job, expiración descarga 24 h. Escapar fórmula CSV. Moneda única, livemode=false siempre; no mezclar pagos duplicados con número de pedidos vendidos.

## Requisitos, tareas y aceptación

### REQ-NTF-01 / T-NTF-01 — Crear renderizado y notificación lógica

**Regla normativa:** Mensaje conserva importes y modo de negocio verificados.

**Trabajo específico:** Crear templates locales con variables tipadas, unique notification key, render server-side y evento→purpose; diferencias IA/humano y payment simulated.

**Entregable esperado:** notification domain/templates.

**Dependencias:** T-WHA-07, T-PAY-07.

**AC-NTF-01 — prueba de aceptación:** Evento success repetido produce una Notification; texto contiene simulado y monto del ledger.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-NTF-01. Estado inicial: `TODO`.

### REQ-NTF-02 / T-NTF-02 — Enviar con intentos persistidos

**Regla normativa:** El sistema distingue reintento técnico de nuevo mensaje comercial.

**Trabajo específico:** Conectar dispatcher WHA, delivery attempts, errores retryable/permanent/unknown y DLQ; en UNKNOWN consultar cuando sea posible o intervención antes de reenviar.

**Entregable esperado:** notification workers y delivery log API.

**Dependencias:** T-NTF-01.

**AC-NTF-02 — prueba de aceptación:** Timeout no produce segundo envío automático ciego; proveedor accepted no marca read.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-NTF-02. Estado inicial: `TODO`.

### REQ-NTF-03 / T-NTF-03 — Programar recuperación

**Regla normativa:** El recordatorio solo sale si cumple condiciones al ejecutarse.

**Trabajo específico:** Crear scheduler +2/+24 desde primer envío, horarios/timezone, opt-out, cancel events y recheck; reprogramación sin duplicar ordinal.

**Entregable esperado:** reminder policy worker y scheduler tests.

**Dependencias:** T-NTF-02.

**AC-NTF-03 — prueba de aceptación:** Pago/baja antes de ejecución suprime mensaje; recordatorio 20:00 se mueve a 09:00 si link vigente; UNKNOWN pospone.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-NTF-03. Estado inicial: `TODO`.

### REQ-NTF-04 / T-NTF-04 — Construir timeline

**Regla normativa:** Eventos tardíos mantienen fecha original y recepción sin reescribir historia.

**Trabajo específico:** Crear proyección timeline con tipos permitidos, datos redacted, orden estable y paginación; diferenciar preview bot e interacción.

**Entregable esperado:** timeline read model y serializers.

**Dependencias:** T-NTF-03.

**AC-NTF-04 — prueba de aceptación:** Un evento de ayer recibido hoy muestra ambas fechas; no muestra tokens ni llama leído a prefetch.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-NTF-04. Estado inicial: `TODO`.

### REQ-NTF-05 / T-NTF-05 — Calcular reportes por cohorte

**Regla normativa:** Las métricas definen denominador, rango y modo simulado.

**Trabajo específico:** Crear queries/proyecciones de métricas de tabla, filtros y asOf; excluir duplicados lógicos y mantener sobrepagos como transacciones.

**Entregable esperado:** analytics module y dashboard DTO.

**Dependencias:** T-NTF-04.

**AC-NTF-05 — prueba de aceptación:** Fixture 10 pedidos/4 pagados/1 pago duplicado: conversión40%, cinco transacciones brutas y una incidencia.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-NTF-05. Estado inicial: `TODO`.

### REQ-NTF-06 / T-NTF-06 — Exportar y auditar

**Regla normativa:** Exportación obedece scopes y no filtra secretos.

**Trabajo específico:** Crear async exports CSV, límites, sanitización de fórmulas, ObjectStorage privado, expiración y auditoría del solicitante.

**Entregable esperado:** report export jobs.

**Dependencias:** T-NTF-05.

**AC-NTF-06 — prueba de aceptación:** Vendedor sin export financiero recibe403; CSV con nombre =formula se escapa; link expira a24h y solo tenant correcto descarga.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-NTF-06. Estado inicial: `TODO`.

### REQ-NTF-07 / T-NTF-07 — Recordatorio de cotización sin pagar

**Regla normativa:** El negocio decide si recuerda, cada cuánto y cuántas veces; el cliente decide si quiere recibirlo.

**Trabajo específico:** Nueva plantilla `QUOTE_REMINDER` con el nombre del negocio, el total, la fecha de vencimiento, el link público y el pie de opt-out. La programa `QuoteReminderService` (ver T-QTE-08) vía `scheduleFromTemplate`, así que hereda todo lo que ya aplicaba el dispatcher: consentimiento `CustomerConsent.WHATSAPP`, ventana 09-19 local del tenant y backoff. `scheduleFromTemplate` inyecta `businessName` desde el tenant para que ninguna plantilla salga sin identificar al remitente.

**Entregable esperado:** `notification-templates.ts` (clave nueva + pie de baja en las plantillas que inicia el negocio), columnas `Tenant.quoteReminder*` y `Quote.remindersSent/lastReminderAt`.

**Dependencias:** T-NTF-01, T-QTE-08.

**AC-NTF-07 — prueba de aceptación:** El texto de `QUOTE_REMINDER` contiene el nombre del negocio, el link y "Responde BAJA para dejar de recibir estos mensajes"; `PAYMENT_SIMULATED_SUCCESS` (respuesta a una acción del cliente) no lleva ese pie; `HANDOFF` (va a una persona del negocio) tampoco.

**Evidencia para cerrar:** `apps/commerce-api/tests/whatsapp-policy.test.ts`, bloque "plantillas", verde.
