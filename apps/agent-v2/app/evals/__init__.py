"""Suite de evaluación del agente v2.

Equivalente funcional de `apps/agent-service/app/evals/` pero adaptada a la
arquitectura de v2 (LangGraph + deepagents): el estado vive en campos propios
(`carrito`, `cliente`, `cotización`, `etapa`) persistidos por el checkpointer,
y las herramientas son las de `app.tools` (`buscar_productos`,
`agregar_al_carrito`, etc.) en vez de las de v1.

Diferencia clave frente a v1: v1 tiene un motor determinista y puede correr
120 casos sin gastar un centavo (`--live` es opcional). v2 no tiene motor
determinista — cada turno pasa por el modelo vía OpenRouter — así que aquí el
diseño prioriza mantener acotado y visible el número de llamadas:

  - dataset chico (ver `dataset.py`): ~8 casos de un turno + 4 conversaciones
    multi-turno, ~21 turnos en total.
  - todas las aserciones por defecto son "baratas": comparan estado
    estructurado (carrito, cliente, cotización, herramientas llamadas) y
    patrones de texto, sin usar un LLM juez.
  - el juicio por LLM (`judge.py`) es opcional (`--judge`), cuesta una
    llamada extra por conversación multi-turno, y nunca es el modo por
    defecto.

Uso:
    python -m app.evals              # corre el dataset completo (real LLM)
    python -m app.evals --dry-run    # solo cuenta turnos/costo, no llama a nada
    python -m app.evals --limit 2    # primeras 2 conversaciones de cada categoría
    python -m app.evals --category continuidad_multiturno
    python -m app.evals --judge      # añade juicio por LLM en conversaciones marcadas
"""
