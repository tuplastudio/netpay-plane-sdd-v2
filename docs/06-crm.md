# SPEC-CRM — Clientes, contactos, consentimiento e historial

Versión: 2.0. Estado: especificado; implementación pendiente.

## Campos y reglas

Customer: displayName 1–160, email opcional con longitud máxima 254, phone E.164 opcional, status ACTIVE/ARCHIVED, notas privadas hasta 5,000 caracteres, externalRefs y version. Para contacto por WhatsApp se exige teléfono/identidad de canal, no email. Normalizar teléfono con país indicado; no adivinar país de números ambiguos. Historial público jamás se obtiene solo por teléfono.

ChannelIdentity: tenant, provider, connectionId, providerUserId, customerId. Identificador de canal único por conexión; cualquier coincidencia por teléfono es sugerencia, no merge automático entre cuentas. Si se cambia número, verificarlo mediante proceso explícito y conservar vínculo histórico. No unir clientes automáticamente por nombre o modelo IA.

Address: label, recipient, country MX, postalCode, region, city, locality opcional, street, exterior, interior opcional, instructions ≤300. Los pedidos copian snapshot; editar domicilio del cliente no cambia entrega de un pedido aceptado.

CommunicationConsent: purpose TRANSACTIONAL_REMINDER/MARKETING, channel WHATSAPP, status GRANTED/REVOKED, source, proofRef, occurredAt y policyVersion. V2 no ejecuta marketing. Recibir mensaje permite procesar conversación según reglas del canal, pero no se registra como consentimiento general para campañas. Solicitud BAJA/STOP/NO ME RECUERDES cancela recordatorios; mensaje ambiguo deriva a humano. Mensajes esenciales de una operación no se confunden con campañas; motor aplica política y reglas del proveedor.

Captura fiscal opcional para transferencia a sistema futuro: rfc, legalName, fiscalPostalCode, taxRegime, cfdiUse. No validar fiscalmente mediante suposiciones; validación de formato y catálogos configurados. Mostrar “datos para solicitud de factura; no emitida por esta plataforma”.

## Acciones

Crear/buscar/editar/archivar, vincular conversación, ver historial autorizado y consentimientos, gestionar direcciones. Rechazar eliminación física de cliente con pedidos; anonimización por job y retención en OPS. Notas internas nunca se envían al LLM ni al comprador. Endpoint de historial devuelve páginas, no todos los mensajes/audios sin límite.

## Requisitos, tareas y aceptación

### REQ-CRM-01 / T-CRM-01 — Crear cliente y direcciones

**Regla normativa:** Identidades comerciales y domicilio histórico se mantienen separados.

**Trabajo específico:** Implementar DTOs, normalización, índices, CRUD/version y snapshots de dirección en funciones de copia; archivar sin cascade.

**Entregable esperado:** customers module y Customer/Address schema.

**Dependencias:** T-IAM-06.

**AC-CRM-01 — prueba de aceptación:** Editar dirección no cambia snapshot ya copiado; teléfono ambiguo se rechaza; archivado sigue visible en historial.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-CRM-01. Estado inicial: `TODO`.

### REQ-CRM-02 / T-CRM-02 — Vincular identidades de canal

**Regla normativa:** No se fusionan personas por nombre o coincidencia débil.

**Trabajo específico:** Crear lookup connection/providerUser, vinculación explícita con auditoría, resolución de conflictos y cliente provisional para mensajes nuevos.

**Entregable esperado:** ChannelIdentity repository y customer resolver.

**Dependencias:** T-CRM-01.

**AC-CRM-02 — prueba de aceptación:** Dos conexiones con mismo nombre no se unen; reenviar mismo mensaje no crea segundo cliente provisional.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-CRM-02. Estado inicial: `TODO`.

### REQ-CRM-03 / T-CRM-03 — Gestionar consentimientos

**Regla normativa:** Una baja cancela recordatorios futuros y deja evidencia.

**Trabajo específico:** Crear consent commands y clasificación determinista de bajas inequívocas; publicar customer.reminders_opted_out; no activar marketing al crear cliente.

**Entregable esperado:** consent service y unsubscribe event.

**Dependencias:** T-CRM-02.

**AC-CRM-03 — prueba de aceptación:** BAJA revoca recordatorios de ese contacto/tenant; consentimiento anterior permanece como historial.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-CRM-03. Estado inicial: `TODO`.

### REQ-CRM-04 / T-CRM-04 — Exponer historial y búsqueda

**Regla normativa:** Cada vista muestra únicamente lo autorizado.

**Trabajo específico:** Agregar búsqueda paginada por nombre/teléfono normalizado, historial de quotes/orders/messages y campos fiscales ocultos por scope.

**Entregable esperado:** customers read API y projection.

**Dependencias:** T-CRM-03.

**AC-CRM-04 — prueba de aceptación:** Consulta por teléfono no devuelve otro tenant; público no consulta historial global; notas internas no aparecen en export comprador.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-CRM-04. Estado inicial: `TODO`.

### REQ-CRM-05 / T-CRM-05 — Gestionar datos fiscales y privacidad

**Regla normativa:** Captura no implica timbrado ni exposición al modelo.

**Trabajo específico:** Crear campos opcionales, validación sintáctica, máscara y serializers separados portal/público/agente; auditar lectura sensible si se habilita.

**Entregable esperado:** customer fiscal schema y serializers.

**Dependencias:** T-CRM-04.

**AC-CRM-05 — prueba de aceptación:** Prompt/tool response no incluye RFC ni notas privadas; interfaz no indica factura emitida.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-CRM-05. Estado inicial: `TODO`.
