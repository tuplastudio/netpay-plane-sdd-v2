# Revisión de cobertura, correcciones y criterios de completitud

## Resultado de la revisión de V1

Se reemplazó el documento general por especificaciones de dominio y trabajo trazable. La auditoría de esta entrega verifica cobertura y consistencia documental. No se ejecutaron builds, contratos reales, pruebas de WhatsApp/OpenRouter ni pagos de una aplicación porque esta entrega es de diseño y tareas.

| Hallazgo en V1 | Cierre en V2 | Referencia |
| --- | --- | --- |
| UI kit pendiente | shadcn/ui confirmado; capa de componentes y formularios definida. | ADR-002, UIX. |
| “Zoner” ambiguo | Sonner confirmado, feedback transitorio más errores persistentes. | ADR-002, UIX-02. |
| “Create Hooks” mal interpretado | React Hook Form confirmado; Query separado como estado remoto. | ADR-003/004. |
| Dependencia de pasarela comercial | DUMMY única, servicio propio y cero credenciales financieras reales. | ADR-005, PAY. |
| Dummy podría resolverse con botón que cambia DB | Contrato remoto, webhooks firmados y verificación por GET; no UPDATE comercial directo. | PAY-01/04. |
| Importe libre podía ser subtotal o total | Cobro rápido total incluido y desglose determinista. | QTE-07. |
| Cambio de envío después de aceptar | OrderRevision con hash, diff y aceptación nueva; bloqueo por intento activo. | ORD-02. |
| Precio después de preview | previewHash antes de issue y snapshot comercial inmutable. | QTE-02. |
| Hash de enlace no permite reenviar URL | Hash lookup más token cifrado referenciado, acceso limitado y revocación. | QTE-05. |
| Riesgo de duplicar quote/pedido | Unique quoteVersion y CAS en aceptación/revisión. | QTE-03/04, ORD-01. |
| Cancelar URL no cancela sesión | Revocación local separada de cancelación proveedor y conciliación tardía. | ORD/PAY. |
| Inventario externo indeterminado | Contrato definido, LOCAL/NONE ejecutables; EXTERNAL no se activa sin adaptador. | ADR-012, PRC. |
| Impuestos sin precisión operativa | MONEY-V2, redondeo, inclusivos/exclusivos, reparto y fixtures. | PRC. |
| Pago y disputa mezclados en un enum | Ledger, resumen financiero y disputa separada. | ORD, datos. |
| Eventos tardíos/duplicados | Inbox/outbox, locks y D07–D17. | FND/PAY. |
| Automatización vs atención humana | controlVersion al planificar y enviar, CAS y handoff. | WHA/AIA. |
| Matching semántico con umbral arbitrario | Fuzzy siempre aclara; autoelección exacta determinista. | AIA-03. |
| TTS confundido con lectura de voz | STT entrante y TTS saliente, límites/fallback independientes. | AIA-05. |
| Dependencias de proveedor podían parecer verificadas | Gates fixture y live separados; sin credenciales no se marca PASS. | OPS/G3. |
| Falta de tareas implementables | Trabajo/entregable/dependencia/AC en cada SPEC; backlog con DAG verificado. | 18-backlog-y-trazabilidad.md. |
| Tabla de entidades poco precisa | Diccionario SQL, constraints, índices y transiciones. | 16-modelo-datos-y-transiciones.md. |
| Métricas sin denominador | Cohortes, timestamp, asOf y distinción entre transacciones/pedidos. | NTF-05. |

## Cobertura de los apartados originales

| Apartado V1 | Especificación V2 principal | Tareas/validación |
| --- | --- | --- |
| 1 Objetivo/alcance | Constitución + índice | Baseline y exclusiones explícitas. |
| 2 Supuestos | Constitución ADR-001–018 | Correcciones del usuario resueltas. |
| 3 Reglas de dominio | PRC/QTE/ORD/PAY | AC por comando + BDD. |
| 4 Actores/permisos | IAM | IAM-01–06. |
| 5.1 Empresa | IAM | IAM-04. |
| 5.2 Productos | CAT/PRC | CAT-01–07; PRC. |
| 5.3 Clientes | CRM | CRM-01–05. |
| 5.4 Cotizaciones | QTE | QTE-01–06. |
| 5.5 Cobro rápido | QTE | QTE-07. |
| 5.6 Pedidos | ORD | ORD-01–06. |
| 5.7 Pagos | PAY | PAY-01–07 y D01–D17. |
| 5.8 Seguimiento | NTF | NTF-03/04/05. |
| 5.9 Conversaciones | WHA/AIA | WHA-06 y AIA-06. |
| 5.10 Integraciones | INT | INT-01–06. |
| 6 Flujos | QTE/ORD/WHA + BDD | E2E01–25. |
| 7 Estados | Diccionario + specs propietarias | Transiciones/guardas. |
| 8 Cálculo/stock | PRC | M01–M05, E2E05/06. |
| 9 WhatsApp | WHA | Dos conectores y gates live. |
| 10 Agente | AIA | Grafo, tools, audio, eval120. |
| 11 Arquitectura | FND/OPS | FND-01–06. |
| 12 Datos | Diccionario SQL | FND-03 y migraciones módulo. |
| 13 API | Contratos | FND-02 + controllers módulo. |
| 14 Webhooks | INT/PAY/WHA | Firmas y contratos separados. |
| 15 E-commerce/custom | INT | Ownership/upsert/external refs. |
| 16 UI | UIX | UIX-01–08 y matriz rutas. |
| 17 Seguridad | IAM/OPS | Cross-tenant/MFA/SSRF/PII. |
| 18 Operación | OPS | Docker, observabilidad, restore. |
| 19 Pruebas | AC locales + BDD | Gates G0–G5. |
| 20 Fases | Backlog | Orden técnico sin ciclos. |
| 21 Ampliaciones | Constitución | Fuera de alcance deliberado. |
| 22 Decisiones pendientes | Constitución + gates | No quedan nombres de librería/pasarela ambiguos. |
| 23 Fuentes | Este informe | Documentación primaria y límites de verificación. |

## Riesgos controlados y límites explícitos

No existe garantía de exactly-once física en WhatsApp o HTTP externo; existe deduplicación lógica y tratamiento UNKNOWN. No se promete retiro de un mensaje ya enviado ni cancelación retroactiva de una sesión que pagó. La demostración dummy permite ensayar esas condiciones.

La capa genérica API/webhooks permite integración, pero no significa que un conector nativo de cada ERP/e-commerce exista. Inventario EXTERNAL y una futura pasarela real requieren nueva SPEC de adaptador y pruebas propias. Esta definición evita entregar botones con comportamiento falso como si completaran una integración.

La política de impuestos es comercial de alcance restringido y explícito; no pretende resolver timbrado o todo régimen fiscal mexicano. No se presenta una clave de fixture como clave SAT válida. No se cargan datos personales reales por defecto.

Versiones de librerías y formatos externos se fijan con tarea de compatibilidad reproducible, no con “latest” ni números inventados. Credenciales y aprobación de Meta son factores externos verificables. Si faltan, el equipo completa fixtures/core y deja gate live bloqueado con motivo; no un hueco de lógica de negocio.

## Fuentes primarias consultadas

Fecha de revisión: 8 de septiembre de 2026. Estas fuentes verifican capacidades generales; contratos internos, tablas, tareas, reglas de precios, tiempos, quotas y simulador son decisiones de diseño de V2, no especificaciones atribuidas a proveedores.

- [shadcn/ui: formularios con React Hook Form y Zod](https://ui.shadcn.com/docs/forms/react-hook-form). Sustenta integración de formularios; el diseño de pantallas de UIX es propio.
- [React Hook Form: useForm](https://react-hook-form.com/docs/useform). Referencia del manejo de formularios y resolvers.
- [Sonner](https://sonner.emilkowal.ski/). Librería seleccionada explícitamente por el usuario.
- [Next.js App Router](https://nextjs.org/docs/app). Referencia de frontend; no implica que los procesos largos deban correr en Route Handlers.
- [LangGraph: persistencia](https://docs.langchain.com/oss/python/langgraph/persistence). Sustenta checkpoints; idempotencia comercial es requisito propio.
- [OpenRouter: STT](https://openrouter.ai/docs/guides/overview/multimodal/stt) y [TTS](https://openrouter.ai/docs/guides/overview/multimodal/tts). Capacidades separadas, sujetas al modelo configurado.
- [Evolution Foundation: repositorio oficial](https://github.com/evolution-foundation/evolution-api). Distingue integración Baileys y Cloud API; rutas concretas se fijan contra release durante WHA-03.
- [Meta: inicio de Cloud API](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started) y [envío de mensajes](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages). Sustentan ventana de servicio; políticas exactas se verifican en el adapter real.
- [Meta: onboarding de usuarios Business app](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users). Coexistencia depende del proceso/eligibilidad, no se asume automáticamente.
- [SAT: catálogo productos y servicios](https://www.sat.gob.mx/consultas/53693/catalogo-de-productos-y-servicios) y [unidades](https://pys.sat.gob.mx/PyS/catUnidades.aspx). Referencias de dataset, no asesoría de clasificación fiscal.

No se requiere documentación de NetPay para implementar V2: no hay pasarela financiera real en alcance.

## Validación documental automatizada

- 90 IDs de tarea únicos, cada uno con REQ y AC únicos.
- Todas las dependencias apuntan a tareas existentes.
- Orden topológico calculado sin ciclos, 55 rondas conservadoras.
- Ejemplos JSON se parsean; enlaces internos y bloques Markdown se comprueban en el control final.
- Estados de trabajo permanecen TODO; este resultado no se confunde con pruebas de implementación.
