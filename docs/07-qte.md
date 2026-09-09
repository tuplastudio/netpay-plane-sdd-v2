# SPEC-QTE — Cotizaciones, revisiones, aceptación, PDF y cobro rápido

Versión: 2.0. Estado: especificado; implementación pendiente.

## Agregado y comandos

Quote guarda folio por tenant, currentVersionId y origen UI/API/WHATSAPP. QuoteVersion tiene número incremental, state, cliente snapshot, moneda, líneas, precios/impuestos, delivery propuesta, totals, validUntil, conditionsVersion y calculationVersion. Solo DRAFT es editable; PATCH exige expectedVersion de concurrencia, diferente del número comercial de revisión. Una versión ISSUED conserva snapshot completo.

Estados: DRAFT → ISSUED → ACCEPTED/REJECTED/EXPIRED/CANCELED/SUPERSEDED. DRAFT → CANCELED también permitido. El previewHash valida precios antes de emisión; contentHash se calcula al emitir sobre el snapshot completo, incluidos términos y vigencia, y es el hash para aceptación pública. No reabrir una terminal. Revisión de ISSUED crea nuevo DRAFT y mantiene versión anterior hasta emitir la nueva; al emitir ambas transiciones y outbox son atómicas. Si la anterior ya fue ACCEPTED, editar el pedido sigue ORD; no emitir nueva quote que duplique silenciosamente la venta.

Emitir valida cliente si se enviará por canal, al menos una línea, conceptos ≤200, total >0, claves para variantes activas, permisos descuento, vigencia futura y disponibilidad informativa. El cálculo se repite dentro del comando con precio actualizado del borrador; el usuario revisa si cambió respecto al preview mediante `previewHash`. Hash diferente retorna PRICE_CHANGED con nueva propuesta, no emite silenciosamente.

La aceptación pública exige token válido, quoteVersionId, termsVersion, snapshotHash e idempotencia. Crea Order PENDING_PAYMENT y aceptación auditada en una transacción, índice único sobre quoteVersionId. Rechazo captura motivo opcional 500 caracteres. GET de URL nunca acepta. Aceptación por WhatsApp requiere respuesta inequívoca a un resumen concreto `confirmationRef`; si existe nueva revisión o contexto ambiguo, volver a mostrar resumen.

## Envío y representación

`issue` genera token aleatorio de 256 bits en claro una sola vez y hash persistido. Para reenviar, una URL existente puede reconstruirse solo desde secreto cifrado gestionado o rotarse; se elige V2: token cifrado en almacén de secretos de enlace, hash para lookup, revocable y con acceso solo al generador de notificaciones. No se puede “recuperar” un token desde su hash.

`send` crea Notification y 202; `ISSUED` no significa entregada. Vista portal distingue estado de cotización, entrega del mensaje e interacción. PDF comercial generado desde snapshot de versión, contiene marca, folio, datos mínimos, conceptos, SAT, totales, vigencia, condiciones y “Cotización; no es CFDI”. Pie visible “Pagos disponibles en modo simulado”. Archivo privado; regeneración idempotente por versión/templateVersion. No depender de que el navegador imprima correctamente.

## Cobro rápido

Concepto 1–300, importe string, taxProfile, taxMode, expiración y cliente opcional. V2 el importe de pantalla es **total final con impuesto incluido**; backend extrae base según perfil y muestra desglose antes de confirmar. Nunca interpreta a veces como subtotal. Cantidad fija 1, tipo FREE_FORM; sin registro falso de producto. Crear Order directo + OrderRevision + enlace. Si no hay teléfono solo se permite copiar enlace, no enviar WhatsApp. IA tiene FREE_FORM deshabilitado por defecto.

## Requisitos, tareas y aceptación

### REQ-QTE-01 / T-QTE-01 — Crear agregado y borrador

**Regla normativa:** Número comercial y control de concurrencia son campos distintos.

**Trabajo específico:** Crear Quote/Version/Items/Acceptance, folios transaccionales por tenant/año y comandos create/patch/duplicate con calculator; límite 200 líneas.

**Entregable esperado:** quotes schema y draft service.

**Dependencias:** T-PRC-06, T-CRM-05.

**AC-QTE-01 — prueba de aceptación:** Dos borradores obtienen folios únicos; PATCH con lockVersion vieja falla; duplicar no copia aceptación.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-QTE-01. Estado inicial: `TODO`.

### REQ-QTE-02 / T-QTE-02 — Emitir snapshot inmutable

**Regla normativa:** Publicación usa el cálculo que el vendedor revisó.

**Trabajo específico:** Implementar previewHash, issue con validación final y evento quote.issued; copiar datos catálogo/cliente/config; bloquear modificación de líneas emitidas.

**Entregable esperado:** issue command, quote serializers y tests snapshot.

**Dependencias:** T-QTE-01.

**AC-QTE-02 — prueba de aceptación:** Precio cambió tras preview: 409 PRICE_CHANGED; después de emitir, editar catálogo no altera quote.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-QTE-02. Estado inicial: `TODO`.

### REQ-QTE-03 / T-QTE-03 — Revisar, vencer y cancelar

**Regla normativa:** Solo una revisión emitida puede ser aceptable en cada momento.

**Trabajo específico:** Crear draft revision, supersede transaccional, expiry job y cancel/reject commands; al aceptar bloquear aggregate y comprobar revisión vigente.

**Entregable esperado:** quote lifecycle y cron durable.

**Dependencias:** T-QTE-02.

**AC-QTE-03 — prueba de aceptación:** Carrera aceptar/sustituir produce un ganador y 409 al otro; vencida no acepta; aceptada no se duplica por nueva revisión.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-QTE-03. Estado inicial: `TODO`.

### REQ-QTE-04 / T-QTE-04 — Aceptar y crear pedido

**Regla normativa:** Una aceptación produce un único pedido aunque llegue por dos canales.

**Trabajo específico:** Implementar token/hash/confirmationRef, consentimiento explícito y unique quoteVersion; snapshot → Order con order creator port; idempotencia de web/chat.

**Entregable esperado:** accept quote use case y adapter hacia orders.

**Dependencias:** T-QTE-03, T-ORD-01.

**AC-QTE-04 — prueba de aceptación:** Doble aceptación web/WhatsApp devuelve el mismo orderId; GET de preview produce cero pedidos.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-QTE-04. Estado inicial: `TODO`.

### REQ-QTE-05 / T-QTE-05 — Generar enlaces y envío

**Regla normativa:** Emitida, enviada y entregada son eventos diferentes.

**Trabajo específico:** Crear secretos de enlace cifrados, expiración/revocación, send command con notification port y estado consultable; no incluir tokens en auditoría.

**Entregable esperado:** quote links y notification request producer.

**Dependencias:** T-QTE-04.

**AC-QTE-05 — prueba de aceptación:** Reenviar conserva o rota enlace según comando explícito; 202 no muestra entregado; logs no contienen token.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-QTE-05. Estado inicial: `TODO`.

### REQ-QTE-06 / T-QTE-06 — Generar PDF comercial

**Regla normativa:** PDF refleja exactamente la revisión solicitada.

**Trabajo específico:** Crear plantilla HTML→PDF en worker aislado, escapar textos, paginar conceptos, repetir encabezado y totales; almacenamiento privado con URL temporal.

**Entregable esperado:** quote document job/template y fixtures de 1/200 líneas.

**Dependencias:** T-QTE-05.

**AC-QTE-06 — prueba de aceptación:** PDF de 200 líneas tiene contenido completo, totales idénticos al snapshot y etiquetas no-CFDI/simulado, sin corte de texto.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-QTE-06. Estado inicial: `TODO`.

### REQ-QTE-07 / T-QTE-07 — Crear cobro rápido

**Regla normativa:** Importe de cobro rápido es total incluido, no subtotal ambiguo.

**Trabajo específico:** Crear quick-charges command con FREE_FORM cantidad 1, extracción fiscal y orden/enlace atómicos; permitir cliente null y bloquear envío sin destino.

**Entregable esperado:** quick-charge API y fixtures 116 inclusive/100 no tax.

**Dependencias:** T-QTE-06.

**AC-QTE-07 — prueba de aceptación:** 116 al 16% produce base100/tax16; retry crea un pedido; concepto no aparece como producto del catálogo.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-QTE-07. Estado inicial: `TODO`.
