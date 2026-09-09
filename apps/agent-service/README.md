# Agent Service

Agente comercial conversacional de NetPay Plane: responde preguntas del negocio,
busca en el catálogo, cotiza con la calculadora oficial, emite la cotización y
manda el enlace de pago. Especificación: [`docs/11-aia.md`](../../docs/11-aia.md).

## Dos motores, un solo grafo

| Motor | Cuándo se usa | Qué hace |
| --- | --- | --- |
| `LLMEngine` | Hay `OPENROUTER_KEY_REF` y el `MODEL_ID` está en el registro con tool calling | Bucle de herramientas con OpenRouter y presupuesto por turno |
| `RuleEngine` | Falta la clave, el modelo no soporta tools, se agotó el presupuesto o el proveedor falló | Intención por reglas en es-MX; usa las mismas herramientas reales |

Los dos comparten estado, allowlist de herramientas, checkpoints y criterio de
handoff. Los importes siempre vienen del backend, nunca del modelo.

## Conocimiento del negocio

Los `.md` de [`knowledge/`](knowledge/) son la fuente de verdad de horarios,
envíos, pagos, garantías, promociones y demás políticas. El frontmatter de
`negocio.md` define la identidad del agente (nombre, tono, moneda, saludo), así
que cambiar de negocio es editar Markdown, no código.

Las líneas `> interno:` son guía para el agente y nunca se le repiten al cliente.

Endpoints: `GET /knowledge`, `POST /knowledge/reload`, `GET /knowledge/search?q=`.

## Herramientas

`answer_business_question`, `search_products`, `get_variant`, `availability`,
`calculate_quote`, `create_and_issue_quote`, `accept_quote`,
`get_checkout_link`, `get_order_status`, `request_human`.

Cada una declara su scope; el `ToolGateway` rechaza lo que no esté autorizado y
deduplica comandos mutantes por `commandId`. `GET /tools` lista el contrato.

## Endpoints

```
GET  /healthz              estado del agente, LLM, backend y conocimiento
GET  /readyz               listo para conversar + advertencias de configuración
GET  /diagnostics          registro de modelos, presupuestos y salud del backend
POST /chat                 turno conversacional (texto o audio)
GET  /conversations/{id}   estado del grafo
POST /conversations/{id}/release  devuelve el control al bot tras un handoff
POST /audio/stt            transcripción
POST /audio/tts            voz de salida
GET  /knowledge            documentos y secciones indexadas
GET  /tools                herramientas y scopes
GET  /evals                suite de 120 casos
```

## Local

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8000

.venv/bin/python -m pytest -q          # pruebas de aceptación
.venv/bin/python -m app.evals          # suite de 120 casos, sin red
.venv/bin/python -m app.evals --live --report evals.json
```

Para que cotice de verdad necesita la API key de servicio que imprime
`pnpm db:seed`:

```bash
export AGENT_API_KEY_REF=npk_xxx_yyy
export COMMERCE_API_URL=http://localhost:4000/api/v1
```

Sin ella el agente conversa y responde del negocio, pero no calcula totales ni
emite cotizaciones: lo dice y escala a un humano.

## Variables

`OPENROUTER_KEY_REF`, `MODEL_ID`, `MODEL_ID_FALLBACK`, `STT_MODEL_ID`,
`TTS_MODEL_ID`, `TTS_VOICE`, `AGENT_TEMPERATURE`, `AGENT_MAX_TOKENS`,
`COMMERCE_API_URL`, `AGENT_API_KEY_REF`, `KNOWLEDGE_DIR`, `KNOWLEDGE_TOP_K`,
`AGENT_CHECKPOINT_DIR`, `AGENT_MAX_TOOL_STEPS`, `AGENT_TURN_BUDGET_SECONDS`,
`AGENT_MAX_INPUT_CHARS`, `AGENT_HISTORY_WINDOW`, `AGENT_SUMMARIZE_AFTER`,
`AGENT_MAX_COST_USD`, `AGENT_MAX_AUDIO_BYTES`, `PUBLIC_BASE_URL`.

## Estado de tareas

| Tarea | Estado | Evidencia |
| --- | --- | --- |
| T-AIA-01 estado y checkpoints | Hecho | `app/state.py`, `tests/test_agent.py::test_checkpoint_resume_keeps_quote` |
| T-AIA-02 ModelGateway | Hecho | `app/providers/model_gateway.py`, `model_registry.json` |
| T-AIA-03 matching explicable | Hecho | `app/matching.py`, categoría `exact_sku`/`fuzzy` de la suite |
| T-AIA-04 tool gateway | Hecho | `app/tools.py`, compuerta `tool_authorization` |
| T-AIA-05 STT/TTS | Hecho | `app/providers/model_gateway.py`, `/audio/*` |
| T-AIA-06 turnos y handoff | Hecho | `app/graph.py`, `test_human_takeover_silences_bot` |
| T-AIA-07 suite de evaluación | Hecho | `app/evals/`, 120 casos con compuertas críticas |
