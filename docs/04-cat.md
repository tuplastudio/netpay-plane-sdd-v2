# SPEC-CAT — Catálogo, variantes, SAT, medios e importaciones

Versión: 2.0. Estado: especificado; implementación pendiente.

## Esquema funcional

Product: name 1–160, description texto 0–10,000, type PRODUCT/SERVICE, status DRAFT/ACTIVE/ARCHIVED, categoryId opcional, brand 0–100, tags máximo 20 de 40 caracteres. Variant: SKU 1–64 normalizado trim+uppercase para unicidad; nombre de presentación 1–120; atributos JSON conforme definición del producto; price MXN string positivo, taxProfileId, claves SAT, unidad, quantityRules, inventoryMode y version.

SKU original se conserva para mostrar; búsqueda usa skuNormalized. Combinación de atributos única por producto. Producto simple crea variante `DEFAULT`; no permite activar producto sin variante. Una variante archivada nunca se selecciona en ventas nuevas. Alias máximo 30 de 100 caracteres, aprobados manualmente, no aprendidos automáticamente por el LLM.

Campos SAT: clave producto/servicio 8 dígitos y clave unidad 2–3 caracteres alfanuméricos, ambas verificadas contra un dataset oficial importado con vigencia. El patrón sintáctico no prueba validez. Guardar catálogo/version utilizada. En borrador se admite incompleto; activación requiere claves válidas. Un concepto libre de cobro puede registrarse sin claves pero se etiqueta `fiscalCompleteness=INCOMPLETE` y no es factura.

Precio 0.01–1,000,000.00; precisión entrada máxima 2 decimales en V2. Cantidades hasta 999,999.999 y mínimo positivo, step positivo máximo 3 decimales. `PIECE` usa precisión 0; no aceptar fracciones por redondeo silencioso.

## Flujo UI y API

Alta → guardar borrador → configurar variantes/precio/SAT → agregar medios → activar. Editar usando versión; archivar mediante comando explícito. Duplicar crea nuevo ID y SKUs temporales DRAFT-{id} con skuNeedsReview=true, estado DRAFT, sin stock ni referencias externas. Activar exige sustituir esos SKUs y limpiar la marca explícitamente.

Búsqueda siempre por tenant/ACTIVE para público y agente; portal puede incluir borradores/archivados. Prioridad exact SKU → prefijo SKU → nombre/sinónimo → trigram/semantic. Paginación estable `(updatedAt,id)`, máximo 100. Sin resultados no devolver arbitrariamente otro tenant ni catálogo global.

Imágenes: JPEG/PNG/WebP, 5 MB, hasta 8 por producto, validación de contenido, reencode y remover metadata; upload temporal → validación → vínculo al producto. SVG no admitido. URL externa en importación no se descarga sin política SSRF.

## Importación y control de origen

CSV UTF-8 con headers sku,name,type,price,currency,satProductServiceKey,satUnitKey,commercialUnit,taxProfileId,inventoryMode. Atributos avanzados mediante API JSON, no columnas arbitrarias. Mismo parser para dry-run y ejecución; dry-run produce hash de archivo/config. `commit` solo usa ese archivo y config, revalida versiones/autoridad en ejecución.

Una fila identifica variante por `(integrationId,externalId)` o SKU del tenant. Duplicados contradictorios en mismo archivo son errores por fila. Un job no es una transacción de 10,000 filas: cada fila hace upsert atómico; estado PARTIAL cuando hay mezcla. Exportación de errores escapa fórmulas para prevenir ejecución en hojas de cálculo.

## Requisitos, tareas y aceptación

### REQ-CAT-01 / T-CAT-01 — Persistir producto y variantes

**Regla normativa:** No existen SKUs duplicados por tenant ni variantes sin producto.

**Trabajo específico:** Crear tablas, DTOs de alta/patch, normalización y unicidad de atributos; variante DEFAULT para productos simples; categorías de profundidad3 con prevención de ciclos; soft archive explícito por producto/variante.

**Entregable esperado:** catalog entities/repositories/controllers y migraciones.

**Dependencias:** T-IAM-06.

**AC-CAT-01 — prueba de aceptación:** SKU abc y ABC en mismo tenant chocan; otro tenant puede usar ABC; duplicación crea DRAFT sin stock.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-CAT-01. Estado inicial: `TODO`.

### REQ-CAT-02 / T-CAT-02 — Versionar catálogos SAT

**Regla normativa:** Activación depende de catálogo válido, no solo regex.

**Trabajo específico:** Crear importador administrativo de dataset SAT con checksum/vigencia, búsqueda de claves y referencias a versión; preview de cambios sin actualizar snapshots.

**Entregable esperado:** sat catalogs, importer y endpoints GET /sat/product-keys y /sat/unit-keys.

**Dependencias:** T-CAT-01.

**AC-CAT-02 — prueba de aceptación:** Clave con 8 dígitos inexistente falla al activar; documento histórico conserva clave aunque deje de estar vigente.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-CAT-02. Estado inicial: `TODO`.

### REQ-CAT-03 / T-CAT-03 — Implementar lifecycle y autoridad

**Regla normativa:** Edición respeta versión y origen del campo.

**Trabajo específico:** Implementar activate/archive/unarchive-to-draft, reemplazo de aliases normalizados y owner fields LOCAL/INTEGRATION; rechazar patch externo no autorizado y edición concurrente con 409.

**Entregable esperado:** catalog policies y lifecycle commands.

**Dependencias:** T-CAT-02.

**AC-CAT-03 — prueba de aceptación:** Producto incompleto no activa; API de otra integración no cambia precio gestionado por ERP; cotización emitida no cambia.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-CAT-03. Estado inicial: `TODO`.

### REQ-CAT-04 / T-CAT-04 — Construir búsqueda determinista

**Regla normativa:** Filtro tenant y variante precede cualquier matching.

**Trabajo específico:** Agregar índices SKU/nombre/trigram, filtros paginados y alias; respuesta con matchType y atributos. Instrumentar latencia; no introducir embeddings como requisito de búsqueda exacta.

**Entregable esperado:** catalog search repository y fixtures de 100k variantes.

**Dependencias:** T-CAT-03.

**AC-CAT-04 — prueba de aceptación:** SKU exacto aparece primero; una talla no compatible no se devuelve como exact match; búsqueda p95 cumple objetivo de QA.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-CAT-04. Estado inicial: `TODO`.

### REQ-CAT-05 / T-CAT-05 — Gestionar medios seguros

**Regla normativa:** Solo imágenes validadas se publican en catálogo.

**Trabajo específico:** Crear upload intent/finalize, límites, reencode, orden y delete de vínculo; job elimina huérfanos después de 24 h sin borrar objetos referenciados.

**Entregable esperado:** media pipeline y API de imágenes.

**Dependencias:** T-CAT-04.

**AC-CAT-05 — prueba de aceptación:** Archivo ejecutable con extensión png falla; nueve imágenes exceden límite; URL de otro tenant no vincula.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-CAT-05. Estado inicial: `TODO`.

### REQ-CAT-06 / T-CAT-06 — Importar con dry-run y errores

**Regla normativa:** Commit procesa exactamente el archivo prevalidado y reporta cada fila.

**Trabajo específico:** Implementar CSV parser, dry-run, hash, commit, upsert por fila, progreso/reintento de fallidas y CSV seguro de errores. Aplicar reglas CAT-01 a CAT-03.

**Entregable esperado:** catalog-import service y fixtures válidos/mixtos/maliciosos.

**Dependencias:** T-CAT-05.

**AC-CAT-06 — prueba de aceptación:** Job 100 filas con 3 errores termina PARTIAL 97/3; reejecutar no duplica; archivo cambiado invalida dry-run.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-CAT-06. Estado inicial: `TODO`.

### REQ-CAT-07 / T-CAT-07 — Exponer API completa del catálogo

**Regla normativa:** UI y API comparten reglas y respuestas.

**Trabajo específico:** Completar list/detail/create/patch/activate/archive/duplicate, límites y scopes; integrar contract tests y eventos product.* en outbox.

**Entregable esperado:** OpenAPI catálogo, controladores y tests.

**Dependencias:** T-CAT-06.

**AC-CAT-07 — prueba de aceptación:** Cada mutación exitosa produce un evento único lógico; body con total/tenant forzado se rechaza.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-CAT-07. Estado inicial: `TODO`.
