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
| Memoria episódica | `app/memory/episodic.py` | Al cerrar una conversación (`POST /conversations/{id}/close`, handoff, borrado) se guarda un episodio de *comportamiento* (ánimo, fricción, mejoras) sin datos de personas ni del negocio; se agrega como `<lecciones>` en el prompt. `GET /memory/episodes`, `/memory/episodes/stats`, `/memory/lessons`. |

Variables nuevas (todas opcionales): `PROMPTS_DIR`, `PROMPT_VERSION`,
`AGENT_INPUT_HEURISTICS`, `AGENT_SCOPE_GUARD_FAIL_CLOSED`, `AGENT_OUTPUT_GUARD`,
`AGENT_COMPACT_AFTER_CHARS`, `AGENT_COMPACT_KEEP_TURNS`, `AGENT_EPISODIC_MEMORY`,
`EPISODIC_MODEL_ID`, `AGENT_EPISODIC_LESSONS`. `GET /diagnostics` reporta el
estado de cada capa.

## Pruebas

```bash
cd apps/agent-v2
./.venv/bin/pip install -r requirements-dev.txt
./.venv/bin/python -m pytest -q
```

Sin red: la key es falsa y el grafo se sustituye por un doble en las pruebas
de API. Cubren prompts, PII, inyección/alcance, guard de salida,
compactación, memoria episódica, settings y la API.

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

### Exponer `GET /evals`

`app/evals/runner.py` expone `run_suite(...)` (async) listo para colgar de
un endpoint; no toqué `main.py` porque otro trabajo está en curso ahí. Falta
cablear algo como:

```python
from .evals.runner import run_suite

@app.get("/evals")
async def evals(
    judge: bool = False,
    category: list[str] | None = Query(default=None),
    limit: int | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    return await run_suite(categories=category, judge=judge, limit=limit, dry_run=dry_run)
```

Recomendación: que `dry_run` sea `True` por defecto en el endpoint HTTP (a
diferencia del CLI) para que un `GET /evals` accidental no gaste dinero; que
la corrida real solo se dispare con `?dry_run=false` explícito, o mejor,
protegido detrás de `X-Internal-Key` como el resto de rutas mutantes.

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
5. Antes del corte definitivo, cerrar los huecos de paridad de abajo que
   afecten al panel/operación (especialmente `/settings` y `/knowledge`, que
   el panel de administración probablemente ya usa contra v1).

No es necesario apagar v1 para probar v2: corren en puertos distintos con
API keys de servicio propias, y `commerce-api` no distingue entre ellos.

## Paridad de endpoints con v1

Estado real revisado al terminar este trabajo (otros dos agentes seguían
tocando `main.py`, `agent_settings.py` y `security.py` en paralelo, así que
esto es una foto, no una promesa — confírmalo con `grep -nE
'@app\.(get|post|put|delete)' apps/agent-v2/app/main.py` antes de fiarte a
ciegas):

| Endpoint (v1) | v2 |
|---|---|
| `GET /healthz` | ✅ |
| `GET /readyz` | ✅ |
| `GET /diagnostics` | ✅ |
| `POST /chat` | ✅ (mismo contrato) |
| `GET /conversations/{id}` | ✅ |
| `DELETE /conversations/{id}` | ✅ (ya la agregaron en paralelo) |
| `POST /conversations/{id}/release` | ✅ (ya la agregaron en paralelo) |
| `POST /audio/stt` | ❌ falta |
| `POST /audio/tts` | ❌ falta |
| `GET /settings` | ✅ (ya la agregaron en paralelo) |
| `PUT /settings` | ✅ |
| `DELETE /settings` | ✅ |
| `GET /knowledge` (listar documentos) | ❌ falta (solo existe `POST /knowledge/reload`) |
| `GET /knowledge/search` | ❌ falta |
| `POST /knowledge/upload` | ❌ falta |
| `DELETE /knowledge/{doc_id}` | ❌ falta |
| `GET /learning/signals` | ❌ falta |
| `POST /learning/signals/{id}/approve` | ❌ falta |
| `POST /learning/signals/{id}/dismiss` | ❌ falta |
| `GET /tools` | ✅ (ya la agregaron en paralelo) |
| `GET /evals` | ❌ falta cablear (ver arriba; la lógica ya existe en `app/evals/runner.py`) |

Huecos que quedan y probablemente importan para operar v2 en producción:
**`/knowledge` completo** (hoy solo se puede recargar desde disco, no subir
ni buscar documentos desde el panel) y **`/learning/signals`** (v1 aprende de
señales de conversación; v2 todavía no tiene ese circuito). `/audio/*`
(voz por WhatsApp) tampoco existe todavía en v2.

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
