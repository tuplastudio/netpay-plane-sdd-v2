# SPEC-WHA — WhatsApp oficial, Evolution QR y bandeja humana

Versión: 2.0. Estado: especificado; implementación pendiente.

## Contrato común y modelo

WhatsAppProvider: startConnection, getConnectionState, disconnect, sendText, sendTemplate, sendAudio, sendDocument, normalizeWebhook y getCapabilities. QR solo si supportsQr. Respuesta send: providerMessageId opcional, status ACCEPTED/UNKNOWN/REJECTED, providerError normalizado; ACCEPTED no significa DELIVERED.

Connection tiene tenant, type META_CLOUD/EVOLUTION_BAILEYS, externalAccountRef, phoneIdentity, secretRef, state, stateVersion, lastInboundAt, lastHealthAt. Estados NOT_CONFIGURED, PENDING_AUTHORIZATION, QR_REQUIRED, CONNECTING, CONNECTED, DEGRADED, DISCONNECTED, ERROR. QR_REQUIRED no se usa para el adaptador Meta directo. Un phoneIdentity solo tiene un emisor activo por tenant; migración exige desactivar conexión anterior y preservar conversación.

Conversation: connectionId/customerId/threadId/state/controlVersion/assignedUserId/lastMessageAt. Message: providerId, direction IN/OUT, kind TEXT/AUDIO/DOCUMENT/IMAGE/UNSUPPORTED, status QUEUED/ACCEPTED/DELIVERED/READ/FAILED/UNKNOWN, timestamp del proveedor y receivedAt. Mensajes relacionados por replyToProviderId; raw payload cifrado limitado, no en logs. No retroceder READ a DELIVERED por evento fuera de orden.

## Meta Cloud API

Panel permite alta oficial mediante Embedded Signup cuando configuración/app esté habilitada, o conexión administrativa con WABA/phone ID/token para cuenta propia. Auth state aleatorio contra CSRF, callback ligado a usuario/tenant, intercambio de credenciales server-side y validación de cuenta/número. App secrets nunca se copian a JS público. Suscribir webhooks, completar challenge y probar recepción/envío antes de CONNECTED.

Verificar firma oficial del webhook con raw body según versión Meta adoptada, y challenge con verify token separado. Cada binding de phone number determina tenant; un tenantId enviado en evento no tiene autoridad.

Regla funcional: mantener ventana de atención a partir de mensajes entrantes válidos; fuera de ventana se usan plantillas elegibles. Consultar política/estado al enviar. Catálogo de plantillas guarda nombre, idioma, variables tipadas, propósito y aprobación. Sin plantilla permitida: BLOCKED_POLICY + acción al operador, no envío libre. Fuente técnica: documentación Meta enlazada en informe de revisión; no se promete aprobación de plantillas ni coexistencia universal.

## Evolution por QR

El adaptador seleccionado usa instancia Baileys; el repositorio Evolution también soporta Cloud API, pero eso no convierte el QR en el alta oficial. Fijar release y contrato real antes de integrar; prueba captura ejemplos sanitizados de conexión/eventos. No se inventan rutas externas como si ya hubieran sido comprobadas.

Crear instancia con nombre opaco tenant/connection, credencial guardada en servidor; obtener QR y emitir a UI autorizada por consulta o SSE. QR temporal no se registra en auditoría, caché compartida ni analytics. Al conectar, comparar número reportado con el autorizado, borrar QR y activar estado. Si cambió número, detener y pedir reconexión/validación del propietario desde la plataforma.

Runtime Evolution con volumen persistente, una instancia activa propietaria de cada sesión y política de reinicio; evitar dos replicas usando la misma sesión. Health cada 60 s, alerta después de 3 fallos. Disconnect revoca sesión y pausa notificaciones del canal; mensajes pendientes permanecen con TTL para reintentar tras reconectar.

Webhook Evolution se autentica con el mecanismo disponible en release elegido. Si carece de firma propia, usar gateway privado/restricción de red y secreto dedicado, no aceptar tráfico anónimo público. Límites y verificación son pruebas de contrato de adapter, no equivalentes a la firma de Meta.

## Entrada, salida y concurrencia

Ingress verifica → persiste inbox → 202; worker normaliza, deduplica por connection/providerMessageId, resuelve cliente y agenda grafo. Eventos delivery no ejecutan agente. Mensajes `fromMe`, grupos y broadcasts no disparan compras en V2; mostrar UNSUPPORTED donde proceda. Mensaje nuevo mientras IA trabaja se serializa por conversation; consolidación opcional 800 ms con límite 3 s, sin perder IDs.

Tomar atención humana usa compare-and-swap controlVersion e incrementa versión. IA revisa versión al planificar **y al publicar** mensaje. Outbox de bot incluye expectedControlVersion; worker descarta si cambió. Retomar exige acción explícita, resumen operativo y descartar respuestas caducadas. No guardar razonamiento interno del modelo.

SSE autenticado para inbox/QR con event ID y reconexión; en móvil polling como fallback 10 s. Seleccionar conversación carga últimos 50 mensajes y paginación hacia atrás. Audio se reproduce con URL temporal y transcripción textual. Operador no puede marcar manualmente un pago como exitoso desde el chat.

## Requisitos, tareas y aceptación

### REQ-WHA-01 / T-WHA-01 — Normalizar conexiones y mensajes

**Regla normativa:** Proveedor no contamina el dominio de conversaciones.

**Trabajo específico:** Crear contratos, capabilities, Connection/Message/Conversation y raw-event schemas con estados; fixtures Meta/Evolution separados.

**Entregable esperado:** whatsapp ports, models y fixtures de contrato.

**Dependencias:** T-CRM-05, T-FND-06.

**AC-WHA-01 — prueba de aceptación:** Evento de cada proveedor produce mismo modelo normalizado; ACK delivery no crea AgentRun.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-WHA-01. Estado inicial: `TODO`.

### REQ-WHA-02 / T-WHA-02 — Conectar Meta desde portal

**Regla normativa:** CONNECTED requiere cuenta/número verificados y prueba funcional.

**Trabajo específico:** Implementar onboarding state/callback server-side o alta administrativa, secret store, challenge, firma, subscription y diagnóstico de permisos.

**Entregable esperado:** MetaCloudAdapter y connection onboarding API.

**Dependencias:** T-WHA-01.

**AC-WHA-02 — prueba de aceptación:** State ajeno falla; firma inválida rechazada; fixture pasa y prueba real envía/recibe antes de cerrar gate LIVE-META.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-WHA-02. Estado inicial: `TODO`.

### REQ-WHA-03 / T-WHA-03 — Conectar Evolution y QR

**Regla normativa:** QR es temporal, aislado y solo visible al administrador de su tenant.

**Trabajo específico:** Fijar release, mapear rutas reales, crear instancia/QR/status/logout, validar número, secrets y protección del webhook; Compose profile persistente.

**Entregable esperado:** EvolutionBaileysAdapter y contrato capturado de release.

**Dependencias:** T-WHA-02.

**AC-WHA-03 — prueba de aceptación:** QR caduca sin quedar en logs; otro tenant obtiene 404; reconexión conserva mensajes; gate LIVE-EVO requiere escaneo real.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-WHA-03. Estado inicial: `TODO`.

### REQ-WHA-04 / T-WHA-04 — Procesar inbound sin duplicados

**Regla normativa:** Un mensaje lógico se procesa una vez aunque se reenvíe.

**Trabajo específico:** Integrar inbox/normalizador/resolver CRM, locks por conversación, dedup, orden receivedAt y filtros fromMe/grupos; job duradero.

**Entregable esperado:** message ingress consumers.

**Dependencias:** T-WHA-03.

**AC-WHA-04 — prueba de aceptación:** Webhook repetido 3 veces genera un Message y un comando agente; un audio conserva mediaRef sin descargarse en ingress.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-WHA-04. Estado inicial: `TODO`.

### REQ-WHA-05 / T-WHA-05 — Enviar con políticas y trazabilidad

**Regla normativa:** Una respuesta aceptada por proveedor no se reporta entregada.

**Trabajo específico:** Implementar send dispatcher, política ventana/plantilla, provider errors, UNKNOWN y actualización monotónica delivery; límites por conexión.

**Entregable esperado:** outbound adapter handlers y template registry.

**Dependencias:** T-WHA-04.

**AC-WHA-05 — prueba de aceptación:** Fuera de ventana sin plantilla bloquea; timeout no reenvía ciegamente; READ no retrocede por receipt viejo.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-WHA-05. Estado inicial: `TODO`.

### REQ-WHA-06 / T-WHA-06 — Transferir atención y tiempo real

**Regla normativa:** Un humano toma control sin competir con respuestas atrasadas.

**Trabajo específico:** Crear assign/handoff/resume con controlVersion, revisar guard antes de envío, SSE filtrado y paginación de conversación; auditoría.

**Entregable esperado:** conversation control API y realtime stream.

**Dependencias:** T-WHA-05.

**AC-WHA-06 — prueba de aceptación:** Humano toma chat mientras LLM tarda: resultado IA no se envía; SSE de A nunca emite conversación B.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-WHA-06. Estado inicial: `TODO`.

### REQ-WHA-07 / T-WHA-07 — Operar salud y compatibilidad

**Regla normativa:** Desconexión no pierde pedidos ni pagos.

**Trabajo específico:** Crear health job, alertas, TTL de mensajes, reconexión y pruebas de ambos canales con matriz capabilities; exponer estado/motivo sin secretos.

**Entregable esperado:** channel health worker y runbook.

**Dependencias:** T-WHA-06.

**AC-WHA-07 — prueba de aceptación:** Reiniciar Evolution permite recuperar sesión persistente; UI indica desconectado; conciliación dummy continúa.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-WHA-07. Estado inicial: `TODO`.
