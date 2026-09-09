# Backlog maestro y trazabilidad SDD V2

Cada tarea está especificada con regla, trabajo, entregable y aceptación en el archivo de su módulo. Estado inicial de todas: TODO; ninguna se presenta como implementada. No estimar horas hasta asignar equipo y conocer su capacidad. Las dependencias son técnicas, no fechas.

**Total: 90 tareas, 90 requisitos y 90 criterios de aceptación locales.** Además se incluyen 25 recorridos BDD de integración y 17 escenarios dummy.

## Matriz requisito → tarea → aceptación

| Requisito | Tarea | Trabajo | Responsable sugerido | Dependencias | Aceptación / especificación |
| --- | --- | --- | --- | --- | --- |
| REQ-FND-01 | T-FND-01 | Fijar repositorio y herramientas | Backend/arquitectura | — | [AC-FND-01](02-fnd.md) |
| REQ-FND-02 | T-FND-02 | Crear contrato canónico | Backend/arquitectura | T-FND-01 | [AC-FND-02](02-fnd.md) |
| REQ-FND-03 | T-FND-03 | Crear persistencia base | Backend/arquitectura | T-FND-02 | [AC-FND-03](02-fnd.md) |
| REQ-FND-04 | T-FND-04 | Implementar inbox/outbox | Backend/arquitectura | T-FND-03 | [AC-FND-04](02-fnd.md) |
| REQ-FND-05 | T-FND-05 | Implementar contexto y errores | Backend/arquitectura | T-FND-04 | [AC-FND-05](02-fnd.md) |
| REQ-FND-06 | T-FND-06 | Crear almacenamiento y jobs | Backend/arquitectura | T-FND-05 | [AC-FND-06](02-fnd.md) |
| REQ-IAM-01 | T-IAM-01 | Bootstrap y autenticación | Backend/seguridad | T-FND-06 | [AC-IAM-01](03-iam.md) |
| REQ-IAM-02 | T-IAM-02 | Recuperación y MFA | Backend/seguridad | T-IAM-01 | [AC-IAM-02](03-iam.md) |
| REQ-IAM-03 | T-IAM-03 | Aplicar matriz de permisos | Backend/seguridad | T-IAM-02 | [AC-IAM-03](03-iam.md) |
| REQ-IAM-04 | T-IAM-04 | Administrar empresa y usuarios | Backend/seguridad | T-IAM-03 | [AC-IAM-04](03-iam.md) |
| REQ-IAM-05 | T-IAM-05 | Gestionar API keys e identidad de servicios | Backend/seguridad | T-IAM-04 | [AC-IAM-05](03-iam.md) |
| REQ-IAM-06 | T-IAM-06 | Aislar persistencia y auditoría | Backend/seguridad | T-IAM-05 | [AC-IAM-06](03-iam.md) |
| REQ-CAT-01 | T-CAT-01 | Persistir producto y variantes | Backend catálogo | T-IAM-06 | [AC-CAT-01](04-cat.md) |
| REQ-CAT-02 | T-CAT-02 | Versionar catálogos SAT | Backend catálogo | T-CAT-01 | [AC-CAT-02](04-cat.md) |
| REQ-CAT-03 | T-CAT-03 | Implementar lifecycle y autoridad | Backend catálogo | T-CAT-02 | [AC-CAT-03](04-cat.md) |
| REQ-CAT-04 | T-CAT-04 | Construir búsqueda determinista | Backend catálogo | T-CAT-03 | [AC-CAT-04](04-cat.md) |
| REQ-CAT-05 | T-CAT-05 | Gestionar medios seguros | Backend catálogo | T-CAT-04 | [AC-CAT-05](04-cat.md) |
| REQ-CAT-06 | T-CAT-06 | Importar con dry-run y errores | Backend catálogo | T-CAT-05 | [AC-CAT-06](04-cat.md) |
| REQ-CAT-07 | T-CAT-07 | Exponer API completa del catálogo | Backend catálogo | T-CAT-06 | [AC-CAT-07](04-cat.md) |
| REQ-PRC-01 | T-PRC-01 | Implementar decimales y perfiles | Backend dominio | T-CAT-07 | [AC-PRC-01](05-prc.md) |
| REQ-PRC-02 | T-PRC-02 | Distribuir descuentos y calcular | Backend dominio | T-PRC-01 | [AC-PRC-02](05-prc.md) |
| REQ-PRC-03 | T-PRC-03 | Calcular entrega | Backend dominio | T-PRC-02 | [AC-PRC-03](05-prc.md) |
| REQ-PRC-04 | T-PRC-04 | Registrar stock y ajustes | Backend dominio | T-PRC-03 | [AC-PRC-04](05-prc.md) |
| REQ-PRC-05 | T-PRC-05 | Reservar carrito atómicamente | Backend dominio | T-PRC-04 | [AC-PRC-05](05-prc.md) |
| REQ-PRC-06 | T-PRC-06 | Resolver vencimiento y pago concurrente | Backend dominio | T-PRC-05 | [AC-PRC-06](05-prc.md) |
| REQ-CRM-01 | T-CRM-01 | Crear cliente y direcciones | Backend clientes | T-IAM-06 | [AC-CRM-01](06-crm.md) |
| REQ-CRM-02 | T-CRM-02 | Vincular identidades de canal | Backend clientes | T-CRM-01 | [AC-CRM-02](06-crm.md) |
| REQ-CRM-03 | T-CRM-03 | Gestionar consentimientos | Backend clientes | T-CRM-02 | [AC-CRM-03](06-crm.md) |
| REQ-CRM-04 | T-CRM-04 | Exponer historial y búsqueda | Backend clientes | T-CRM-03 | [AC-CRM-04](06-crm.md) |
| REQ-CRM-05 | T-CRM-05 | Gestionar datos fiscales y privacidad | Backend clientes | T-CRM-04 | [AC-CRM-05](06-crm.md) |
| REQ-QTE-01 | T-QTE-01 | Crear agregado y borrador | Backend ventas | T-PRC-06, T-CRM-05 | [AC-QTE-01](07-qte.md) |
| REQ-QTE-02 | T-QTE-02 | Emitir snapshot inmutable | Backend ventas | T-QTE-01 | [AC-QTE-02](07-qte.md) |
| REQ-QTE-03 | T-QTE-03 | Revisar, vencer y cancelar | Backend ventas | T-QTE-02 | [AC-QTE-03](07-qte.md) |
| REQ-QTE-04 | T-QTE-04 | Aceptar y crear pedido | Backend ventas | T-QTE-03, T-ORD-01 | [AC-QTE-04](07-qte.md) |
| REQ-QTE-05 | T-QTE-05 | Generar enlaces y envío | Backend ventas | T-QTE-04 | [AC-QTE-05](07-qte.md) |
| REQ-QTE-06 | T-QTE-06 | Generar PDF comercial | Backend ventas | T-QTE-05 | [AC-QTE-06](07-qte.md) |
| REQ-QTE-07 | T-QTE-07 | Crear cobro rápido | Backend ventas | T-QTE-06 | [AC-QTE-07](07-qte.md) |
| REQ-ORD-01 | T-ORD-01 | Crear pedidos y snapshots | Backend checkout | T-PRC-06, T-CRM-05 | [AC-ORD-01](08-ord.md) |
| REQ-ORD-02 | T-ORD-02 | Gestionar revisiones y entrega | Backend checkout | T-ORD-01 | [AC-ORD-02](08-ord.md) |
| REQ-ORD-03 | T-ORD-03 | Orquestar inicio de checkout | Backend checkout | T-ORD-02 | [AC-ORD-03](08-ord.md) |
| REQ-ORD-04 | T-ORD-04 | Implementar acceso público y resultado | Backend checkout | T-ORD-03 | [AC-ORD-04](08-ord.md) |
| REQ-ORD-05 | T-ORD-05 | Cancelar y controlar cumplimiento | Backend checkout | T-ORD-04 | [AC-ORD-05](08-ord.md) |
| REQ-ORD-06 | T-ORD-06 | Resolver incidencias y cerrar | Backend checkout | T-ORD-05 | [AC-ORD-06](08-ord.md) |
| REQ-PAY-01 | T-PAY-01 | Construir dummy y cuenta simulada | Backend simulador/pagos | T-FND-06 | [AC-PAY-01](09-pay.md) |
| REQ-PAY-02 | T-PAY-02 | Crear checkout simulado | Backend simulador/pagos | T-PAY-01 | [AC-PAY-02](09-pay.md) |
| REQ-PAY-03 | T-PAY-03 | Implementar eventos y escenarios | Backend simulador/pagos | T-PAY-02 | [AC-PAY-03](09-pay.md) |
| REQ-PAY-04 | T-PAY-04 | Integrar PaymentProvider | Backend simulador/pagos | T-PAY-03, T-ORD-06 | [AC-PAY-04](09-pay.md) |
| REQ-PAY-05 | T-PAY-05 | Conciliar pendientes y registrar ledger | Backend simulador/pagos | T-PAY-04 | [AC-PAY-05](09-pay.md) |
| REQ-PAY-06 | T-PAY-06 | Reembolsar y registrar disputas simuladas | Backend simulador/pagos | T-PAY-05 | [AC-PAY-06](09-pay.md) |
| REQ-PAY-07 | T-PAY-07 | Entregar harness completo de pagos | Backend simulador/pagos | T-PAY-06 | [AC-PAY-07](09-pay.md) |
| REQ-WHA-01 | T-WHA-01 | Normalizar conexiones y mensajes | Backend canales | T-CRM-05, T-FND-06 | [AC-WHA-01](10-wha.md) |
| REQ-WHA-02 | T-WHA-02 | Conectar Meta desde portal | Backend canales | T-WHA-01 | [AC-WHA-02](10-wha.md) |
| REQ-WHA-03 | T-WHA-03 | Conectar Evolution y QR | Backend canales | T-WHA-02 | [AC-WHA-03](10-wha.md) |
| REQ-WHA-04 | T-WHA-04 | Procesar inbound sin duplicados | Backend canales | T-WHA-03 | [AC-WHA-04](10-wha.md) |
| REQ-WHA-05 | T-WHA-05 | Enviar con políticas y trazabilidad | Backend canales | T-WHA-04 | [AC-WHA-05](10-wha.md) |
| REQ-WHA-06 | T-WHA-06 | Transferir atención y tiempo real | Backend canales | T-WHA-05 | [AC-WHA-06](10-wha.md) |
| REQ-WHA-07 | T-WHA-07 | Operar salud y compatibilidad | Backend canales | T-WHA-06 | [AC-WHA-07](10-wha.md) |
| REQ-AIA-01 | T-AIA-01 | Definir estado y persistencia del grafo | IA/Python | T-WHA-07, T-QTE-07, T-ORD-06 | [AC-AIA-01](11-aia.md) |
| REQ-AIA-02 | T-AIA-02 | Implementar ModelGateway | IA/Python | T-AIA-01 | [AC-AIA-02](11-aia.md) |
| REQ-AIA-03 | T-AIA-03 | Construir matching explicable | IA/Python | T-AIA-02 | [AC-AIA-03](11-aia.md) |
| REQ-AIA-04 | T-AIA-04 | Implementar tool gateway | IA/Python | T-AIA-03 | [AC-AIA-04](11-aia.md) |
| REQ-AIA-05 | T-AIA-05 | Procesar STT y TTS | IA/Python | T-AIA-04 | [AC-AIA-05](11-aia.md) |
| REQ-AIA-06 | T-AIA-06 | Coordinar turnos y handoff | IA/Python | T-AIA-05 | [AC-AIA-06](11-aia.md) |
| REQ-AIA-07 | T-AIA-07 | Crear suite de evaluación | IA/Python | T-AIA-06 | [AC-AIA-07](11-aia.md) |

> **Estado del bloque AIA (2026-09-07):** T-AIA-01..07 implementados en
> `apps/agent-service`. Evidencia en [`docs/11-aia.md`](11-aia.md) y en la suite
> de 120 casos (`python3 -m app.evals`, release PASS con las tres compuertas
> críticas). Dependencias añadidas al backend: `POST /pricing/preview`
> (calculadora oficial expuesta), principal de API key autorizado a emitir
> cotizaciones y pedidos, `POST /orders/from-quote/{id}` idempotente y puente
> WhatsApp→agente en `apps/commerce-api/src/whatsapp/agent-bridge.service.ts`.

| REQ-INT-01 | T-INT-01 | Registrar integraciones y referencias | Backend integraciones | T-PAY-07, T-CAT-07 | [AC-INT-01](12-int.md) |
| REQ-INT-02 | T-INT-02 | Sincronizar con control de conflictos | Backend integraciones | T-INT-01 | [AC-INT-02](12-int.md) |
| REQ-INT-03 | T-INT-03 | Suscribir endpoints verificables | Backend integraciones | T-INT-02 | [AC-INT-03](12-int.md) |
| REQ-INT-04 | T-INT-04 | Publicar con firma e inbox del receptor de prueba | Backend integraciones | T-INT-03 | [AC-INT-04](12-int.md) |
| REQ-INT-05 | T-INT-05 | Reprocesar y recuperar eventos | Backend integraciones | T-INT-04 | [AC-INT-05](12-int.md) |
| REQ-INT-06 | T-INT-06 | Certificar flujo externo | Backend integraciones | T-INT-05 | [AC-INT-06](12-int.md) |
| REQ-UIX-01 | T-UIX-01 | Crear design system y shell | Frontend | T-INT-06, T-AIA-07 | [AC-UIX-01](13-uix.md) |
| REQ-UIX-02 | T-UIX-02 | Integrar API y formularios | Frontend | T-UIX-01 | [AC-UIX-02](13-uix.md) |
| REQ-UIX-03 | T-UIX-03 | Construir acceso, catálogo y clientes | Frontend | T-UIX-02 | [AC-UIX-03](13-uix.md) |
| REQ-UIX-04 | T-UIX-04 | Construir cotización y cobro rápido | Frontend | T-UIX-03 | [AC-UIX-04](13-uix.md) |
| REQ-UIX-05 | T-UIX-05 | Construir checkout y operación financiera | Frontend | T-UIX-04 | [AC-UIX-05](13-uix.md) |
| REQ-UIX-06 | T-UIX-06 | Construir chat y conexiones | Frontend | T-UIX-05 | [AC-UIX-06](13-uix.md) |
| REQ-UIX-07 | T-UIX-07 | Construir administración y reportes | Frontend | T-UIX-06, T-NTF-06 | [AC-UIX-07](13-uix.md) |
| REQ-UIX-08 | T-UIX-08 | Validar responsive y accesibilidad | Frontend | T-UIX-07 | [AC-UIX-08](13-uix.md) |
| REQ-NTF-01 | T-NTF-01 | Crear renderizado y notificación lógica | Backend notificaciones/datos | T-WHA-07, T-PAY-07 | [AC-NTF-01](14-ntf.md) |
| REQ-NTF-02 | T-NTF-02 | Enviar con intentos persistidos | Backend notificaciones/datos | T-NTF-01 | [AC-NTF-02](14-ntf.md) |
| REQ-NTF-03 | T-NTF-03 | Programar recuperación | Backend notificaciones/datos | T-NTF-02 | [AC-NTF-03](14-ntf.md) |
| REQ-NTF-04 | T-NTF-04 | Construir timeline | Backend notificaciones/datos | T-NTF-03 | [AC-NTF-04](14-ntf.md) |
| REQ-NTF-05 | T-NTF-05 | Calcular reportes por cohorte | Backend notificaciones/datos | T-NTF-04 | [AC-NTF-05](14-ntf.md) |
| REQ-NTF-06 | T-NTF-06 | Exportar y auditar | Backend notificaciones/datos | T-NTF-05 | [AC-NTF-06](14-ntf.md) |
| REQ-OPS-01 | T-OPS-01 | Implementar hardening y secretos | Operación/QA/seguridad | T-UIX-08, T-NTF-06 | [AC-OPS-01](15-ops.md) |
| REQ-OPS-02 | T-OPS-02 | Implementar retención y privacidad | Operación/QA/seguridad | T-OPS-01 | [AC-OPS-02](15-ops.md) |
| REQ-OPS-03 | T-OPS-03 | Empaquetar Docker y deployment | Operación/QA/seguridad | T-OPS-02 | [AC-OPS-03](15-ops.md) |
| REQ-OPS-04 | T-OPS-04 | Instrumentar y alertar | Operación/QA/seguridad | T-OPS-03 | [AC-OPS-04](15-ops.md) |
| REQ-OPS-05 | T-OPS-05 | Ejecutar seguridad y carga | Operación/QA/seguridad | T-OPS-04 | [AC-OPS-05](15-ops.md) |
| REQ-OPS-06 | T-OPS-06 | Ensayar recuperación y liberación | Operación/QA/seguridad | T-OPS-05 | [AC-OPS-06](15-ops.md) |

## Orden de ejecución sin ciclos

Se eligieron dependencias conservadoras dentro de cada módulo para que una persona pueda ejecutar secuencialmente. Las tareas de una misma ronda no dependen entre sí y pueden asignarse a miembros distintos del equipo. Esto no indica que esta entrega haya usado agentes paralelos. El UI puede prototiparse antes contra contrato; cerrar sus tareas integradas requiere los servicios indicados.

- Ronda 01: T-FND-01.
- Ronda 02: T-FND-02.
- Ronda 03: T-FND-03.
- Ronda 04: T-FND-04.
- Ronda 05: T-FND-05.
- Ronda 06: T-FND-06.
- Ronda 07: T-IAM-01, T-PAY-01.
- Ronda 08: T-IAM-02, T-PAY-02.
- Ronda 09: T-IAM-03, T-PAY-03.
- Ronda 10: T-IAM-04.
- Ronda 11: T-IAM-05.
- Ronda 12: T-IAM-06.
- Ronda 13: T-CAT-01, T-CRM-01.
- Ronda 14: T-CAT-02, T-CRM-02.
- Ronda 15: T-CAT-03, T-CRM-03.
- Ronda 16: T-CAT-04, T-CRM-04.
- Ronda 17: T-CAT-05, T-CRM-05.
- Ronda 18: T-CAT-06, T-WHA-01.
- Ronda 19: T-CAT-07, T-WHA-02.
- Ronda 20: T-PRC-01, T-WHA-03.
- Ronda 21: T-PRC-02, T-WHA-04.
- Ronda 22: T-PRC-03, T-WHA-05.
- Ronda 23: T-PRC-04, T-WHA-06.
- Ronda 24: T-PRC-05, T-WHA-07.
- Ronda 25: T-PRC-06.
- Ronda 26: T-ORD-01, T-QTE-01.
- Ronda 27: T-ORD-02, T-QTE-02.
- Ronda 28: T-ORD-03, T-QTE-03.
- Ronda 29: T-ORD-04, T-QTE-04.
- Ronda 30: T-ORD-05, T-QTE-05.
- Ronda 31: T-ORD-06, T-QTE-06.
- Ronda 32: T-PAY-04, T-QTE-07.
- Ronda 33: T-AIA-01, T-PAY-05.
- Ronda 34: T-AIA-02, T-PAY-06.
- Ronda 35: T-AIA-03, T-PAY-07.
- Ronda 36: T-AIA-04, T-INT-01, T-NTF-01.
- Ronda 37: T-AIA-05, T-INT-02, T-NTF-02.
- Ronda 38: T-AIA-06, T-INT-03, T-NTF-03.
- Ronda 39: T-AIA-07, T-INT-04, T-NTF-04.
- Ronda 40: T-INT-05, T-NTF-05.
- Ronda 41: T-INT-06, T-NTF-06.
- Ronda 42: T-UIX-01.
- Ronda 43: T-UIX-02.
- Ronda 44: T-UIX-03.
- Ronda 45: T-UIX-04.
- Ronda 46: T-UIX-05.
- Ronda 47: T-UIX-06.
- Ronda 48: T-UIX-07.
- Ronda 49: T-UIX-08.
- Ronda 50: T-OPS-01.
- Ronda 51: T-OPS-02.
- Ronda 52: T-OPS-03.
- Ronda 53: T-OPS-04.
- Ronda 54: T-OPS-05.
- Ronda 55: T-OPS-06.

## Cortes verticales y gates

| Corte | Contenido | Tareas de salida / prueba |
| --- | --- | --- |
| Base contractual | Repositorio, contratos, persistencia y permisos | FND + IAM; G0/G1. |
| Venta local | Catálogo, precio, stock, cliente, quote y order | CAT/PRC/CRM/QTE/ORD; E2E01 sin atribuir pago real. |
| Simulador integral | Sesiones remotas, ledger, conciliación, refunds | PAY completo, D01–D17; G2. |
| Conversación | Meta/Evolution, humano, LangGraph y audio | WHA+AIA; fixtures y luego G3 live. |
| Ecosistema | API externa, webhooks y notificaciones | INT+NTF; E2E20–23. |
| Experiencia completa | Todas las pantallas y acciones mobile first | UIX completo; E2E24. |
| Operación | Hardening, carga, backup y restore | OPS completo; G4/G5. |

## Formato obligatorio de evidencia al cerrar una tarea

```text
Tarea: T-<MODULO>-<NUMERO>
Requisito: REQ-<MODULO>-<NUMERO>
Aceptación: AC-<MODULO>-<NUMERO>
SPEC/ADR: archivo y versión
Commit/PR: referencia real
Implementación: artefactos modificados
Pruebas: comando/caso y resultado real
Contrato/migración: versión y compatibilidad
Riesgos/incidencias: concretos o ninguno observado
Estado: REVIEW / DONE / BLOCKED
```

Los placeholders de este formato son campos a llenar durante implementación, no huecos de requisitos. No copiar IDs de ejemplo como evidencia de trabajo realizado. Cambios en regla requieren actualizar contrato, pruebas y tareas afectadas en la misma propuesta de cambio.
