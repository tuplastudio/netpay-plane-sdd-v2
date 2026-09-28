# Prompts versionados

Cada carpeta `vX.Y.Z/` es una versión inmutable del prompt de sistema del
agente. El proceso carga todas al arrancar (`GET /prompts` las lista).

```
prompts/
  v1.0.0/                 línea base (prompt heredado, para rollback)
  v1.1.0/                 endurecido: seguridad, privacidad, delimitadores
  v1.2.0/                 varios carritos a la vez (carritoId)
  v1.2.1/                 necesidad sin nombre de producto → opciones y precio
  v1.3.0/                 ráfagas de mensajes, ritmo, correcciones y cierre
  v1.4.0/                 detalle_de_cotizacion, errores de tool,
                          notas de voz, complemento obvio, cancelación
  v1.4.1/                 error de tool ≠ escalar; estilos de venta robustos
  v1.5.0/                 latest: memoria del cliente entre conversaciones
                          (<memoria_cliente>)
    manifest.yaml         version, status, created, description, changelog
    00_identidad.md       plantilla con {{agent_name}}, {{business_name}}, ...
    05_seguridad_y_privacidad.md
    10_como_hablas.md
    ...                   bloques estáticos en orden alfabético
    styles/consultivo.md  bloque extra según `sales_style` del tenant
    styles/informativo.md
```

Toda versión publicada nombra las herramientas del agente (`tests/
test_prompt_registry.py` lo verifica para `latest`): si agregas una tool en
`app/tools.py`, publica una versión de prompt que diga cuándo usarla.

## Resolución de versión

1. `AgentSettings.prompt_version` del tenant (panel, `PUT /settings`).
2. `PROMPT_VERSION` del proceso (env; default `latest`).
3. `latest` = la versión más alta cuyo `status` no sea `draft`.

Una versión inexistente cae al siguiente nivel con un warning en logs; el
agente nunca se queda sin prompt.

## Plantillas

Los bloques admiten `{{variable}}`. La sustitución es **por línea**: si una
variable resuelve a vacío, la línea entera desaparece. Variables
disponibles: `agent_name`, `business_name`, `tone`, `language`, `currency`,
`hours`, `coverage`, `greeting`, `emoji_rule`. No uses `str.format`: las
llaves sueltas y el JSON de ejemplo son literales.

## Delimitadores de datos

El ensamblador (`app/prompts/assembler.py`) añade después de los bloques
estáticos: `<reglas_negocio>`, `<lecciones>`, `<memoria_conversacion>`,
`<memoria_cliente>`, `<catalogo>`, `<informacion_negocio>`. El prompt debe
referirse a ellos por esos nombres (desde v1.1.0; `<memoria_cliente>` desde
v1.5.0 — una versión congelada no se edita para nombrar un delimitador
posterior, sólo `latest` tiene que estar al día). Cualquier aparición de esas etiquetas dentro
del contenido dinámico se neutraliza (`‹catalogo›`).

## Publicar una versión nueva

1. Copia la carpeta más reciente a `vX.Y.Z` (semver: mayor = cambia el
   comportamiento comercial; menor = reglas nuevas; parche = redacción).
2. Edita los bloques; actualiza `manifest.yaml` (`status: draft` mientras
   se prueba: así `latest` no la toma, pero un tenant sí puede fijarla).
3. Corre `pytest` (hay pruebas que verifican que las versiones cargan y
   que la última nombra todos los delimitadores).
4. Corre los evals contra la versión (`PROMPT_VERSION=X.Y.Z python -m app.evals`).
5. Cambia `status` a `stable`. En un proceso vivo, `POST /prompts/reload`.

Las líneas de más de 40 caracteres de cualquier bloque quedan "protegidas":
si el modelo las repite literalmente, el guard de salida bloquea la
respuesta. Evita frases que el agente deba decir tal cual al cliente.
