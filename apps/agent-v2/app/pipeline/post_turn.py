"""Lo que pasa DESPUÉS de contestar: señales de aprendizaje y episodios.

Todo es best-effort y nunca toca la respuesta que ya tiene el cliente. Se
separa del orquestador para que `turn.py` lea como el flujo del turno y
para que `api/conversations.py` (cerrar/borrar hilo) reutilice la captura
de episodios sin importar el pipeline completo.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from ..guards import redact_pii
from ..learning import get_learning_store, looks_like_unanswered
from ..security import clamp_text
from ..memory import (
    Episode,
    enrich_with_llm,
    forbidden_terms_from_state,
    get_episode_store,
    heuristic_episode,
)
from ..tenant_context import resolve_tenant_bundle

if TYPE_CHECKING:
    from ..runtime import Runtime

log = logging.getLogger("agent-v2.post_turn")


async def record_learning(
    *,
    tenant_id: str,
    conversation_id: str,
    question: str,
    reply: str,
    handoff: bool,
    messages: list[Any],
    handoff_reason: Any,
) -> None:
    """Deja la señal para que el dueño del negocio la revise en el panel.

    Si el almacén falla, el cliente ya tiene su respuesta y no se le va a
    romper la conversación por no poder registrar una señal.
    """
    store = get_learning_store()
    try:
        if handoff:
            # El resumen real lo escribió el modelo al llamar la herramienta;
            # en el estado solo sobrevive el motivo, así que se rescata del
            # tool_call antes de que el Command lo colapse.
            summary = ""
            reason = str(handoff_reason or "") or None
            for message in reversed(messages):
                for call in getattr(message, "tool_calls", None) or []:
                    if call.get("name") == "escalar_a_humano":
                        args = call.get("args") or {}
                        summary = clamp_text(str(args.get("resumen") or ""), 500, collapse_newlines=True)
                        reason = clamp_text(str(args.get("motivo") or ""), 80, collapse_newlines=True) or reason
                        break
                if summary:
                    break
            # La señal la lee el dueño del negocio en el panel: va sin
            # teléfonos, correos ni tarjetas del cliente.
            await store.record_handoff(
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                summary=redact_pii(summary or question),
                reason=reason,
            )
        elif reply and looks_like_unanswered(reply):
            await store.record_unanswered_question(
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                question=redact_pii(question),
            )
    except Exception:  # noqa: BLE001 - registrar la señal nunca puede tumbar el turno
        log.warning("no se pudo registrar la señal de aprendizaje", exc_info=True)


async def capture_episode(
    runtime: "Runtime",
    tenant_id: str,
    conversation_id: str,
    channel: str,
    messages: list[Any],
    values: dict[str, Any],
    *,
    extra_friction: tuple[str, ...] = (),
) -> Episode | None:
    """Extrae y guarda el episodio de una conversación terminada. Nunca lanza."""
    settings = runtime.settings
    if not settings.episodic_memory_enabled or not tenant_id:
        return None
    try:
        bundle = await resolve_tenant_bundle(tenant_id, include_catalog=False, include_lessons=False)
        overrides = bundle.overrides
        episode = heuristic_episode(
            messages,
            values,
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            channel=channel,
            prompt_version=bundle.prompt_version,
            model=overrides.effective_model(settings.model),
            extra_friction=extra_friction,
        )
        if runtime.utility_model is not None and messages:
            terms = forbidden_terms_from_state(
                values,
                bundle.business_name,
                bundle.profile.agent_name,
                overrides.agent_name,
                str(bundle.company.get("name") or ""),
            )
            episode = await enrich_with_llm(
                episode, messages, model=runtime.utility_model, forbidden_terms=terms
            )
        await get_episode_store().save(episode)
        return episode
    except Exception:  # noqa: BLE001 - la memoria episódica nunca afecta al cliente
        log.warning("no se pudo guardar el episodio de la conversación", exc_info=True)
        return None


def schedule_episode(
    runtime: "Runtime",
    tenant_id: str,
    conversation_id: str,
    channel: str,
    messages: list[Any],
    values: dict[str, Any],
) -> None:
    """Fire-and-forget: el turno no espera a la extracción."""
    if not runtime.settings.episodic_memory_enabled:
        return
    asyncio.ensure_future(
        capture_episode(runtime, tenant_id, conversation_id, channel, list(messages), dict(values))
    )
