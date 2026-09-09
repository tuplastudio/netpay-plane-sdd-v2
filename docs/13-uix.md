# SPEC-UIX — Interfaz mobile first con shadcn/ui, RHF y Sonner

Versión: 2.0. Estado: especificado; implementación pendiente.

## Implementación frontend

Componentes shadcn/ui encapsulados en packages/ui, Tailwind para tokens y layout. Formularios con React Hook Form y `@hookform/resolvers/zod`; Zod valida formato, API valida negocio. RHF `useFieldArray` para líneas/variantes y `Controller` para inputs controlados; IDs estables al reordenar. Sonner para feedback breve. TanStack Query maneja queries/mutations y Axios transporte; no son reemplazos de formularios.

Config Axios: mismo origen, credentials, timeout lectura 10 s; requestId y CSRF; sin log de body; sin retry automático de POST. Query retry máximo 2 solo GET transitorio; 401 cierra sesión/caché, 403 muestra permiso, 409 conserva borrador y ofrece recargar diff, 422 mapea fieldErrors a RHF. Dinero en formulario string y format al blur; no Number para total. AbortController cancela búsquedas anteriores; debounce 300 ms, queryKey con tenant/filtros/cursor.

Server Components para shell/datos iniciales autorizados; Client Components para RHF/tablas/chat. Ningún secreto de API, WhatsApp o OpenRouter usa NEXT_PUBLIC. No duplicar en Server Actions reglas que viven en NestJS.

## Navegación y tamaño

Base 320–767 px mobile; ≥768 tablet; ≥1024 escritorio. Objetivo principal 360/390 px, pero todo opera a 320. Bottom nav Inicio/Ventas/Catálogo/Chat/Más; sidebar desktop. Tabla de escritorio se convierte en tarjetas con labels en móvil. A 200% zoom no se pierde CTA ni total. Targets 44×44, foco visible, labels, aria-invalid y aria-live para errores/estado. Safe areas y teclado virtual respetados.

## Matriz de pantallas y acciones

| Ruta portal | Contenido | CTA / comportamiento |
| --- | --- | --- |
| /login, /recover, /reset, /mfa | Campos mínimos y errores uniformes | Entrar/recuperar/verificar; no enumerar cuenta. |
| /app | KPIs simulados, pendientes e incidencias | Nuevo cobro y nueva cotización. |
| /app/products | Search, estado, categoría, lista móvil | Nuevo/importar; filtros en Sheet. |
| /app/products/new y /{id} | Nombre, descripción, variantes, SAT, precio, medios | Guardar DRAFT/activar con errores por sección. |
| /app/customers y /{id} | Contacto, domicilios, consentimientos e historial | Editar; nota interna marcada privada. |
| /app/quotes y /{id} | Lista, versiones, entrega mensaje y timeline | Emitir/enviar/duplicar/revisar/cancelar. |
| /app/quotes/new | Cliente, selector variante, cantidad, descuento, entrega | Recalcular y emitir tras previewHash. |
| /app/quick-charge | Concepto, total incluido, perfil y destino | Generar enlace simulado. |
| /app/orders y /{id} | Conceptos, estado comercial/pago/entrega separados | Ver checkout, cancelar, preparar entrega según permisos. |
| /app/payments y /{id} | Intentos, ledger, conciliación y reembolsos | Conciliar/reembolsar simulado para finanzas. |
| /app/incidents y /{id} | Tipo, evidencia y recursos vinculados | Asignar/resolver con motivo. |
| /app/chat y /{id} | Mensajes, audio, carrito y humano/IA | Responder/tomar/retomar; contextual drawer en móvil. |
| /app/channels | Conexiones y health | Conectar oficial o Evolution/mostrar QR/desconectar. |
| /app/integrations | Keys, fuentes e imports | Crear/revocar; key una sola vez. |
| /app/webhooks | Subscripciones, eventos y entregas | Verificar/pausar/reintentar. |
| /app/reports | Cohortes, ventas simuladas y export | Filtrar fecha/canal, export autorizado. |
| /app/settings | Empresa, usuarios, reglas, plantillas | Guardar con versión y validación. |
| /app/audit | Actores, acciones, fechas | Filtrar/export scope; sin secretos. |

## Formularios específicos

ProductForm: pasos Datos→Variantes→Precio/SAT→Medios→Revisión, navegación sin perder borrador; RHF raíz compartida, useFieldArray variantes. QuoteForm: customer picker, líneas únicas por combinación variante/opciones, cantidad string, preview backend y resumen sticky; añadir misma variante incrementa cantidad solo tras validar step. Descuentos visibles según permisos. Errores STOCK/PRICE_CHANGED incluyen diferencias y acción explícita de recalcular.

QuickChargeForm: etiqueta “Total a simular”, concepto y tax profile; desglose base/impuesto del servidor. ChannelForm: selector proveedor muestra únicamente campos de su adapter; QR se muestra con expiración y estado accesible, no pedir keys Evolution al cliente final. WebhookForm: URL HTTPS, eventos y prueba, secreto solo modal al crear.

## Público

/q/{token}: marca, snapshot, vigencia, condiciones, CTA aceptar y continuar; opción rechazar. /p/{token}: resumen y estado. Checkout: contacto/entrega → revisión final diff → botón “Continuar al pago simulado” → dummy separado → resultado. Cambios aceptados por POST e idempotency key estable mientras se reintenta la misma acción. Bloqueo de doble clic mejora UX, pero backend asegura unicidad.

Etiquetas exactas: “Entorno de demostración: no se realizará ningún cobro real”; “Pago simulado aprobado”; “Pendiente de confirmación del simulador”; “Cotización vencida”; “El pedido cambió. Revisa el nuevo total”. No usar “Pago realizado” sin indicar simulación.

Estados universales: skeleton inicial, vacío con acción permitida, sin coincidencias distinto de catálogo vacío, error con retry, offline con borrador preservado y no confirmación, permiso insuficiente, conflicto de versión y timeout desconocido. Datos sensibles no se guardan en localStorage; borradores persistidos en servidor, o estado volátil de formulario durante navegación.

## Requisitos, tareas y aceptación

### REQ-UIX-01 / T-UIX-01 — Crear design system y shell

**Regla normativa:** Todas las pantallas comparten componentes y accesibilidad.

**Trabajo específico:** Instalar shadcn/ui y tokens Tailwind, RHF/Zod/Sonner providers, navbar/sidebar/bottom nav, theme y ErrorBoundary; librería de MoneyField/StatusBadge/EmptyState.

**Entregable esperado:** packages/ui y apps/web/app layouts.

**Dependencias:** T-INT-06, T-AIA-07.

**AC-UIX-01 — prueba de aceptación:** A 320/390/768/1280 px no hay overflow general; teclado/foco permiten abrir cerrar Sheet/Dialog.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-UIX-01. Estado inicial: `TODO`.

### REQ-UIX-02 / T-UIX-02 — Integrar API y formularios

**Regla normativa:** Errores backend se presentan sin perder datos del formulario.

**Trabajo específico:** Crear Axios client, CSRF, QueryClient tenant-aware, hooks y Zod serializers; mapear fieldErrors a RHF; notificar con Sonner y error persistente.

**Entregable esperado:** web/lib/api y shared form adapters.

**Dependencias:** T-UIX-01.

**AC-UIX-02 — prueba de aceptación:** 422 señala campo; 409 conserva input; retry POST mantiene idempotency key; cambio tenant limpia caché.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-UIX-02. Estado inicial: `TODO`.

### REQ-UIX-03 / T-UIX-03 — Construir acceso, catálogo y clientes

**Regla normativa:** Se puede operar alta de producto completa desde un teléfono.

**Trabajo específico:** Crear login/MFA/recovery, ProductForm, listado/cards, variantes/SAT/media/import y CustomerForm/historial usando APIs.

**Entregable esperado:** web/features/auth,catalog,customers y rutas.

**Dependencias:** T-UIX-02.

**AC-UIX-03 — prueba de aceptación:** En 360 px usuario autorizado crea/activa producto, importa mixto y ve errores por fila; rol catálogo no ve pagos.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-UIX-03. Estado inicial: `TODO`.

### REQ-UIX-04 / T-UIX-04 — Construir cotización y cobro rápido

**Regla normativa:** Vendedor revisa total backend antes de emitir enlace.

**Trabajo específico:** Crear QuoteForm field arrays, preview diff, versiones/timeline, PDF/compartir; QuickChargeForm total incluido y cliente opcional.

**Entregable esperado:** web/features/quotes,quick-charges.

**Dependencias:** T-UIX-03.

**AC-UIX-04 — prueba de aceptación:** Cotización de dos variantes se emite con preview correcto; cambio precio exige revisión; cobro sin teléfono solo copia enlace.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-UIX-04. Estado inicial: `TODO`.

### REQ-UIX-05 / T-UIX-05 — Construir checkout y operación financiera

**Regla normativa:** La vista previa siempre precede al simulador.

**Trabajo específico:** Crear public token pages, delivery/review, polling y resultado; portal orders/payments/incidents con acciones por estado y permisos.

**Entregable esperado:** web/features/checkout,orders,payments.

**Dependencias:** T-UIX-04.

**AC-UIX-05 — prueba de aceptación:** Recorrido móvil completo D01/D02/D07; retorno falso nunca muestra aprobado; total sticky no tapa campos con teclado.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-UIX-05. Estado inicial: `TODO`.

### REQ-UIX-06 / T-UIX-06 — Construir chat y conexiones

**Regla normativa:** Humano puede tomar control y conectar cada tipo de canal desde UI.

**Trabajo específico:** Crear inbox, paginación/audio/transcripción, controlVersion feedback, channel wizard oficial/Evolution, QR refresh y health badges.

**Entregable esperado:** web/features/chat,channels.

**Dependencias:** T-UIX-05.

**AC-UIX-06 — prueba de aceptación:** En teléfono se cambia lista/chat sin perder scroll; QR expirado se retira; respuesta humana pausa bot visiblemente.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-UIX-06. Estado inicial: `TODO`.

### REQ-UIX-07 / T-UIX-07 — Construir administración y reportes

**Regla normativa:** Permisos y modo simulado son visibles en la operación.

**Trabajo específico:** Crear integrations/webhooks/settings/users/audit/report/export y templates views; evitar que un toast sea el único registro del fallo.

**Entregable esperado:** web/features/integrations,settings,reports.

**Dependencias:** T-UIX-06, T-NTF-06.

**AC-UIX-07 — prueba de aceptación:** Admin crea destino y consulta entregas; finanzas exporta simulación; consulta no puede revocar keys.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-UIX-07. Estado inicial: `TODO`.

### REQ-UIX-08 / T-UIX-08 — Validar responsive y accesibilidad

**Regla normativa:** Un flujo no se considera listo solo por verse bien en escritorio.

**Trabajo específico:** Crear Playwright viewport matrix, axe y recorridos teclado/manual screen reader; screenshots de formularios largo/errores/QR/chat/checkout.

**Entregable esperado:** tests/e2e/mobile y evidencia visual por ruta crítica.

**Dependencias:** T-UIX-07.

**AC-UIX-08 — prueba de aceptación:** Todos flujos críticos operan a 320px y zoom200%; errores tienen label/foco; no hay CTA tapado ni secret en bundle.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-UIX-08. Estado inicial: `TODO`.
