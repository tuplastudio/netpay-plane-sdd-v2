# agent-imssbienestar

Agente de WhatsApp/web que orienta sobre **unidades médicas de IMSS-Bienestar Sinaloa**: dado un código
postal, una ubicación o un municipio, dice cuál es la unidad más cercana, su domicilio, su horario, si está
abierta ahora y qué servicios ofrece (EDI, estimulación temprana, prueba Battelle). No da consejo médico.

Es un derivado de `apps/agent-v2` (misma plataforma: pipeline, guards, prompts versionados, multi-tenant).
Lo específico de este agente:

| Qué | Dónde |
|---|---|
| Catálogo (83 unidades, 6 con Battelle) | `data/unidades.json` |
| Coordenadas por localidad | `data/geocodes.json` (generado con `scripts/geocode_unidades.py`) |
| Búsqueda, CP, cercanía, horarios | `app/unidades/` |
| Tolerancia a typos y errores de voz (fonética del español) | `app/unidades/difuso.py` |
| Municipios y localidades con coordenadas ("estoy en Mocorito") | `data/lugares.json` (generado con `scripts/geocode_lugares.py`) |
| Notas de voz: transcripción con pista de vocabulario | `app/audio.py`, `POST /audio/stt` o `audioBase64` en `/chat` |
| Tools del modelo | `app/tools.py` (`unidad_mas_cercana`, `buscar_unidades`, `detalle_de_unidad`, `escalar_a_humano`) |
| Prompt | `prompts/v1.0.0/` |
| Detector determinista de emergencias (911) | `app/guards/emergency.py` |
| Perfil del tenant `imss-sinaloa` | `knowledge/tenants/imss-sinaloa/negocio.md` |
| Chat de prueba (assistant-ui): tarjetas de unidad, chips, aviso de emergencia | `chat-ui/` |
| Catálogo público para UIs (sin personal Battelle) | `GET /unidades`, `GET /unidades/{id}` |

## Contrato

`POST /chat` es el de agent-v2 más `location: {latitude, longitude, name?, address?}`. Sin `text`, el turno
se arma solo con la ubicación (el modelo la recibe como `[ubicación compartida: latitud=…, longitud=…]`).

## Correr

```bash
# agente (puerto 8011; necesita OPENROUTER_KEY_REF y MODEL_ID en el entorno o en apps/agent-imssbienestar/.env)
cd apps/agent-imssbienestar
python -m venv .venv && ./.venv/bin/pip install -r requirements-dev.txt
npm run dev

# chat de prueba (http://127.0.0.1:5175, reenvía /agent/* al agente)
cd chat-ui && npm install && npm run dev

# pruebas unitarias
npm test

# prueba de humo contra el agente en vivo (usa el modelo real)
python scripts/qa_smoke.py
```

## Entrada tolerante

- Escritura: `unidad_mas_cercana(lugar=…)` y `buscar_unidades` corrigen typos y confusiones fonéticas
  ("abolato" → Navolato, "los mochs" → Los Mochis, "batel" → Battelle). Cuando corrigen, la tool se lo
  dice al modelo y este lo confirma con el usuario ("Entendí Navolato, ¿correcto?"). Lo que no reconocen
  no se adivina: se pide el código postal o la ubicación.
- Voz: el chat de prueba graba con el micrófono, transcribe con `/audio/stt` y manda el texto (se ve
  como `🎤 …`). Whisper recibe un `prompt` con los nombres de lugares para acertar más.
- Un lugar sin unidad (Mocorito, Angostura, Elota…) se resuelve a su cabecera y se dan las unidades más
  cercanas con distancia. Las distancias son desde el centro del lugar, no desde el domicilio.

## Datos: límites que conviene conocer

- Las coordenadas son de la **localidad**, no del domicilio; toda distancia es aproximada y en línea recta.
  Unidades con `precision: "municipio"` están en la cabecera municipal y se penalizan al ordenar.
- Un CP que no está en el catálogo se resuelve al CP más cercano numéricamente (marcado como aproximado).
- Datos con problemas en la fuente quedan en el campo `notas` de cada unidad (CP duplicados o incompletos,
  Guamúchil con dos domicilios/horarios, 4 unidades sin domicilio ni horario, Ilama sin municipio).
- El nombre del personal que aplica Battelle está en los datos (`responsable`) pero **el agente no lo expone**.
- La memoria episódica y la de cliente vienen **apagadas** (`AGENT_EPISODIC_MEMORY`, `AGENT_CUSTOMER_MEMORY`):
  son datos de salud.

## Pendiente respecto a agent-v2

`docs/ARCHITECTURE.md`, `app/commerce.py`, `app/evals/` y el modelo de estado de carritos (`app/state.py`)
siguen siendo los de ventas; no se usan en este agente pero no se han retirado.
