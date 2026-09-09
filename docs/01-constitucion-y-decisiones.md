# Constitución del producto y decisiones V2

## Autoridad y alcance de esta entrega

Este paquete reemplaza la especificación V1 para implementación. V1 se conserva como referencia histórica. Este trabajo entrega especificaciones y backlog; no certifica que el software, pruebas o conexiones hayan sido construidos. Los checks del informe de revisión verifican documentos, no funcionamiento de una aplicación.

Orden de autoridad: instrucciones expresas del usuario → constitución V2 → especificación de dominio responsable → contratos compartidos → tareas. Si una tarea contradice una regla, corregir el documento antes de implementar; no usar el backlog para reinterpretar el dominio.

## Decisiones cerradas

| ID | Decisión | Motivo / consecuencia |
| --- | --- | --- |
| ADR-001 | Next.js App Router + TypeScript estricto. | Portal y checkout responsive. |
| ADR-002 | shadcn/ui + Tailwind CSS; Sonner para toasts. | Corrección explícita del usuario. No existe un UI kit pendiente por identificar. |
| ADR-003 | React Hook Form + Zod + zodResolver. | “Create Hooks” significaba formularios. Custom hooks son técnica interna, no sustituyen RHF. |
| ADR-004 | Axios como cliente HTTP; TanStack Query como decisión de arquitectura para estado remoto. | Query no reemplaza RHF ni se atribuye a lo solicitado literalmente. |
| ADR-005 | Única pasarela implementada: `DUMMY`. | No requiere cuenta NetPay, no captura tarjetas, no mueve fondos. NetPay Plane es nombre del proyecto. |
| ADR-006 | NestJS + Prisma + PostgreSQL para negocio; Python/FastAPI + LangGraph para IA. | Se concreta la propuesta backend de V1 como baseline técnico modificable por ADR. |
| ADR-007 | RabbitMQ durable para transporte; outbox/inbox en PostgreSQL. | Node y Python comparten protocolos sin ejecutar tareas largas en Next.js. |
| ADR-008 | Catálogo, cotización y pedido son entidades distintas. | Historial inmutable y varias revisiones. |
| ADR-009 | Un pedido tiene revisiones de checkout; una revisión aceptada fija total y entrega. | Los cambios de dirección no alteran un intento activo. |
| ADR-010 | Una empresa inicial; aislamiento multiempresa desde el esquema. | No incluye portal comercial de suscripciones SaaS. |
| ADR-011 | MXN, pago total, entrega por recolección o tarifa fija configurada. | Sin tipos de cambio, envíos cotizados por transportista ni pagos parciales. |
| ADR-012 | Inventario local o sin control en alcance ejecutable. | Contrato EXTERNAL especificado; activarlo exige adaptador implementado y aprobado en pruebas, no una respuesta ficticia. |
| ADR-013 | WhatsApp oficial directo y Evolution/Baileys por QR. | Ambos conectores forman parte del objetivo, con fixtures para desarrollar sin cuentas. |
| ADR-014 | OpenRouter para LLM, STT y TTS mediante puertos separados. | Tests deterministas usan doubles; pruebas reales de cada capacidad quedan como gate de integración. |
| ADR-015 | Cotización comercial con datos SAT; sin timbrado. | No presentar PDF como CFDI. |
| ADR-016 | Catálogo público navegable no incluido. | Sí hay preview público, checkout y resultado por enlace. |
| ADR-017 | Simulación visible en toda superficie de pago. | Mensajes, reportes, recibos y webhooks incluyen `livemode=false`. |
| ADR-018 | Despliegue de referencia Docker Compose en VM Linux con TLS. | No se hereda GCP de otros proyectos. Producción escalable puede cambiar infraestructura por ADR. |

## Comportamiento obligatorio

Todo comando verifica identidad, tenant, permisos, versión y reglas. El LLM nunca calcula totales oficiales, confirma pagos, asigna claves SAT ni autoriza descuentos. Las descripciones y mensajes son datos no confiables.

No hay dinero real en V2. El modo dummy reproduce límites distribuidos: API del simulador, estado propio, eventos firmados y conciliación. La UI comercial no hace `setPaid()` para simular. Un GET público no acepta ni cobra. Un retorno de navegador no determina estado financiero.

El trabajo incluye catálogo UI/API, clientes, cotizaciones/PDF comercial, cobro rápido, pedidos, checkout público, dummy, cancelación, reembolso simulado, ambos canales WhatsApp, bandeja humana, IA con audio, importación, webhooks, reportes, seguridad y operación. Cada uno tiene tareas explícitas en el paquete.

Fuera de alcance deliberado: pasarela real, timbrado/PAC, dispersión, suscripciones, anticipos, contabilidad, campañas masivas, telefonía, tienda pública completa, conectores nativos Shopify/WooCommerce y ERP concreto. “Completo” se refiere al alcance anterior; no implica implementar cualquier funcionalidad e-commerce posible.

## Valores iniciales de producto

| Configuración | Default | Validación |
| --- | --- | --- |
| Zona horaria | America/Mexico_City | IANA válido; persistencia UTC. |
| Vigencia cotización | 7 días | 1 hora–30 días. |
| Vigencia cobro rápido | 24 horas | 1 hora–30 días. |
| Reserva checkout | 15 minutos | 5–30 minutos; alineada con sesión dummy. |
| Pago máximo dummy | 1,000,000.00 MXN | Total 0.01–máximo; nunca dinero real. |
| Conceptos por documento | 200 | Rechazar exceso antes de calcular. |
| Descuento vendedor | 10% | 0–100%; default IA 0%; 100% no puede producir cobro cero. |
| Recordatorios | 2 h y 24 h | Máximo 2, horario 09:00–19:00 local, opt-out respetado. |
| Audio recibido | 3 min y 10 MB | El límite menor entre plataforma/proveedor aplica. |
| Audio generado | 45 s | Resumen y enlace textual siempre. |
| Importación | 10,000 filas por job | Máximo 10 MB, CSV UTF-8, validación previa. |
| Listado API | 25 por página | 1–100, cursor estable. |
| Idempotencia | 30 días | Referencias financieras únicas se conservan más allá. |

## Desarrollo guiado por especificaciones

1. Seleccionar tarea del backlog con dependencias `DONE` y leer su SPEC y contratos.
2. Registrar alcance exacto, ejemplos de entrada, estados previos y resultados esperados.
3. Convertir el AC vinculado en prueba automatizada o procedimiento reproducible antes de declarar la implementación cerrada. Para reglas críticas, escribir la prueba antes del código.
4. Implementar una unidad vertical: migración/servicio/API/UI según tarea; nunca inventar un endpoint no documentado.
5. Ejecutar validación focalizada y regresiones afectadas; adjuntar evidencia.
6. Actualizar traza requisito → tarea → prueba → PR/commit → resultado.
7. Si cambian reglas, emitir ADR, actualizar SPEC y contratos, y revisar los consumidores antes del merge.

Estados de tarea: `TODO`, `READY`, `IN_PROGRESS`, `BLOCKED`, `REVIEW`, `DONE`. Una tarea depende de otras terminadas, no de fechas. Los endpoints definidos en Markdown deben convertirse en OpenAPI ejecutable como parte de T-FND-02; la documentación entregada no se describe como un schema ya compilado.

Definition of Ready: requisito, dueño del módulo, dependencias, contrato, fixtures y AC definidos. Definition of Done: implementación revisada, permisos, errores, idempotencia cuando aplica, prueba vinculada, migración segura, documentación actualizada y ausencia de secretos/PII en evidencia. No cerrar un conector real únicamente porque pasó el mock.

## Factores externos sin decisiones abiertas de producto

Credenciales Meta/OpenRouter, número de WhatsApp y una instancia Evolution operativa son prerrequisitos de pruebas reales. Su ausencia no bloquea core/dummy ni autoriza marcar esas pruebas como aprobadas. Las versiones de dependencias se resolverán y fijarán en T-FND-01, verificando el conjunto compatible; elegir números sin instalar y probar no aumenta la precisión de la especificación.
