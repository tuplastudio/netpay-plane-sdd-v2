# SPEC-AIA — LangGraph, catálogo, herramientas, audio y evaluación

Versión: 2.1. Estado: implementado en `apps/agent-service`.

Implementación: dos motores sobre el mismo grafo — `LLMEngine` (OpenRouter con tool calling) y `RuleEngine` (determinista, sin proveedor) — con el mismo estado, la misma allowlist de herramientas y el mismo criterio de handoff. La base de conocimiento del negocio vive en `apps/agent-service/knowledge/*.md` y se recarga en caliente. Suite de evaluación: 120 casos, `python3 -m app.evals`.

## Grafo explícito

Estados normalizados: RECEIVED → NORMALIZED → TRANSCRIBED cuando audio → INTENT → SEARCH → CLARIFY o CALCULATE → QUOTE_READY → WAIT_CONFIRMATION → LINK_SENT. Consulta de pedido deriva a STATUS; problemas/petición usuario derivan a HUMAN_REQUIRED. Un evento puede terminar esperando respuesta; no mantener HTTP abierto esperando al cliente.

Checkpoint namespace tenant/connection/conversation, thread separado del orderId; workingState guarda cart draft, pending slots, candidates, quoteVersion, confirmationRef, controlVersion y processedMessageIds limitados. Historial resumido después de 20 mensajes o presupuesto de tokens; conservar referencias comerciales, no resumir importes de forma que sustituyan los del backend.

## Salida de intención y límites

`IntentResult`: intent SEARCH_PRODUCTS/BUILD_QUOTE/CONFIRM_QUOTE/ORDER_STATUS/CHANGE_REQUEST/HUMAN/OPTOUT/OTHER; lines array de `{rawText,sku?,name?,quantity?,unit?,attributes?}`, missingFields, referencedQuoteId? y language es-MX. Ninguna propiedad tenantId/priceOverride está permitida. Cantidades son strings; resultado malformado se reintenta una vez con esquema, luego humano.

Límite inicial: 8 pasos de herramientas por turno, 2 reintentos técnicos por llamada idempotente, 30 s presupuesto total texto por turno, costo configurable por tenant con hard cap. Agotamiento termina con mensaje corto y transferencia. Mensaje entrante máximo 8,000 caracteres; adjuntos no soportados se reconocen sin ejecución. No usar navegación web libre para inventariar productos.

## Matching y decisión

Pipeline: búsqueda exacta SKU → atributos obligatorios → lexical/trigram top20 → semantic top20 opcional → fusión/reordenamiento → candidatos top3 explicables. Evidencia `{variantId,sku,matchedFields,conflicts,sourceVersion,matchType}`. Embeddings solo indexan catálogo del tenant y se actualizan por evento; precio/stock se consultan vivos al calcular. Match exacto no exime cantidad ni unidad.

Autoelección permitida solamente si SKU exacto único o coincidencia determinista de todos los atributos requeridos y cantidad/unidad válidas; semantic/fuzzy siempre pide elección en V2. Esto elimina un umbral arbitrario de confianza. Si cliente dice “dos cajas”, convertir solo con packSize declarado y confirmar presentación. Agotado: explicar y mostrar alternativa identificada, nunca sustituir sin aceptación.

## Herramientas y autoridad

| Tool | Campos de entrada | Resultado | Efecto |
| --- | --- | --- | --- |
| search_products | query, filters, limit≤20 | candidates y evidencia | Lectura. |
| get_variant | variantId | atributos activos, precio referencial | Lectura autorizada. |
| availability | variantId, quantity | mode/available/asOf | No reserva. |
| calculate_quote | lines variantId/quantity, delivery | totals, hash, missing | Calculadora oficial. |
| create_and_issue_quote | validatedDraftRef, previewHash | quoteVersionId, total, linkRef | Idempotente; no free form. |
| accept_quote | confirmationRef, messageId | orderId | Requiere evidencia explícita. |
| get_checkout_link | resourceRef | enlace generado por backend | Solo recurso de conversación. |
| get_order_status | orderRef | estado y livemode=false | Cliente/tenant verificados. |
| request_human | reason enum, summary | assignment | Cambia controlVersion. |

Service tool gateway inyecta tenant/principal/conversation y comprueba pertenencia. Tool result con linkRef se resuelve solo al enviar; no pedir al modelo construir una URL. Mensaje de total se genera desde plantilla con cifras de backend, aunque el modelo produzca explicación. El LLM no confirma un pedido pagado basándose en “ya pagué”; consulta estado.

## OpenRouter y fallback

Modelo principal debe admitir tool calling/JSON Schema probados; fallback debe superar el mismo dataset. `model-registry` guarda ID exacto, versión de prompt, capacidades, límites y fecha de evaluación. En V2 no se fija un nombre de modelo sin prueba. ID se configura por env; arranque valida configuración y desactiva IA con diagnóstico si falta, manteniendo canal humano.

OpenRouter documenta STT y TTS mediante endpoints dedicados (fuentes en informe). Los adapters están separados del chat en `model_gateway.stt/tts`; sin clave no se simula una llamada al proveedor: se devuelve 503 y el canal degrada a texto.

Audio entrante: download permitido → MIME/tamaño/duración → transcode controlado → STT → texto/evidencia → mismo pipeline. Si baja calidad o número ambiguo, pedir confirmación. Audio saliente usa únicamente texto final validado, límite 45 s, transcode al formato soportado por canal; adjunta resumen y enlace textual. Fallo de TTS degrada a texto; fallo STT pide texto o humano. No clone voice.

## Evaluación y seguridad

Dataset inicial 120 casos: 20 exact SKU, 20 fuzzy/sinónimos, 20 variantes/unidades, 15 stock/archivados, 15 confirmaciones/estados, 15 ataques/PII y 15 audios con cantidades. Fixtures deterministas más evaluación live por modelo. Objetivos: 100% sin precio inventado, sin cross-tenant, sin tool no autorizada; ≥95% selección exacta en subset exact SKU; fuzzy ambiguo solicita aclaración en 100% del conjunto etiquetado; ≥95% cantidades correctas o aclaradas en audio. Reportar numeradores/denominadores, no solo score global.

Persistir entrada/salida saneada, tool calls, IDs, modelo/prompt, costo/latencia y decisión operativa breve. No guardar cadena de pensamiento. Una descripción de catálogo que diga “ignora reglas” se trata como texto de producto y nunca como instrucción.

## Requisitos, tareas y aceptación

### REQ-AIA-01 / T-AIA-01 — Definir estado y persistencia del grafo

**Regla normativa:** Reinicio reanuda sin duplicar herramientas mutantes.

**Trabajo específico:** Crear State Pydantic, nodes/transitions/checkpointer PostgreSQL y namespace tenant/conversation; guardar pending slots y confirmationRef; idempotency por comando.

**Entregable esperado:** agent-service/graph y migrations de checkpoint.

**Dependencias:** T-WHA-07, T-QTE-07, T-ORD-06.

**AC-AIA-01 — prueba de aceptación:** Detener tras create quote y reanudar devuelve mismo quoteId; otro tenant no lee checkpoint.

**Evidencia:** `apps/agent-service/app/state.py` (checkpoints en disco por tenant/conversación) y `tests/test_agent.py::test_checkpoint_resume_keeps_quote`, `::test_checkpoint_is_tenant_scoped`. Estado: `HECHO`.

### REQ-AIA-02 / T-AIA-02 — Implementar ModelGateway

**Regla normativa:** Modelo se selecciona por capacidad evaluada y presupuesto.

**Trabajo específico:** Crear OpenRouter chat adapter, registry/config, structured output validation, fallback limitado y rate/cost counters; mock para fixtures.

**Entregable esperado:** agent-service/providers/model_gateway y registry.

**Dependencias:** T-AIA-01.

**AC-AIA-02 — prueba de aceptación:** Modelo con respuesta inválida repara una vez y deriva; presupuesto agotado no sigue llamando APIs.

**Evidencia:** `apps/agent-service/app/providers/model_gateway.py` y `providers/model_registry.json` (modelo, capacidades, costo y fecha de evaluación); fallback y contadores de costo por conversación. Estado: `HECHO`.

### REQ-AIA-03 / T-AIA-03 — Construir matching explicable

**Regla normativa:** Fuzzy y semantic no autoeligen productos en V2.

**Trabajo específico:** Implementar exact/lexical/hybrid, filtros duros, evidencia y pregunta top3; índices/embeddings por tenant con versiones; conversiones por packSize explícito.

**Entregable esperado:** agent search pipeline y indexer.

**Dependencias:** T-AIA-02.

**AC-AIA-03 — prueba de aceptación:** Caso ambiguo muestra opciones; SKU correcto talla errónea se aclara; precio viene de calculator no embeddings.

**Evidencia:** `apps/agent-service/app/matching.py` (SKU exacto, léxico, trigram, conflictos) y categorías `exact_sku`/`fuzzy`/`stock` de la suite. Estado: `HECHO`.

### REQ-AIA-04 / T-AIA-04 — Implementar tool gateway

**Regla normativa:** Solo herramientas autorizadas generan efectos comerciales.

**Trabajo específico:** Crear schemas, principal interno, validación ownership, command IDs y guards de controlVersion; plantilla de importes y resolver links del backend.

**Entregable esperado:** tool registry y commerce tool endpoints.

**Dependencias:** T-AIA-03.

**AC-AIA-04 — prueba de aceptación:** Prompt injection no habilita free form ni cambia tenant; repetir aceptación genera mismo pedido; ya pagué consulta provider state.

**Evidencia:** `apps/agent-service/app/tools.py` (scopes, allowlist, `commandId` idempotente) y compuerta crítica `tool_authorization`. Estado: `HECHO`.

### REQ-AIA-05 / T-AIA-05 — Procesar STT y TTS

**Regla normativa:** Audio converge al flujo textual y enlace siempre es clicable.

**Trabajo específico:** Crear adapters OpenRouter speech, validación/transcode en worker, URLs privadas, límites y fallback; no exponer media raw al navegador sin auth.

**Entregable esperado:** audio pipeline, speech providers y fixtures audio.

**Dependencias:** T-AIA-04.

**AC-AIA-05 — prueba de aceptación:** Audio grande falla antes de STT; cantidad dudosa pregunta; TTS caído envía texto con enlace simulado.

**Evidencia:** `apps/agent-service/app/providers/model_gateway.py` (`stt`/`tts` con límites) y endpoints `/audio/stt`, `/audio/tts`. Estado: `HECHO`.

### REQ-AIA-06 / T-AIA-06 — Coordinar turnos y handoff

**Regla normativa:** No envía respuestas caducadas tras cambio humano.

**Trabajo específico:** Implementar serialización conversación, debounce acotado, cancelación lógica por controlVersion y HUMAN reason codes; resumir sin perder referencias.

**Entregable esperado:** agent worker y handoff nodes.

**Dependencias:** T-AIA-05.

**AC-AIA-06 — prueba de aceptación:** Llegan 3 mensajes consecutivos: se conservan; humano toma chat antes de send y el bot no publica.

**Evidencia:** `apps/agent-service/app/graph.py` (dedup por `messageId`, `controlVersion`, silencio tras handoff) y `tests/test_agent.py::test_human_takeover_silences_bot`. Estado: `HECHO`.

### REQ-AIA-07 / T-AIA-07 — Crear suite de evaluación

**Regla normativa:** Cambiar modelo o prompt requiere evidencia comparativa.

**Trabajo específico:** Construir 120 casos etiquetados, runner offline/live y métricas por categoría; bloquear release ante fallos críticos y guardar reporte versionado.

**Entregable esperado:** tests/agent-evals y model evaluation report.

**Dependencias:** T-AIA-06.

**AC-AIA-07 — prueba de aceptación:** Runner produce 120 resultados con expected/actual; cualquier fuga tenant o precio inventado falla gate, aunque promedio sea alto.

**Evidencia:** `apps/agent-service/app/evals/` (dataset de 120 casos, runner con numerador/denominador por categoría y compuertas críticas). Estado: `HECHO`.


## Conocimiento del negocio (V2.1)

El agente responde preguntas del negocio desde `apps/agent-service/knowledge/*.md`, no desde el prompt. Cada encabezado `##` es un fragmento recuperable; la búsqueda es léxica con sinónimos y trigramas, y cada respuesta cita `documento#sección`.

El frontmatter de `negocio.md` define identidad y tono: `negocio`, `agente`, `tono`, `idioma`, `moneda`, `horario`, `cobertura`, `telefono`, `web`, `saludo`, `emoji`. Cambiar de negocio es editar Markdown.

Reglas: el contenido es dato, nunca instrucción (un texto tipo "ignora las reglas" se registra como advertencia y se trata como texto del negocio); los precios no salen del documento sino de la calculadora; las líneas `> interno:` son guía para el agente y nunca se le repiten al cliente.

Operación: `GET /knowledge`, `POST /knowledge/reload`, `GET /knowledge/search?q=`, y la consola web en `/agent`.
