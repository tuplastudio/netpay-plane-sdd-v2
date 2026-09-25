"""Memoria del agente v2, en tres niveles:

- **Hilo** (LangGraph checkpoint, ``state.py``): carrito, cliente,
  cotización y mensajes de UNA conversación. Fuente de verdad comercial.
- **Contexto** (``context.py``): cómo mantener ese hilo liviano —compactar
  el historial en un resumen conservando los últimos turnos, o vaciarlo sin
  perder los hechos comerciales.
- **Episódica** (``episodic.py``): qué aprendemos de CÓMO fue cada
  conversación (ánimo, fricción, mejoras), sin datos de personas ni del
  negocio, para inyectar lecciones de trato en el prompt.
- **Cliente** (``profile.py``): qué recordamos de QUIÉN es el cliente, con
  el teléfono como llave, para que el mismo número no tenga que repetir su
  nombre y su dirección en cada conversación nueva.

El conocimiento del negocio (``knowledge.py``) y las señales de aprendizaje
aprobadas por el dueño (``learning.py``) no son "memoria" en este sentido:
son configuración curada por humanos.
"""

from .context import (
    SUMMARY_PREFIX,
    CompactionResult,
    build_llm_summarizer,
    clear_history,
    compact_thread,
    cut_index,
    deterministic_summary,
    history_chars,
)
from .episodic import (
    FRICTION_CODES,
    MOODS,
    OUTCOMES,
    Episode,
    EpisodeStore,
    conversation_key,
    enrich_with_llm,
    forbidden_terms_from_state,
    get_episode_store,
    heuristic_episode,
    redacted_transcript,
    render_lessons,
    reset_episode_store,
    scrub_list,
    scrub_text,
)
from .profile import (
    CustomerProfile,
    CustomerProfileStore,
    extract_facts_with_llm,
    facts_from_state,
    get_profile_store,
    merge_profile,
    normalize_phone,
    profile_key,
    render_profile,
    reset_profile_store,
)

__all__ = [
    "FRICTION_CODES",
    "MOODS",
    "OUTCOMES",
    "SUMMARY_PREFIX",
    "CompactionResult",
    "CustomerProfile",
    "CustomerProfileStore",
    "Episode",
    "EpisodeStore",
    "build_llm_summarizer",
    "clear_history",
    "compact_thread",
    "conversation_key",
    "cut_index",
    "deterministic_summary",
    "enrich_with_llm",
    "extract_facts_with_llm",
    "facts_from_state",
    "forbidden_terms_from_state",
    "get_episode_store",
    "get_profile_store",
    "heuristic_episode",
    "history_chars",
    "merge_profile",
    "normalize_phone",
    "profile_key",
    "redacted_transcript",
    "render_lessons",
    "render_profile",
    "reset_episode_store",
    "reset_profile_store",
    "scrub_list",
    "scrub_text",
]
