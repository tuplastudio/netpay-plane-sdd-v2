# Esquema relacional, índices y transiciones canónicas

## Convenciones SQL

PostgreSQL; UUID PK, `tenant_id UUID NOT NULL` para todo agregado empresarial, `created_at/updated_at timestamptz NOT NULL`, `lock_version int NOT NULL DEFAULT 1`. IDs en tablas puente también pueden ser UUID para auditoría. `UNIQUE(tenant_id,id)` en targets de FK compuestas; nunca unir solo por ID sin tenant en consultas. Cantidades NUMERIC(18,3), dinero NUMERIC(18,2), tasas NUMERIC(9,6), JSONB validado por schemaVersion. Check cantidad>0 en conceptos; saldos según restricciones específicas. `deleted_at` solo donde anonimización/archivado lo permita, no borrado financiero.

Campos listados a continuación son normativos; campos comunes se heredan. `?` nullable; listas son relaciones hijas salvo JSONB indicado. Enum puede implementarse como SQL enum o CHECK, pero valores deben coincidir con contratos. Columnas de secreto contienen referencias o cifrado, nunca texto sin protección.

## Diccionario de tablas

| Tabla | Campos propios esenciales | Restricciones / índices |
| --- | --- | --- |
| tenants | name, status, currency, timezone, current_config_version | currency=MXN; status ACTIVE/SUSPENDED. |
| tenant_config_versions | revision, brand JSONB, delivery JSONB, discounts JSONB, terms JSONB, reminders JSONB | unique tenant/revision; inmutable. |
| users | email_normalized, password_hash, status, mfa_secret_ref? | email unique global; no tenant porque identidad puede tener memberships. |
| memberships | user_id, role_id, status | unique tenant/user; role del mismo tenant. |
| roles / role_permissions | name, permission_code | unique tenant/name; permission allowlist. |
| sessions | user_id, active_tenant_id, token_hash, expires_at, idle_at, revoked_at? | hash unique; no token claro. |
| auth_tokens | user_id, purpose, token_hash, expires_at, used_at? | invite/reset/verify, unique hash. |
| mfa_recovery_codes | user_id, code_hash, used_at? | unique user/hash. |
| api_credentials | integration_id?, prefix, hash, scopes JSONB, expires_at?, revoked_at? | prefix lookup; hash unique. |
| customers | display_name, phone?, email?, status, private_notes_cipher?, fiscal_data_cipher? | idx tenant/phone y tenant/name; no auto unique nombre. |
| addresses | customer_id, label, recipient, address JSONB | FK tenant/customer. |
| channel_identities | connection_id, provider_user_id, customer_id | unique tenant/connection/provider_user. |
| communication_consents | customer_id, purpose, channel, status, source, proof_ref?, occurred_at, policy_version | append history; idx tenant/customer/purpose/time. |
| categories | name, parent_id? | impedir ciclos; V2 profundidad máxima3. |
| products | name, description, type, status, category_id?, brand?, tags JSONB | idx tenant/status/updated_at/id. |
| product_variants | product_id, sku, sku_normalized, sku_needs_review, attrs JSONB, attrs_hash, status, sat_product_key, sat_unit_key, sat_version, commercial_unit, pack_size?, quantity_min, quantity_max, quantity_step, inventory_mode | unique tenant/sku_normalized; unique tenant/product/attrs_hash. |
| product_aliases | product_id, alias_normalized | unique tenant/product/alias; búsqueda indexada. |
| prices | variant_id, currency, amount, tax_profile_id, price_includes_tax, valid_from, valid_to? | V2 una vigente por variante/MXN, períodos no solapados. |
| tax_profiles | name, mode, rate, version, active | tasa>=0; una tasa soportada; immutable version si usada. |
| sat_catalog_versions / sat_entries | dataset_checksum, imported_at, entry_type, code, description, valid_from?, valid_to? | unique version/type/code; catálogo global público controlado. |
| media_objects / product_media | object_key, mime, bytes, checksum, status; product_id, media_id, position | unique object_key; FK tenant; máximo8 validado transacción. |
| inventory_balances | variant_id, on_hand, reserved | unique tenant/variant; CHECK on_hand>=reserved>=0. |
| inventory_reservations | order_revision_id, variant_id, quantity, expires_at, state | unique tenant/revision/variant; ACTIVE/CONSUMED/RELEASED/EXPIRED. |
| inventory_movements | variant_id, reservation_id?, kind, quantity, operation_key, reason | unique tenant/operation_key; append-only. |
| quotes | folio, customer_id?, current_version_id, source, created_by, external_ref? | unique tenant/folio; circular FK current_version diferible si hace falta. |
| quote_versions | quote_id, revision_no, state, customer_snapshot JSONB, config_version, calculation_version, totals JSONB, valid_until, preview_hash, content_hash, issued_at? | unique tenant/quote/revision; snapshot inmutable si no DRAFT. |
| quote_items | quote_version_id, position, variant_id?, line_type, description, sku?, quantity, unit_price, discounts JSONB, tax JSONB, totals JSONB, sat_snapshot JSONB | unique tenant/quote_version/position. |
| quote_acceptances | quote_version_id, actor_type, actor_ref, channel, confirmation_ref, terms_version, content_hash, occurred_at | unique tenant/quote_version; orden creada misma tx. |
| orders | folio, quote_version_id?, customer_id?, source, commercial_state, fulfillment_state, current_revision_id, has_open_dispute | unique tenant/folio; unique tenant/quote_version where not null. |
| order_revisions | order_id, revision_no, state, customer_snapshot JSONB, delivery JSONB, totals JSONB, content_hash, accepted_at?, accepted_by?, terms_version | unique tenant/order/revision; LOCKED no editable. |
| order_items | order_revision_id, position, variant_id?, snapshot JSONB, quantity, line_total | unique tenant/revision/position. |
| checkout_sessions | order_revision_id, state, expires_at, buyer_session_hash?, accepted_hash | estado PREPARING/READY/PROCESSING/COMPLETED/FAILED/EXPIRED. |
| public_links | resource_type, resource_id, token_hash, token_cipher_ref, expires_at, state | hash unique; ACTIVE/CONSUMED/REVOKED/EXPIRED. |
| payment_attempts | order_id, order_revision_id, checkout_session_id, provider, merchant_ref, operation_key, provider_session_id?, amount, currency, status, expires_at?, last_checked_at?, livemode | unique tenant/operation_key y provider/merchant/session where not null; livemode=false. |
| payment_transactions | attempt_id, provider_transaction_id, merchant_ref, amount, currency, succeeded_at, verified_at, livemode | unique provider/merchant/transaction; inmutable; livemode=false. |
| refunds | transaction_id, refund_key, amount, status, reason, authorized_by, provider_ref?, completed_at? | unique tenant/refund_key; suma reservas/success bloqueada transacción. |
| payment_disputes | transaction_id, provider_ref, amount, state, resolution?, resolved_at? | unique tenant/provider_ref; no borrar ledger. |
| incidents | type, order_id?, payment_id?, state, assigned_to?, resolution?, reason?, resolved_at? | idx tenant/state/created_at. |
| fulfillment_events | order_id, from_state, to_state, tracking?, actor_id | append-only. |
| whatsapp_connections | type, external_ref, phone_identity?, secret_ref, state, state_version, health_at? | unique tenant/phone_identity where active; admite null previo alta. |
| conversations | connection_id, customer_id, thread_id, state, control_version, assigned_to?, last_message_at | idx tenant/connection/customer/state; thread único tenant. |
| messages | conversation_id, connection_id, provider_message_id?, local_message_id, direction, kind, text?, media_id?, reply_to?, status, provider_at?, received_at | unique connection/provider_message_id where not null; local ID unique tenant. |
| agent_runs | conversation_id, triggering_message_id, model_id, prompt_version, status, cost, latency_ms, tools_summary JSONB | idx tenant/conversation/time; no chain-of-thought. |
| product_embeddings | variant_id, model_id, source_version, vector, content_hash | tenant filter y unique tenant/variant/model/version. |
| model_registry | model_id, capability, prompt_version, eval_ref, enabled | unique tenant/model/capability/prompt. |
| templates | provider_connection_id?, purpose, name, language, state, variables_schema JSONB | unique tenant/connection/name/language. |
| notifications | purpose, event_id, customer_id, channel, connection_id, rendered_payload_ref, state, expected_control_version? | unique tenant/event/customer/purpose/channel. |
| notification_attempts | notification_id, attempt_no, provider_message_id?, status, error_code?, sent_at? | unique notification/attempt_no. |
| reminders | order_id, policy_version, ordinal, scheduled_at, state, suppression_reason? | unique tenant/order/policy/ordinal. |
| integrations | name, external_system, source_ownership JSONB, enabled | unique tenant/name. |
| external_references | integration_id, entity_type, external_id, internal_id, external_version?, payload_hash | unique tenant/integration/type/external_id. |
| field_overrides | entity_type, entity_id, field, value JSONB, reason, actor, expires_at? | una override activa por campo/entity. |
| webhook_subscriptions | url_cipher?, events JSONB, secret_ref, state, verified_at?, capabilities JSONB | tenant index; secret sin claro. |
| webhook_deliveries | subscription_id, event_id, attempt_no, status, next_at?, http_status?, response_excerpt?, latency_ms | unique subscription/event/attempt_no. |
| outbox_events | event_id, type, aggregate_id, aggregate_version, schema_version, payload_ref, status, lease_until?, attempts | event_id unique; idx status/next_attempt. |
| inbox_events | consumer, provider, connection_ref?, event_id, payload_hash, received_at, status | unique consumer/provider/connection/event. |
| idempotency_records | principal_id, operation, key_hash, request_hash, status, resource_ref?, response_ref?, expires_at | unique tenant/principal/operation/key_hash. |
| jobs / import_rows | type, state, progress, result_ref?, error; job_id,row_no,status,error JSONB,entity_ref? | unique job/row; tenant guarded. |
| audit_logs | actor_type, actor_id, action, entity_type, entity_id, diff_redacted JSONB, correlation_id, occurred_at | append-only; idx tenant/entity/time. |
| timeline_events | entity_type, entity_id, event_id, summary, occurred_at, received_at | unique tenant/entity/event. |
| retention_holds / purge_journal | entity_type, entity_id, reason, release_at?; purge_type, cutoff, result | política OPS, no secretos. |

Dummy schema aparte: merchants(id,key_hash,webhook_secret_ref), sessions(operation_key,merchant_id,order_ref,revision_ref,amount,currency,state,expires_at,token_hash,scenario_id), transactions(session_id,amount,state), refunds(transaction_id,key,amount,state), scenario_plans(config JSONB,actor), event_outbox(event_id,payload,delivery_at,attempts). No FK hacia commerce; las referencias externas son strings.

## Estados y transiciones con guardas

| Entidad | Desde → hacia | Guarda / efecto |
| --- | --- | --- |
| QuoteVersion | DRAFT→ISSUED | Preview hash coincide; snapshot, link, outbox. |
| QuoteVersion | ISSUED→ACCEPTED | Vigente, actual, confirmación explícita; crea order una vez. |
| QuoteVersion | ISSUED→SUPERSEDED | Emisión atómica de nueva revisión, sin aceptación concurrente. |
| QuoteVersion | ISSUED→REJECTED/EXPIRED/CANCELED | Actor/motivo o reloj válido; cancelar recordatorios. |
| OrderRevision | DRAFT→ACCEPTED→LOCKED | Hash/terms aceptados; LOCKED cuando sesión activa. |
| OrderRevision | DRAFT/ACCEPTED→REPLACED | No pago activo/desconocido; nueva revisión. |
| Order | PENDING_PAYMENT→CONFIRMED | Transacción verificada y sin incidencia bloqueante, stock consumible. |
| Order | PENDING_PAYMENT→CANCELED | Autorizado; intenta cancelar sesión; conserva conciliación. |
| Order | CONFIRMED→CANCELED | Cancelación comercial autorizada y plan de resolución; finanzas separadas. |
| Order | CONFIRMED/CANCELED→CLOSED | Entrega/resolución terminada, sin incidencia abierta. |
| PaymentAttempt | CREATED→PENDING/UNKNOWN/FAILED | Respuesta o timeout del proveedor. |
| PaymentAttempt | PENDING/UNKNOWN→SUCCEEDED/FAILED/CANCELED/EXPIRED | Consulta autenticada final, no reloj cliente. |
| PaymentAttempt | SUCCEEDED→SUCCEEDED | Repetición no-op; reembolso es otra entidad. |
| PaymentAttempt | CANCELED/EXPIRED/FAILED→SUCCEEDED excepcional | Nueva evidencia de transacción verificada; incidente LATE_PAYMENT; no se ignora dinero. |
| Reservation | ACTIVE→CONSUMED | Pago validado, operación única. |
| Reservation | ACTIVE→RELEASED/EXPIRED | Cancelación/fallo/vencimiento; operación única. |
| Refund | REQUESTED→PENDING→SUCCEEDED/FAILED | Actor autorizado, saldo reservado y provider verified. |
| Conversation | BOT_ACTIVE/WAITING_CUSTOMER→HUMAN_ACTIVE | CAS controlVersion; cancelar salida caducada. |
| Conversation | HUMAN_ACTIVE→BOT_ACTIVE | Retomar explícito y nueva versión. |

Transición no listada es error STATE_CONFLICT salvo variante descrita en SPEC propietaria. “Pago confirmado con stock faltante” registra transaction y financiero PAID, mantiene pedido sin avanzar a cumplimiento y abre incidencia; no inventa un reembolso ni altera el ingreso.

## Migraciones y concurrencia

Locks de order antes de revisions/payments; balances ordenados por variantId. Refund lock transaction antes de refunds. CAS para datos editables y control chat. Backfill por lotes para columnas nuevas NOT NULL, luego CHECK/constraint; índices grandes con estrategia compatible. Eventos guardan schemaVersion independiente de versión DB. Tests de restore/migración pertenecen a OPS; QA de dinero/facturas externas queda limitada al alcance comercial declarado.
