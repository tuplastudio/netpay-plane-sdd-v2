# Arquitectura del agente v2

Agente de ventas conversacional multi-tenant (WhatsApp / chat web) sobre
LangGraph + deepagents + FastAPI. Este documento describe cómo está
organizado el código, cómo fluye un turno y qué garantiza cada capa de
seguridad y de memoria. Para correrlo, ver `README.md`.

## Principios

1. **Un grafo, N negocios.** Hay un único grafo compilado por proceso. Todo
   lo que distingue a un negocio (identidad, catálogo, conocimiento, reglas,
   modelo, versión de prompt) se resuelve *por turno* a partir del
   `tenant_id` autenticado y se inyecta en el prompt. Dar de alta un negocio
   no requiere desplegar nada.
2. **Los hechos viven en el estado, no en el historial.** Carrito, cliente,
   cotización, pedido y etapa son campos del estado de LangGraph con sus
   propios reducers (`state.py`). El historial de mensajes se puede resumir,
   compactar o vaciar sin perder la venta.
3. **Datos ≠ instrucciones.** Lo que escribe el cliente, las imágenes, los
   resultados de herramientas, el catálogo y el conocimiento del negocio
   son datos. Las únicas instrucciones son el prompt de sistema versionado,
   y hay capas deterministas que no dependen de que el modelo lo respete.
4. **Falla hacia el cliente, no hacia el silencio.** Un proveedor caído, un
   modelo mal configurado o un guard roto degradan a una respuesta segura o
   a handoff humano, nunca a un 500 sin respuesta en WhatsApp.
5. **La memoria episódica no sabe de nadie.** Lo que se aprende entre
   conversaciones es sobre *cómo* conversar; nunca contiene datos de
   personas ni del negocio.

## Mapa del código

```
app/
  main.py              Cableado: .env, lifespan (Runtime), CORS, routers de api/
  runtime.py           Estado de proceso: checkpointer, grafo, locks por hilo,
                       idempotencia, coalescer de ráfagas, métricas, pipeline
  contracts.py         ChatRequest / ChatResponse (contrato de POST /chat, = v1)
  api/                 Capa HTTP (FastAPI), un router por área, sin lógica
    deps.py            X-Internal-Key, runtime listo (503), thread_id
    chat.py            POST /chat → pipeline.turn (TurnRejected → HTTP)
    conversations.py   GET estado, GET transcript, compact, clear, close,
                       delete, release
    health.py          /healthz, /readyz, /diagnostics, /metrics, /tools, /evals
    prompts.py · settings.py · knowledge.py · learning.py · memory.py · audio.py
  pipeline/            Un turno de conversación, por etapas
    turn.py            Orquestador: orden fijo de capas (ver abajo)
    coalesce.py        Ráfagas de mensajes seguidos = un solo turno
    failures.py        Clasificación del fallo, reintento, suave vs. handoff
    replies.py         Texto final del modelo (str o bloques), respaldo, chips
    responses.py       Estado del hilo → ChatResponse
    post_turn.py       Señales de aprendizaje y episodios (best-effort)
    trace.py           Traza por turno (`turn.done`) y métricas del proceso
  agent.py             Grafo compilado (deepagents), modelo por tenant, resumen
  state.py             SalesState (carritos concurrentes, cliente, racha de
                       fallos) + TurnContext
  tools.py             Herramientas comerciales (scopes, Command con deltas)
  commerce.py          Cliente HTTP firmado hacia commerce-api
  tenant_context.py    TenantBundle: perfil + overrides + catálogo + conocimiento
                       + versión de prompt + lecciones, cacheado por tenant
  config.py            Settings por env (sin secretos en código)
  agent_settings.py    Configuración por tenant desde el panel (JSON cifrado)
  knowledge.py         Markdown del negocio por tenant, notas internas aparte
  learning.py          Señales que revisa el dueño (aprobación humana)
  security.py          Scopes de tools, saneo de texto, tamaño de imagen
  text.py              Formato WhatsApp
  audio.py             STT/TTS
  moderation.py        Filtro de respuestas humanas del inbox
  prompts/             Registro de prompts versionados + ensamblador
    registry.py        prompts/vX.Y.Z/ → PromptVersion; latest; fijado por tenant
    assembler.py       Orden fijo de bloques + delimitadores de datos
  guards/              Capas que no confían en el modelo
    pii.py             Detección/redacción de PII; filtro de logs
    injection.py       Heurísticas de inyección y fuera de alcance (sin LLM)
    scope.py           Clasificador LLM de tema (falla abierto por defecto)
    output.py          Guard de salida: fugas, código, URLs, datos sensibles
  memory/              Memoria en tres niveles
    context.py         Compactar / vaciar el historial de un hilo
    episodic.py        Episodios de comportamiento por conversación + lecciones
  evals/               Suite de evaluación (cuesta dinero real)
prompts/               Versiones del prompt en disco (ver prompts/README.md)
knowledge/             Conocimiento del negocio (Markdown por tenant)
tests/                 Pruebas unitarias y de API (sin red)
```

Regla de dependencias: `api/` → `pipeline/` → dominio (`agent`, `state`,
`tools`, `guards`, `memory`, …). El pipeline no conoce FastAPI (rechaza con
`TurnRejected(status, detail)`); los routers no contienen lógica de negocio;
`runtime.py` es el único estado global y las pruebas lo sustituyen pieza por
pieza (`runtime.agent = FakeAgent()`).

## Flujo de un turno (`POST /chat`, `pipeline/turn.py`)

```
request ──► neutralize (Unicode invisible, tokens de control)
        ──► idempotencia por messageId (pre) ─► respuesta cacheada
        ──► [pipeline/coalesce] ráfaga de mensajes ─► cede (COALESCED) o junta
        ──► lock por hilo ─► idempotencia ─► handoff activo (solo anota el mensaje)
        ──► [guards/injection] detect_injection ─► redirect (INYECCION)
        ──► [guards/injection] off_scope_category ─► redirect (FUERA_DE_TEMA)
        ──► [guards/scope]     is_off_topic (LLM barato) ─► redirect
        ──► [memory/context]   compact_thread si el historial pesa demasiado
        ──► grafo (deepagents) con tope de tiempo por debajo del puente
              └─ sales_prompt: TenantBundle + PromptVersion → SystemMessage
              └─ tools con scopes del contexto (nunca del modelo)
              └─ SummarizationMiddleware por número de mensajes
              └─ fallo transitorio ─► reanuda el checkpoint una vez
              └─ fallo definitivo ─► [pipeline/failures] suave o handoff
        ──► [pipeline/replies] texto de ESTE turno (str o bloques) o respaldo
        ──► [guards/output]    OutputGuard.check ─► sustituye reply y AIMessage
        ──► format_for_whatsapp
        ──► [pipeline/post_turn] señal de aprendizaje (PII redactada) / episodio
        ──► limpia adjunto del turno y racha de fallos ─► ChatResponse (+ turnId)
```

Cada capa es independiente y apagable o ajustable por env
(`AGENT_INPUT_HEURISTICS`, `AGENT_SCOPE_GUARD`, `AGENT_OUTPUT_GUARD`,
`AGENT_COMPACT_AFTER_CHARS`, `AGENT_COALESCE_WINDOW_MS`,
`AGENT_RETRY_TRANSIENT`, `AGENT_HANDOFF_AFTER_FAILURES`,
`AGENT_EPISODIC_MEMORY`). `GET /diagnostics` muestra el estado de todas.

### Presupuesto de tiempo

commerce-api (`agent-bridge.service.ts`) aborta la llamada al agente a los
30 s (45 s con imagen) y descarta cualquier respuesta que no sea 2xx. Por
eso el tope del turno (`AGENT_TURN_TIMEOUT_SECONDS`, 28 s;
`AGENT_TURN_TIMEOUT_IMAGE_SECONDS`, 42 s) queda **por debajo**: cuando el
agente degrada (reintento, respuesta suave o handoff) todavía hay alguien
del otro lado para recibirlo. Un tope de 90 s, como había antes, producía
respuestas que nadie leía y hilos marcados en handoff sin que el cliente
recibiera ni el aviso.

### Ráfagas de mensajes (`pipeline/coalesce.py`)

En WhatsApp la gente escribe "hola" / "quiero 2 playeras" / "rojas" en tres
mensajes seguidos. Cada request espera `AGENT_COALESCE_WINDOW_MS` (1500)
desde el ÚLTIMO mensaje del mismo hilo; si llega otro, la request cede
(`reply=""`, `intent="COALESCED"`, `engine="coalesced"`: el puente no manda
nada) y el último de la ráfaga invoca al modelo con los textos juntos,
separados por salto de línea. Esto funciona con cualquier versión del
prompt: el modelo ve varias líneas en un solo mensaje de cliente y ya
suele leerlas como una idea. El prompt `1.3.0` (en `draft`, no es `latest`
todavía) lo hace explícito y además cubre ritmo de cierre; para activarlo
en un tenant, fijar `prompt_version: "1.3.0"` en `PUT /settings` o correr
los evals reales y promoverlo a `stable` en `prompts/v1.3.0/manifest.yaml`.
Solo aplica a los canales de `AGENT_COALESCE_CHANNELS` (`whatsapp`) y nunca
a mensajes con imagen. La idempotencia se resuelve ANTES de la ráfaga para
que un reintento de webhook no se pegue como texto duplicado.

### Política de fallos (`pipeline/failures.py`)

Antes, cualquier excepción del grafo marcaba el hilo en handoff: un 502 del
proveedor dejaba al cliente con "ya le avisé a una persona" y al bot mudo
hasta que alguien lo liberara en el panel. Ahora:

| Fallo | Clase | Reintento | Cliente recibe |
|---|---|---|---|
| Red / 5xx / 429 / timeout del proveedor dentro del turno | `PROVEEDOR_TRANSITORIO` | Sí: `ainvoke(None, config)` reanuda el checkpoint (no repite la entrada ni las tools ya ejecutadas) | Respuesta normal si el reintento sale; si no, ver racha |
| Tope del turno (`asyncio.wait_for`) | `TIMEOUT` | No | Según racha |
| Bug, configuración, error no clasificado | `ERROR_TECNICO` | No | Según racha |
| Tope de recursión (el modelo entró en bucle) | `RECURSION_LIMIT` | No | Handoff siempre |

La **racha** (`SalesState.failure_streak`) cuenta fallos seguidos en ese
hilo: por debajo de `AGENT_HANDOFF_AFTER_FAILURES` (2) el cliente recibe una
respuesta suave ("se me trabó el sistema, ¿me repites?") con
`engine="error-soft"` y el bot sigue atendiendo; al alcanzarla, handoff
(`engine="error-fallback"`, `stage=HUMANO`) hasta `POST
/conversations/{id}/release`. Un turno que sale bien, o el `release`, la
regresan a 0. Con `AGENT_HANDOFF_AFTER_FAILURES=1` se recupera el
comportamiento anterior.

### Respuesta nunca vacía (`pipeline/replies.py`)

Solo cuenta el texto del asistente posterior al último mensaje del cliente
(antes se tomaba "el último AIMessage del hilo", que podía ser el del turno
anterior). El contenido puede venir como `str` o como lista de bloques
(modelos de Anthropic vía OpenRouter). Si aun así no hay texto, se contesta
un respaldo determinista según el estado (enlace de pago, cotización,
carrito) con `engine="reply-fallback"`: un `""` lo descarta el puente y el
cliente se queda esperando.

### Observabilidad (`pipeline/trace.py`)

Cada turno lleva un `turnId` (en `ChatResponse.turnId`) y termina en una
línea de log `turn.done {...}` con la duración por etapa, motor, intent y
si hubo reintento — nunca el texto del cliente ni de la respuesta.
`GET /metrics` expone contadores del proceso (`turn.ok`, `turn.retried`,
`turn.failure.*`, `turn.coalesced`, `turn.output_guard`, `turn.reply_fallback`,
`turn.handoff`, …) y latencias p50/p95. `GET /conversations/{id}/messages`
devuelve el transcript que ve el modelo (redactado por defecto) para
responder "¿por qué contestó eso?" sin abrir el sqlite.

## Prompts versionados

`prompts/vX.Y.Z/` contiene bloques `.md` (orden alfabético), un
`manifest.yaml` y estilos opcionales. El registro (`app/prompts/registry.py`)
carga todas las versiones al arrancar, resuelve `latest` (la más alta que no
sea `draft`) y permite fijar una versión por tenant desde el panel
(`PUT /settings {"prompt_version": "1.0.0"}`) o por proceso (`PROMPT_VERSION`).
Una versión inexistente degrada a `latest` con warning: el agente nunca se
queda sin prompt. `POST /prompts/reload` relee el disco sin reiniciar.

El ensamblador (`app/prompts/assembler.py`) construye el prompt del turno en
un orden fijo: identidad → bloques estáticos → estilo de venta → ajustes del
panel → `<reglas_negocio>` → `<lecciones>` → `<memoria_conversacion>` →
`<catalogo>` → `<informacion_negocio>`. Todo lo dinámico va entre
delimitadores; los delimitadores dentro de contenido no confiable se
neutralizan para que un producto o documento no pueda "cerrar" un bloque.

Ver `prompts/README.md` para cómo publicar una versión nueva.

## Seguridad y privacidad

| Riesgo | Capa | Dónde |
|---|---|---|
| Inyección por chat ("ignora tus reglas", "modo desarrollador", suplantar al admin) | Heurística determinista antes del LLM; prompt 1.1.0 lo trata como dato | `guards/injection.py`, `prompts/v1.1.0/05_*` |
| Inyección vía catálogo / documento / imagen | Saneo de texto de tools, delimitadores escapados, prompt | `security.py`, `prompts/assembler.py` |
| Uso fuera de alcance (clima, código, tareas, ilegal) | Heurística (sin tokens) + clasificador LLM + prompt + guard de salida (código) | `guards/injection.py`, `guards/scope.py`, `guards/output.py` |
| Fuga del prompt / notas internas / secretos | Guard de salida compara líneas protegidas; sustituye reply y AIMessage | `guards/output.py`, `PromptVersion.protected_lines` |
| URLs inventadas | Solo URLs de tools, del conocimiento o de `PUBLIC_BASE_URL` | `guards/output.py` |
| PII en memoria episódica | Esquema cerrado + redacción antes y después del LLM + términos prohibidos | `memory/episodic.py` |
| PII en señales del panel | Redacción antes de guardar | `pipeline/post_turn.py` (`record_learning`) |
| PII en logs | `RedactingFilter` en todos los handlers | `guards/pii.py`, `main._lifespan` (instala el filtro) |
| Datos sensibles (tarjeta, CLABE, CURP) repetidos por el modelo | Enmascarado en la salida; prompt prohíbe pedirlos | `guards/output.py` |
| Tenant/scopes decididos por el modelo | Siempre vienen de `runtime.context` (request autenticada) | `tools.py`, `security.py` |
| Cruce de conocimiento entre negocios | Subárbol por tenant, caché por tenant | `knowledge.py` |
| Secretos de tenant en disco | AES-256-GCM con `AGENT_SECRET_KEY` | `agent_settings.py` |

## Varios pedidos a la vez

Un cliente real no siempre lleva un solo carrito: puede estar cotizando dos
pedidos distintos en paralelo, preguntar por el total de uno mientras arma
el otro, o pedir un cambio en una cotización que ya se emitió antes en la
misma charla. `SalesState.carts` es un diccionario `carritoId -> CartRecord`
(no un carrito único): cada registro lleva su propio carrito, total,
cotización, pedido y enlace de pago.

- **Resolución por defecto.** Todas las tools de carrito/cotización/pedido
  (`agregar_al_carrito`, `calcular_total`, `emitir_cotizacion`,
  `convertir_en_pedido`, `generar_enlace_pago`, `estado_del_pedido`,
  `solicitar_factura`) reciben `carritoId` opcional. Vacío resuelve al
  carrito **activo** (`active_cart_id`, el último que tocó una tool), así
  que una conversación de un solo pedido —la inmensa mayoría— nunca necesita
  pensar en IDs: se comporta exactamente igual que con un carrito único.
- **Abrir un carrito nuevo es decisión del modelo.** El prompt (bloque
  `65_carritos_multiples.md`, desde v1.2.0) le dice cuándo: solo si el
  pedido es claramente distinto del que ya tiene abierto, nunca por agregar
  otro producto al mismo pedido. El id es texto libre corto (`"playeras"`,
  `"2"`) saneado en `tools._sanitize_cart_id`.
- **Aislamiento.** El reducer `_merge_carts` (`state.py`) funde el delta de
  CADA carrito por separado — igual que antes hacía `_merge_cart` con las
  líneas de un único carrito, pero ahora una tool nunca puede pisar el
  registro de otro carrito, ni siquiera cuando varias tool calls del mismo
  turno tocan carritos distintos. Emitir la cotización de un carrito nunca
  reutiliza ni invalida la de otro (folios independientes).
- **Visibilidad.** `state.working_memory_block` lista todos los carritos
  abiertos con su `[id]` cuando hay más de uno (silencioso si solo hay uno).
  `ChatResponse.carts[]` expone lo mismo a la API; los campos singulares
  (`cart`, `totals`, `quote`, `checkout`) se mantienen por compatibilidad y
  reflejan el carrito activo.
- **Memoria episódica y resumen.** `memory/episodic.py` y
  `memory/context.py` agregan a través de TODOS los carritos (el resultado
  más avanzado, el conteo de carritos abiertos), nunca de uno solo.

Ver `tests/test_state_multicart.py` (el reducer) y
`tests/test_tools_multicart.py` (las tools, con un `CommerceClient` falso)
para la prueba de que dos carritos concurrentes no se cruzan; el eval
`mt-05-dos-pedidos-a-la-vez-no-se-mezclan` (`app/evals/dataset.py`) lo
ejercita contra el modelo real.

## Memoria

**Hilo** (checkpoint de LangGraph): mensajes + `SalesState` (carrito(s),
cliente, cotización(es), pedido(s) — ver "Varios pedidos a la vez" arriba).
Se recupera por `thread_id = tenant:conversación`.

**Contexto** (`memory/context.py`): dos mecanismos de higiene.

- Automático: si `history_chars` supera `AGENT_COMPACT_AFTER_CHARS`, antes
  de invocar se sustituyen los mensajes viejos por un único resumen
  (LLM si hay key, determinista si no) y se conservan los últimos
  `AGENT_COMPACT_KEEP_TURNS` turnos del cliente. El corte siempre cae en un
  mensaje del cliente para no partir un par tool_call/ToolMessage.
- Manual: `POST /conversations/{id}/compact` y
  `DELETE /conversations/{id}/messages` (vacía el historial, conserva
  carrito/cliente/cotización).

**Episódica** (`memory/episodic.py`): al terminar una conversación
(handoff, `POST /conversations/{id}/close`, `DELETE /conversations/{id}` o
autocierre) se extrae un `Episode` con turnos, etapa, resultado, ánimo,
fricción (códigos cerrados), qué funcionó y qué mejorar. Se guarda en
`episodes.sqlite` por tenant y se agrega en un bloque `<lecciones>` corto que
entra al prompt. Nunca contiene nombres, teléfonos, correos, productos,
precios ni texto literal: ver las tres capas en el docstring del módulo.

## Integración con commerce-api y el panel (una sola verdad por conversación)

`WhatsAppConversation` (Postgres, commerce-api) y el hilo del agente
(checkpoint de LangGraph) describen LA MISMA conversación y ambos llevan su
propia marca de handoff. Para que no se crucen, commerce-api es quien manda
sobre el ciclo de vida y le avisa al agente en cada transición
(`apps/commerce-api/src/whatsapp/agent-lifecycle.client.ts`):

| Evento en commerce-api | Llamada al agente | Efecto |
|---|---|---|
| Persona devuelve el hilo (`returnToAgent`) | `POST /conversations/{id}/release` | El agente vuelve a contestar (antes se quedaba en `handoff=True` y respondía vacío para siempre). |
| Reabrir a mano (`PATCH status=OPEN`) | `release` | Ídem. |
| Cerrar a mano (`PATCH status=CLOSED`) | `POST /conversations/{id}/close?delete=true` | Memoria episódica + se borra el checkpoint: el cliente que vuelve no hereda carritos viejos. |
| Autocierre por inactividad | `close?delete=true` por hilo (`closeMany`, lotes de 4) | Ídem, best-effort después del `updateMany`. |
| Cliente escribe a un hilo `CLOSED` (se reabre) | `release` (sin esperar) | Suelta cualquier handoff viejo. |
| Puente recibe `{reply:"", handoff:true, intent:"HUMAN_ACTIVE"}` con la base en "bot atiende" | `release` + reintento único de `/chat` (mismo `messageId`) | Red de seguridad si algún aviso anterior falló. |

Todo es best-effort: el agente caído nunca impide cerrar/reabrir en la base.
El panel (`apps/web`) y commerce-api deben apuntar al MISMO agente
(`AGENT_INTERNAL_URL` = `AGENT_URL`; `infra/compose.yaml` ya lo fuerza):
si no, el negocio edita ajustes y conocimiento en un agente y WhatsApp
contesta con otro.

Contrato `POST /chat` que consume cada lado:

- **WhatsApp (puente)**: `reply`, `handoff`, `intent`, `attachment`.
- **Chat web**: además `cart`, `quote{quoteId,linkRef,total}`,
  `checkout{linkRef,orderId}`, `carts[]` (varios pedidos), `suggestions`,
  `toolCalls`.
- **Panel de ajustes**: `GET/PUT /settings` incluye `prompt_version` y
  `options.prompt_version` (versiones cargadas).

## Añadir un negocio

1. Crear el tenant en commerce-api (obtiene `tenant_id`; la firma HMAC del
   agente ya lo cubre).
2. Opcional: `knowledge/tenants/<tenant_id>/negocio.md` con frontmatter de
   identidad y políticas; o subir documentos desde el panel.
3. Opcional: ajustes desde el panel (`PUT /settings?tenantId=...`): nombre,
   tono, estilo, temas prohibidos, modelo, `prompt_version`.
4. Nada que desplegar: el siguiente `POST /chat` con ese `tenantId` ya usa
   su contexto.

## Pruebas

`./.venv/bin/python -m pytest -q` (sin red). Cubren: registro y ensamblado
de prompts, PII, heurísticas de inyección/alcance, guard de salida,
compactación, memoria episódica, settings, clasificador de tema con fallo
abierto/cerrado, la política de fallos (`test_failures.py`), las ráfagas
(`test_coalesce.py`), la extracción/respaldo de respuesta
(`test_replies.py`) y la API completa con un doble del grafo
(`test_api.py`: reintento por reanudación, suave → handoff, respuesta
vacía, bloques de contenido, ráfaga por WhatsApp, transcript, métricas).
Los evals de `app/evals/` son aparte y cuestan dinero real.
