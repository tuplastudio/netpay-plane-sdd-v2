# SPEC-OPS — Seguridad, Docker, operación, QA y liberación

Versión: 2.0. Estado: especificado; implementación pendiente.

## Modelo de amenazas y controles

| Amenaza | Control obligatorio | Evidencia |
| --- | --- | --- |
| Acceso entre tenants | Contexto autenticado, FK compuesta, RLS, namespaces de objetos/cache/checkpoints | Test A/B de recursos y worker. |
| Pago falsificado | Dummy service auth, HMAC raw body, consulta estado y cotejo referencia/importe/moneda | D11/D12/return URL falsa. |
| Doble efecto | Idempotencia, locks e índices únicos, inbox/outbox | Crash/replay concurrente. |
| XSS/adjuntos | Texto saneado, CSP, reencode de imagen, no SVG, MIME real | Payload malicioso visible como texto. |
| SSRF | Egress validation al conectar, DNS/IP públicas, no redirect | Metadata/localhost/IPv6 privada bloqueados. |
| Robo de secretos | Gestor de secretos, logs redacted, no NEXT_PUBLIC, rotación | Bundle y logs sin key/token/QR. |
| Prompt injection | Herramientas allowlist, validación server-side y filtros tenant | Eval de ataques falla cerrada. |
| Robo de sesión | HttpOnly/Secure/CSRF/MFA/TTL y auth reciente | Tests IAM y navegador. |
| Abuso/costos | Cuotas por principal/tenant/canal y presupuestos IA |429/budget exhausted sin más llamadas. |

Rate limits iniciales: API key 120/min, burst20; público lectura 60/min por IP/token y checkout 5/min por token; chat ingress con límites del proveedor y cola por tenant, no rechazar de forma indiscriminada eventos de pago válidos. Body JSON 1 MB salvo upload directo. Egress de agentes solo endpoints permitidos, sin shell herramientas.

## Privacidad y retención de referencia

Audios y raw medios 30 días; transcripciones y checkpoints 90 días; logs técnicos 30 días; inbox/raw eventos 30 días, dedup IDs de pagos preservados con ledger; event feed 30 días; exports 24 h; archivos temporales 24 h. Datos comerciales y auditoría de demo 365 días como política operativa inicial, no como plazo legal. Documentos en legalHold o incidente abierto se conservan hasta resolución autorizada. Antes de operar con datos reales de clientes, responsable del comercio valida política aplicable; eso no agrega pasarela real al alcance.

Job diario soft-delete/anonimiza según tipo y preserva mínimos de integridad; borra objeto/embeddings/checkpoints derivados y registra evidencia sin replicar PII. Backups cifrados con ciclo de vida y registro de solicitudes de borrado para reaplicar tras restore. No prometer borrado inmediato de backups inmutables. Notas/fiscal se excluyen por defecto de prompts.

## Entornos y configuración

`local`: Compose con fixtures, fake WhatsApp/LLM, dummy real local; `integration`: proveedores WhatsApp/OpenRouter habilitados con cuentas de prueba y dummy; `demo`: portal accesible, dummy marcado y controles avanzados privados. `PAYMENT_PROVIDER=DUMMY` obligatorio; configuración diferente falla al arrancar. No existe flag secreto para convertir a real.

Variables documentadas: DATABASE_URL, BROKER_URL, OBJECT_STORAGE_ENDPOINT/BUCKET, SESSION_SECRET_REF, TOKEN_ENCRYPTION_KEY_REF, DUMMY_BASE_URL/DUMMY_SERVICE_KEY_REF/DUMMY_WEBHOOK_SECRET_REF, META_APP_ID/SECRET_REF/VERIFY_TOKEN_REF, EVOLUTION_BASE_URL/KEY_REF, OPENROUTER_KEY_REF, MODEL_ID/STT_MODEL_ID/TTS_MODEL_ID/TTS_VOICE, PUBLIC_BASE_URL, APP_ENV. Datos sensibles son referencias gestionadas, `.env.example` valores vacíos/ejemplos.

Docker multi-stage, usuario no root, health/readiness, filesystem read-only donde posible, temp volumen limitado para transcode/PDF y límites memoria/CPU. Solo proxy443 público. PostgreSQL/broker/S3 persistentes; Evolution profile opcional con volumen de sesión y lock de propietario. Backups fuera de la VM, no solo volumen del mismo host. Composer de desarrollo no es garantía de alta disponibilidad.

## Runbooks mínimos

**Pago UNKNOWN:** buscar order/attempt por requestId → consultar dummy por operationKey → comparar referencias/importes → dejar reconciler aplicar → si no hay estado, abrir incidente sin nuevo cargo → registrar evidencia. No UPDATE orders manual.

**Canal caído:** verificar connection health/credenciales → pausar envíos con TTL → reconectar/QR con admin → prueba inbound/outbound → revalidar política antes de vaciar pendientes. Pagos continúan.

**DLQ:** inspeccionar error redacted/versión → corregir causa → replay con eventId original → verificar efecto único → cerrar alerta. Nunca vaciar cola sin respaldo/evidencia.

**Rotación:** crear nuevo secreto/key ID → habilitar ventana de validación doble → cambiar emisor → comprobar → revocar anterior → auditar. Sesiones QR no se exportan a equipos de atención.

**Restore:** detener escritores → restaurar base/objetos/backups compatibles → restaurar secrets refs → ejecutar migraciones compatibles → reconciliar broker/outbox/provider → reaplicar borrados retenidos → validar dos tenants y un pedido → abrir tráfico. RPO/RTO se miden durante simulacro.

**Deploy/rollback:** build con lockfiles → migrations expand → smoke → cambiar tráfico/reiniciar servicios → monitorizar → rollback de imagen si falla. Migraciones destructivas separadas después de ventana de compatibilidad; rollback de app no restaura datos por magia.

## Capacidad y gates de QA

Fixture carga: 2 tenants, 100k variantes cada uno, 100 usuarios portal, 200 conversaciones abiertas; 10 inbound mensajes/s sostenidos 15min con mix60% búsqueda/25% consulta/10% cotización/5% inicio checkout. Burst30 mensajes/s durante60s. Dummy/LLM fixtures con latencias declaradas; benchmark real de LLM separado.

Objetivos p95: lectura API500ms, catálogo800ms, ack webhook1s, agente texto15s con proveedor evaluado; 95% confirmaciones notificadas<30s con canal disponible. Objetivo disponibilidad interna99.9%; no certificado por Compose. RPO15min/RTO4h, restore medido. No declarar p95 si solo se midió media.

Gates: G0 contratos/lockfiles; G1 dinero/auth/tenant; G2 web→dummy y D01–D17; G3 Meta+Evolution reales y OpenRouter text/STT/TTS reales; G4 móvil/accesibilidad/carga/restore; G5 piloto con checklist operativo. G3 no pasa con mocks; demo local puede liberarse con etiqueta “integraciones externas no verificadas” y sin activar esos conectores, pero alcance completo no se marca terminado hasta cumplirlo.

## Requisitos, tareas y aceptación

### REQ-OPS-01 / T-OPS-01 — Implementar hardening y secretos

**Regla normativa:** Configuración insegura falla antes de aceptar tráfico.

**Trabajo específico:** CSP/CSRF/rate limits, service auth/secret references, egress SSRF, límites de cuerpos y redaction; startup PAYMENT_PROVIDER DUMMY only.

**Entregable esperado:** security middleware y config validation suite.

**Dependencias:** T-UIX-08, T-NTF-06.

**AC-OPS-01 — prueba de aceptación:** Provider REAL falla startup; logs no tienen tokens; SSRF y acceso cruzado bloqueados.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-OPS-01. Estado inicial: `TODO`.

### REQ-OPS-02 / T-OPS-02 — Implementar retención y privacidad

**Regla normativa:** Borrado alcanza derivados sin romper integridad financiera de demo.

**Trabajo específico:** Crear políticas por entidad, legalHold, job purge/anon, limpieza storage/vector/checkpoint y journal para restore; export datos del titular autorizado.

**Entregable esperado:** privacy jobs y retention config.

**Dependencias:** T-OPS-01.

**AC-OPS-02 — prueba de aceptación:** Fixture vencido elimina audio/embedding/checkpoint; legalHold conserva evidencia; restore reaplica purge pendiente.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-OPS-02. Estado inicial: `TODO`.

### REQ-OPS-03 / T-OPS-03 — Empaquetar Docker y deployment

**Regla normativa:** El entorno arranca sin secretos incrustados ni datos efímeros críticos.

**Trabajo específico:** Crear Dockerfiles nonroot, Compose profiles, proxy TLS, migrator único y volumes; scripts up/down/backup/restore; health y recursos.

**Entregable esperado:** infra/compose, Dockerfiles y deployment runbook.

**Dependencias:** T-OPS-02.

**AC-OPS-03 — prueba de aceptación:** Recrear contenedores conserva DB/sessionEvolution; solo proxy expuesto; imágenes no contienen .env ni keys.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-OPS-03. Estado inicial: `TODO`.

### REQ-OPS-04 / T-OPS-04 — Instrumentar y alertar

**Regla normativa:** Cada fallo puede rastrearse desde UI a worker y proveedor.

**Trabajo específico:** OpenTelemetry/logs/metrics con IDs, dashboards colas/retries/paymentsUnknown/costo/health; alertas con owner y link al runbook.

**Entregable esperado:** observability configs y runbooks.

**Dependencias:** T-OPS-03.

**AC-OPS-04 — prueba de aceptación:** D07 genera métrica UNKNOWN y trace correlacionado; canal caído3 probes alerta; dashboard no expone PII.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-OPS-04. Estado inicial: `TODO`.

### REQ-OPS-05 / T-OPS-05 — Ejecutar seguridad y carga

**Regla normativa:** Objetivos se prueban con volumen y mezcla definidos.

**Trabajo específico:** Crear k6/Playwright load fixtures, tenant attack suite y report p50/p95/p99/error rate; distinguir dependencia externa de tiempo interno.

**Entregable esperado:** tests/load y security reports.

**Dependencias:** T-OPS-04.

**AC-OPS-05 — prueba de aceptación:** 100k variantes/tenant y mix definido reportados; falla gate si p95 excede o hay fuga tenant, sin ocultar errores.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-OPS-05. Estado inicial: `TODO`.

### REQ-OPS-06 / T-OPS-06 — Ensayar recuperación y liberación

**Regla normativa:** Un release requiere evidencia reproducible de datos y operación.

**Trabajo específico:** Automatizar backup cifrado off-host, restore drill, rollback compatible, smoke y checklist G0–G5; registrar credenciales externas como gate pendiente si faltan.

**Entregable esperado:** release checklist y restore evidence.

**Dependencias:** T-OPS-05.

**AC-OPS-06 — prueba de aceptación:** Restauración recupera órdenes/ledger y RPO/RTO medidos; replays no duplican; gate real no se marca por mock.

**Evidencia para cerrar:** cambio de código/contrato, prueba indicada y resultado reproducible vinculados a T-OPS-06. Estado inicial: `TODO`.
