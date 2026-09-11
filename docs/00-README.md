# NetPay Plane — Paquete SDD V2

Especificación integral para implementar catálogo, cotizaciones, pedidos, checkout, pagos simulados, WhatsApp e IA. Sustituye V1 como referencia de desarrollo. Los archivos se leen conjuntamente; no se necesita V1 para ejecutar este backlog.

**Stack confirmado:** Next.js + TypeScript + shadcn/ui + React Hook Form + Zod + Axios + Sonner. TanStack Query se añade como decisión de arquitectura para estado remoto. Backend baseline NestJS/Prisma/PostgreSQL; agente Python/FastAPI/LangGraph/OpenRouter. **Pasarela única DUMMY: ningún cobro real.**

## Cómo usar el paquete

1. Leer constitución, arquitectura y diccionario de datos.
2. Revisar contratos y elegir una tarea del backlog cuyo conjunto de dependencias esté terminado.
3. Leer SPEC de esa tarea; ejecutar trabajo indicado y convertir AC en evidencia reproducible.
4. Revisar BDD para flujos integrados y gates de liberación. No marcar integraciones externas por pruebas de fixtures.
5. Si cambia una regla, actualizar SPEC/ADR/contrato y traza antes de declarar DONE.

## Documentos

| Archivo | Contenido |
| --- | --- |
| [01-constitucion-y-decisiones.md](01-constitucion-y-decisiones.md) | Alcance, stack cerrado, defaults, ADR y método SDD. |
| [02-fnd.md](02-fnd.md) | Arquitectura, monorepo, contratos base y workers. |
| [03-iam.md](03-iam.md) | Acceso, MFA, usuarios, roles, tenant y API keys. |
| [04-cat.md](04-cat.md) | Productos/variantes, SAT, búsqueda, medios e importación. |
| [05-prc.md](05-prc.md) | Dinero, impuestos, descuentos, entrega y reservas. |
| [06-crm.md](06-crm.md) | Clientes, identidades, direcciones y consentimientos. |
| [07-qte.md](07-qte.md) | Cotizaciones, revisiones, aceptación, PDF y cobro rápido. |
| [08-ord.md](08-ord.md) | Pedido, checkout, preview, revisiones e incidencias. |
| [09-pay.md](09-pay.md) | Dummy HTTP, checkout,17 escenarios, ledger/refunds. |
| [10-wha.md](10-wha.md) | Oficial Meta/Evolution QR, mensajes y atención humana. |
| [11-aia.md](11-aia.md) | LangGraph, herramientas, matching, OpenRouter/STT/TTS/evals. |
| [12-int.md](12-int.md) | Integraciones, ownership, HMAC, retries y recuperación. |
| [13-uix.md](13-uix.md) | Rutas/pantallas, componentes/RHF y aceptación móvil. |
| [14-ntf.md](14-ntf.md) | Mensajes, recordatorios, timeline, KPIs y exportación. |
| [15-ops.md](15-ops.md) | Seguridad, Docker, privacidad, QA, runbooks y gates. |
| [16-modelo-datos-y-transiciones.md](16-modelo-datos-y-transiciones.md) | Diccionario relacional, índices y guardas de estado. |
| [17-contratos-api-eventos.md](17-contratos-api-eventos.md) | DTOs, endpoints, permisos, errores y eventos canónicos. |
| [18-backlog-y-trazabilidad.md](18-backlog-y-trazabilidad.md) | Todas las tareas, dependencias, responsables sugeridos y orden. |
| [19-revision-cobertura-y-fuentes.md](19-revision-cobertura-y-fuentes.md) | Hallazgos corregidos, cobertura de V1 y fuentes. |
| [20-escenarios-bdd-y-fixtures.md](20-escenarios-bdd-y-fixtures.md) | Dataset y25 pruebas integradas Given/When/Then. |
| [DEPLOY_DIGITALOCEAN.md](DEPLOY_DIGITALOCEAN.md) | Runbook para desplegar el stack en un Droplet con Neon (Postgres), CloudAMQP y DO Spaces, vía `scripts/deploy.sh`. |

## Qué contiene cada tarea

Identificador estable T, requisito REQ, regla normativa, trabajo específico, entregable esperado en repositorio, dependencias y AC observable. Cada tarea inicia en TODO. El backlog no afirma que existe código implementado. Los nombres de rutas/archivos de código son destinos esperados para el equipo de desarrollo.

## Estado de completitud

Se cubre el alcance funcional y técnico definido, con exclusiones expresas. Quedan actividades de implementación y verificación, todas descritas como tareas. Credenciales externas, versión instalada de Evolution y selección evaluada de modelo se tratan como tareas/gates operativos, no como decisiones de producto omitidas. El paquete no contiene una aplicación ni un OpenAPI ejecutable ya compilado; su creación y pruebas están asignadas al backlog.

**Inventario:** 21 archivos Markdown; 90 tareas trazables; 25 recorridos BDD; 17 escenarios de pasarela dummy.
