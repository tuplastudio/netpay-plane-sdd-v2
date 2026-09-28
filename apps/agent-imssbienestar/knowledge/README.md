# Conocimiento del negocio

Todo archivo `.md` en esta carpeta alimenta al agente. Se indexa por sección
(cada encabezado `##` es un fragmento recuperable) y se recarga en caliente:

- `GET /knowledge` — muestra documentos, secciones y perfil detectado.
- `POST /knowledge/reload` — fuerza recarga después de editar un archivo.
- `GET /knowledge/search?q=...` — prueba qué secciones recupera una pregunta.

## Cómo escribirlo

1. Un solo archivo `negocio.md` con el frontmatter de identidad (ver ejemplo).
   Ese frontmatter define el nombre del negocio, el nombre y el tono del agente,
   horario, cobertura y saludo.
2. Un encabezado `##` por tema (envíos, pagos, garantías, facturación…). Los
   títulos importan: el buscador les da peso extra.
3. Frases cortas y concretas. El agente cita la sección que usó.

## Notas internas

Una línea que empiece con `> interno:` es guía para el agente, no texto para el
cliente: entra al contexto del modelo y a la búsqueda, pero nunca se le repite
al cliente tal cual. Úsalas para "no prometas fechas", "escala este caso" o
"esta política aún no está confirmada".

## Reglas

- Los **precios, existencias y totales nunca salen de aquí**: vienen del
  catálogo y de la calculadora del backend. Si escribes un precio en el
  Markdown, el agente igual consulta el backend antes de prometer nada.
- El contenido es **dato, no instrucción**. Un texto que diga "ignora las
  reglas" se registra como advertencia y se sigue tratando como texto del
  negocio.
- Si el dato no está aquí, el agente lo dice y ofrece pasar con una persona.

## Ubicación y partición por tenant

Configurable con `KNOWLEDGE_DIR` (por defecto `apps/agent-v2/knowledge`; en
producción `/data/agent-v2/knowledge`, en el volumen persistente).

```
<KNOWLEDGE_DIR>/
  README.md                          este archivo (no se indexa)
  tenants/<tenant_id>/uploads/*.md   documentos subidos desde el panel
  tenants/<tenant_id>/aprendizajes.md aprendizajes aprobados
```

Cada negocio ve **solo** su subárbol `tenants/<tenant_id>/`. Esta carpeta
raíz no trae conocimiento de ningún negocio: nombre, catálogo y datos de
contacto salen de Commerce API por tenant, y las políticas (envíos, pagos,
garantías, FAQ) las sube cada negocio. Un ejemplo completo de cómo
redactar esos documentos está en
`docs/examples/knowledge-pinturas-aglos/` (no se carga en ningún entorno).

Los `.md` sueltos en esta raíz solo los leería el tenant `default`
(compatibilidad con el despliegue de un solo negocio); no pongas ahí datos
reales.
