# NetPay Plane — Agente v2

Agente de ventas por WhatsApp/web sobre **LangGraph 1.2.11 + deepagents 0.7.13
+ langchain 1.4.0 + FastAPI**, hablando con OpenRouter (protocolo de la API
de OpenAI) como proveedor de modelo. Es el sucesor propuesto de
`apps/agent-service` (v1): mismo contrato HTTP (`POST /chat`), misma API
comercial detrás (`apps/commerce-api`), arquitectura interna distinta.

## Por qué existe (diferencias con v1)

| | v1 (`agent-service`) | v2 (`agent-v2`) |
|---|---|---|
| Motor | propio, hecho a mano; motor determinista + LLM opcional | LangGraph (grafo de agente) + deepagents; siempre pasa por el LLM |
| Estado del hilo | vive en el historial de mensajes recortado | campos propios del estado (`cart`, `customer`, `quote_id`, `stage`, …), persistidos por el checkpointer de LangGraph y **reinyectados en el prompt en cada turno** aunque el historial se resuma |
| Resumen de historial | recorte a ciegas por ventana de mensajes | `SummarizationMiddleware`: un modelo redacta el resumen; los hechos comerciales no dependen de él porque no viven en los mensajes |
| Planeación | ninguna | `write_todos` (deepagents) para pedidos de varios pasos |
| Herramientas | `search_products`, `create_and_issue_quote`, … (inglés) | `buscar_productos`, `agregar_al_carrito`, `calcular_total`, `emitir_cotizacion`, `convertir_en_pedido`, `generar_enlace_pago`, `estado_del_pedido`, `recordar_cliente`, `historial_del_cliente`, `detalle_de_cotizacion`, `escalar_a_humano` (español) |
| Evals | `app/evals/` con dataset de 120 casos, motor determinista, gratis | `app/evals/` (este directorio) — ver más abajo |

El problema concreto que v2 ataca es el que v1 tenía peor: **perder el hilo**
entre turnos (olvidar el carrito, volver a pedir el nombre, perder la
cotización a medio camino). Es justo lo que la suite de evals de este
directorio mide con más peso (`continuidad_multiturno`).

## Arquitectura, seguridad y memoria

Ver `docs/ARCHITECTURE.md` (mapa del código, flujo de un turno, tabla de
riesgos → capa) y `prompts/README.md` (cómo versionar el prompt). Resumen de
lo que hay además del grafo:

| Capa | Módulo | Qué hace |
|---|---|---|
| Prompts versionados | `app/prompts/`, `prompts/vX.Y.Z/` | Bloques `.md` por versión, `latest` automático, versión fijable por tenant (`PUT /settings {"prompt_version": "1.0.0"}`) o por proceso (`PROMPT_VERSION`). `GET /prompts`, `POST /prompts/reload`. |
| Varios pedidos a la vez | `app/state.py` (`carts`), `app/tools.py` (`carritoId`) | El carrito no es único: es un diccionario de carritos por conversación, cada uno con su propia cotización/pedido/pago, aislados entre sí. Un solo pedido —el caso normal— se comporta igual que antes. Ver "Varios pedidos a la vez" en `docs/ARCHITECTURE.md`. |
| Sincronía con commerce-api | `POST /conversations/{id}/release` y `/close` | commerce-api los llama al devolver/reabrir/cerrar un hilo (y el autocierre) para que el handoff y los carritos no queden desfasados entre la base y el agente. Ver "Integración" en `docs/ARCHITECTURE.md`. |
| Contexto por tenant | `app/tenant_context.py` | Un solo grafo para todos los negocios: perfil + panel + catálogo + conocimiento + lecciones se arman por turno y se cachean por tenant. |
| Heurísticas de entrada | `app/guards/injection.py` | Inyección ("ignora tus reglas", "modo desarrollador", suplantar al admin) y fuera de alcance obvio (código, clima, tareas, ilegal) sin gastar tokens. |
| Clasificador de tema | `app/guards/scope.py` | LLM barato; falla abierto salvo `AGENT_SCOPE_GUARD_FAIL_CLOSED=1`. |
| Guard de salida | `app/guards/output.py` | Bloquea fugas del prompt/notas internas/secretos y código; enmascara tarjeta/CLABE/CURP; sustituye URLs que no vengan de una herramienta. También reescribe el `AIMessage` del hilo. |
| PII | `app/guards/pii.py` | Redacción en logs, señales de aprendizaje y memoria episódica. |
| Higiene de contexto | `app/memory/context.py` | Compactación automática por `AGENT_COMPACT_AFTER_CHARS` (resumen + últimos `AGENT_COMPACT_KEEP_TURNS` turnos) y manual: `POST /conversations/{id}/compact`, `DELETE /conversations/{id}/messages`. |
| Ráfagas de mensajes | `app/pipeline/coalesce.py` | Varios mensajes seguidos del mismo cliente por WhatsApp se contestan como UN turno (los primeros ceden con `intent=COALESCED`, el último invoca al modelo con los textos juntos). `AGENT_COALESCE_WINDOW_MS` (1500), `AGENT_COALESCE_CHANNELS` (`whatsapp`). |
| Política de fallos | `app/pipeline/failures.py` | Fallo transitorio del proveedor → reintento reanudando el checkpoint; fallo aislado → respuesta suave sin bloquear al bot (`engine=error-soft`); `AGENT_HANDOFF_AFTER_FAILURES` (3) fallos seguidos → handoff. Tope del turno 28 s, por debajo del puente (30 s). |
| Respuesta nunca vacía | `app/pipeline/replies.py` | Toma solo el texto de ESTE turno (str o bloques de contenido); si el modelo no dejó texto, respaldo determinista según el estado (`engine=reply-fallback`). |
| Observabilidad | `app/pipeline/trace.py` | `turnId` en cada respuesta, línea `turn.done` con duración por etapa, `GET /metrics` (contadores + p50/p95), `GET /conversations/{id}/messages` (transcript redactado). |
| Memoria episódica | `app/memory/episodic.py` | Al cerrar una conversación (`POST /conversations/{id}/close`, handoff, borrado) se guarda un episodio de *comportamiento* (ánimo, fricción, mejoras) sin datos de personas ni del negocio; se agrega como `<lecciones>` en el prompt. `GET /memory/episodes`, `/memory/episodes/stats`, `/memory/lessons`. |
| Memoria del cliente | `app/memory/profile.py` | Con el teléfono como llave, sobrevive al hilo: cuando el mismo número abre una conversación NUEVA, el agente ya sabe su nombre, su correo, su zona de entrega y en qué quedaron. Entra al prompt como `<memoria_cliente>`. El teléfono se guarda hasheado (HMAC con el tenant como sal) y `DELETE /memory/customers?phone=` lo borra. |

Variables nuevas (todas opcionales): `PROMPTS_DIR`, `PROMPT_VERSION`,
`AGENT_INPUT_HEURISTICS`, `AGENT_SCOPE_GUARD_FAIL_CLOSED`, `AGENT_OUTPUT_GUARD`,
`AGENT_COMPACT_AFTER_CHARS`, `AGENT_COMPACT_KEEP_TURNS`, `AGENT_EPISODIC_MEMORY`,
`EPISODIC_MODEL_ID`, `AGENT_EPISODIC_LESSONS`, `AGENT_CUSTOMER_MEMORY`,
`AGENT_CUSTOMER_MEMORY_TTL_DAYS`, `CUSTOMER_MEMORY_MODEL_ID`, `AGENT_TURN_TIMEOUT_SECONDS` (28),
`AGENT_TURN_TIMEOUT_IMAGE_SECONDS` (42), `AGENT_COALESCE_WINDOW_MS` (1500; 0
apaga), `AGENT_COALESCE_CHANNELS` (`whatsapp`), `AGENT_RETRY_TRANSIENT` (1),
`AGENT_HANDOFF_AFTER_FAILURES` (2; 1 = todo fallo es handoff, como antes),
`AGENT_TRANSCRIPT_LIMIT` (60). `GET /diagnostics` reporta el estado de cada
capa y `GET /metrics` los contadores del proceso.

Cómo está partido el código (detalle en `docs/ARCHITECTURE.md`): `main.py`
solo cablea; `runtime.py` guarda el estado de proceso (grafo, checkpointer,
locks, idempotencia, métricas); `api/` son routers sin lógica; `pipeline/`
es el turno de `POST /chat` por etapas (`turn.py` orquesta; `coalesce`,
`failures`, `replies`, `responses`, `post_turn`, `trace`); `contracts.py` es
el contrato HTTP compartido.

## Pruebas

```bash
cd apps/agent-v2
./.venv/bin/pip install -r requirements-dev.txt
./.venv/bin/python -m pytest -q
```

Sin red: la key es falsa y el grafo se sustituye por un doble en las pruebas
de API. Cubren prompts, PII, inyección/alcance, guard de salida,
compactación, memoria episódica, settings, política de fallos (reintento por
reanudación, suave → handoff), ráfagas de WhatsApp, respuesta vacía / bloques
de contenido, transcript, métricas y la API completa.

## Cómo correrlo

### Local (venv)

```bash
cd apps/agent-v2
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt

set -a; . ../../.env; set +a   # OPENROUTER_KEY_REF, AGENT_API_KEY_REF, ...
export COMMERCE_API_URL=http://localhost:4000/api/v1
export AGENT_V2_DATA_DIR=/tmp/agent-v2-data
export PUBLIC_BASE_URL=http://localhost:3001

./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload
```

`GET /healthz` debe responder `{"status": "ok"}`; `GET /readyz` confirma si
el LLM y `commerce-api` están configurados (`llm.live`, `commerce.ok`).

### Docker / compose

Ya está en `infra/compose.yaml` bajo el profile `full`:

```bash
docker compose -f infra/compose.yaml --profile full up -d --build agent-v2
```

Variables que necesita (ver `infra/compose.yaml`): `COMMERCE_API_URL`,
`AGENT_API_KEY_REF`, `OPENROUTER_KEY_REF`, `AGENT_INTERNAL_KEY`, `MODEL_ID`,
`PUBLIC_BASE_URL`, `AGENT_V2_DATA_DIR`. El contenedor expone `8010` y
persiste checkpoints en el volumen `agent_data`.

## Cómo correr los evals

```bash
cd apps/agent-v2
set -a; . ../../.env; set +a
export COMMERCE_API_URL=http://localhost:4000/api/v1
export AGENT_V2_DATA_DIR=/tmp/agent-v2-evals
export PUBLIC_BASE_URL=http://localhost:3001

./.venv/bin/python -m app.evals --dry-run   # cuenta casos/turnos, no gasta nada
./.venv/bin/python -m app.evals             # corre todo (gasta dinero real)
./.venv/bin/python -m app.evals --category continuidad_multiturno
./.venv/bin/python -m app.evals --limit 1   # como mucho 1 caso por categoría
./.venv/bin/python -m app.evals --judge     # + juicio por LLM (llamadas extra, opt-in)
```

A diferencia de v1, **v2 no tiene motor determinista**: cada turno consume
al menos una llamada al modelo, así que correr la suite siempre cuesta algo
real (unos centavos de dólar con `gpt-4o-mini`, ver la sección de resultados
más abajo). El diseño la mantiene chica y visible a propósito — ver
`app/evals/__init__.py` y `app/evals/dataset.py` para el detalle de qué mide
y cómo puntúa.

## Plan de migración v1 → v2

El corte es un solo env var, no un despliegue coordinado:
`apps/commerce-api/src/whatsapp/agent-bridge.service.ts` lee
`process.env.AGENT_URL` (default `http://localhost:8000`, el puerto de v1) en
cada request saliente hacia el agente — no hay estado ni caché de esa URL.
En `infra/compose.yaml`, `commerce-api` hoy apunta:

```yaml
AGENT_URL: http://agent-service:8000   # v1
```

y `agent-v2` ya corre en paralelo, en el mismo compose, en `:8010`
(`http://agent-v2:8010` dentro de la red de docker). Migrar es:

1. Correr `agent-v2` con el profile `full` junto a `agent-service` (ya
   pasa hoy: ambos tienen healthcheck y volumen propios).
2. Validar con esta suite de evals + tráfico de sombra (mandarle los mismos
   mensajes a los dos y comparar) antes de cortar tráfico real.
3. Cambiar `AGENT_URL: http://agent-v2:8010` en `infra/compose.yaml` (o el
   equivalente en el entorno de producción) y reiniciar `commerce-api`. No
   requiere cambios en `agent-bridge.service.ts` ni en el resto de
   `commerce-api`: el contrato de `/chat` es el mismo.
4. Dejar `agent-service` corriendo un tiempo como *fallback* manual (mismo
   volumen de checkpoints, mismo `commerce-api`) por si hay que revertir con
   solo cambiar `AGENT_URL` de vuelta.
5. Antes del corte definitivo, revisar `GET /metrics` un par de días con
   tráfico de sombra: `turn.failure.*`, `turn.retried` y `turn.reply_fallback`
   deben ser marginales frente a `turn.ok`; si no, subir
   `AGENT_TURN_TIMEOUT_SECONDS` o revisar el proveedor antes de cortar.

No es necesario apagar v1 para probar v2: corren en puertos distintos con
API keys de servicio propias, y `commerce-api` no distingue entre ellos.

## Endpoints

Todo detrás de `X-Internal-Key` salvo `GET /healthz`. Confírmalo con
`grep -rnE '@router\.(get|post|put|delete)' apps/agent-v2/app/api/`.

| Área | Endpoints |
|---|---|
| Salud | `GET /healthz`, `GET /readyz`, `GET /diagnostics`, `GET /metrics`, `GET /tools`, `GET /evals` (dry-run por defecto) |
| Conversación | `POST /chat` (mismo contrato que v1 + `carts[]`, `turnId`) |
| Hilo | `GET /conversations/{id}`, `GET /conversations/{id}/messages` (transcript, `redact=true` por defecto, `limit`), `POST .../compact`, `DELETE .../messages`, `POST .../close`, `DELETE /conversations/{id}`, `POST .../release` |
| Prompts | `GET /prompts`, `GET /prompts/{version}`, `POST /prompts/reload` |
| Ajustes | `GET/PUT/DELETE /settings`, `POST /moderation/reply` |
| Conocimiento | `GET /knowledge`, `GET /knowledge/search`, `POST /knowledge/upload`, `DELETE /knowledge/{docId}`, `POST /knowledge/reload`, `POST /knowledge/web/preview`, `POST /knowledge/web/save` |
| Aprendizaje | `GET /learning/signals`, `POST /learning/signals/{id}/approve`, `POST /learning/signals/{id}/dismiss` |
| Memoria | `GET /memory/episodes`, `GET /memory/episodes/stats`, `GET /memory/lessons`, `DELETE /memory/episodes`, `GET /memory/customers`, `GET /memory/customers/stats`, `GET /memory/customers/lookup?phone=`, `DELETE /memory/customers[?phone=]` |
| Audio | `POST /audio/stt`, `POST /audio/tts` (503 si el proveedor no lo soporta) |

Paridad con v1: completa (`/knowledge/*`, `/learning/*`, `/audio/*` y
`/evals` ya existen). Lo que v2 agrega sobre v1: `carts[]`, `turnId`,
`GET /metrics`, `GET /conversations/{id}/messages`, `POST .../compact`,
`DELETE .../messages`, `/memory/*`, `/prompts/*`.

## La suite de evals (`app/evals/`)

Ver el docstring de `app/evals/__init__.py` para el diseño completo. Resumen:

- **Qué mide**: que no invente precios, que el carrito/cliente sobrevivan
  varios turnos, que no repita datos ya conocidos, que llame la herramienta
  correcta, que no cotice sin un "sí" explícito, que el texto no traiga
  markdown de chat web (`**negritas**`, `# encabezados`, viñetas con guion,
  enlaces `[texto](url)`), y que escale a humano en queja/crédito/precio
  especial.
- **Cómo puntúa**: cada `EvalCase` es una conversación de 1+ turnos; cada
  turno declara el EFECTO esperado (herramienta llamada, SKU en el carrito,
  cotización emitida, etc.), nunca la redacción exacta. Dos compuertas
  automáticas corren en TODOS los turnos sin declararse por caso:
  `sin_precio_inventado` (todo `$NNN` en la respuesta debe salir del
  catálogo real o de una herramienta de esa misma conversación) y
  `formato_whatsapp` (nada de markdown de chat web en la respuesta cruda del
  modelo, antes del saneador de `app/text.py` — se prueba a propósito la
  salida cruda, porque el saneador puede tapar un mal hábito del prompt).
- **Costo**: v2 no tiene motor determinista, así que cada turno cuesta una
  llamada real al modelo. El dataset actual son 12 conversaciones / 21
  turnos. El juicio por LLM (`--judge`, en `judge.py`) es aparte, opcional, y
  solo se dispara en las conversaciones marcadas `judge=True` (las
  multi-turno) — una llamada extra por conversación, nunca por turno.
