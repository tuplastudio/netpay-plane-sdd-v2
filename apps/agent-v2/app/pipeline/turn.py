"""Orquestador de un turno de `POST /chat`.

Orden fijo de etapas (cada una es apagable o configurable por env y se
reporta en `GET /diagnostics`):

    neutralize ─► idempotencia (pre) ─► ráfaga (coalesce)
      ─► lock por hilo ─► idempotencia ─► handoff activo
      ─► heurísticas de inyección / fuera de tema ─► clasificador LLM de tema
      ─► compactación por presupuesto ─► grafo (+ reintento si transitorio)
      ─► respuesta final (o respaldo determinista) ─► guard de salida
      ─► formato del canal ─► señales / episodio ─► ChatResponse

Nada aquí conoce FastAPI: los rechazos de validación salen como
`TurnRejected(status, detail)` y `api/chat.py` los convierte en HTTP. Así el
pipeline se prueba con un doble del grafo y sin servidor, y podría montarse
detrás de otro transporte (cola, gRPC) sin tocarlo.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import re
from typing import TYPE_CHECKING, Any

from langchain_core.messages import AIMessage, HumanMessage

from ..agent_settings import get_settings_store
from ..config import Settings
from ..contracts import ChatRequest, ChatResponse
from ..guards import (
    detect_injection,
    is_off_topic,
    neutralize,
    off_scope_category,
    redirect_reply,
    urls_from_messages,
)
from ..knowledge import load_profile
from ..memory import build_llm_summarizer, compact_thread, history_chars
from ..security import image_size_error
from ..state import TurnContext
from ..tenant_context import resolve_tenant_bundle
from ..text import format_for_whatsapp
from .failures import FailureKind, classify_failure, decide_failure
from .post_turn import record_learning, schedule_episode
from .replies import fallback_reply, final_reply, last_assistant_reply
from .responses import response_from_values
from .trace import TurnTrace

if TYPE_CHECKING:
    from ..runtime import Runtime

log = logging.getLogger("agent-v2.turn")

_URL_IN_TEXT = re.compile(r"https?://[^\s<>()\"']+", re.IGNORECASE)


class TurnRejected(Exception):
    """La request no puede procesarse; `api/chat.py` la convierte en HTTP."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def business_name(tenant_id: str) -> str:
    overrides = get_settings_store().get(tenant_id)
    return overrides.business_name or load_profile(tenant_id).name


def _urls_in(text: str) -> set[str]:
    return {m.group(0).rstrip(".,;:") for m in _URL_IN_TEXT.finditer(text or "")}


class TurnPipeline:
    def __init__(self, runtime: "Runtime", settings: Settings) -> None:
        self.runtime = runtime
        self.settings = settings

    # ------------------------------------------------------------ helpers

    def _channel_text(self, reply: str, channel: str) -> str:
        return format_for_whatsapp(reply) if channel == "whatsapp" else reply

    async def _remember(self, thread_id: str, message_id: str | None, response: ChatResponse) -> ChatResponse:
        await self.runtime.idempotency.put(thread_id, message_id, response.model_dump())
        return response

    def _turn_budget(self, req: ChatRequest) -> float:
        s = self.settings
        return s.turn_timeout_image_seconds if req.imageBase64 else s.turn_timeout_seconds

    async def _invoke(
        self,
        content: Any,
        config: dict[str, Any],
        context: TurnContext,
        budget: float,
        trace: TurnTrace,
    ) -> dict[str, Any]:
        """Invoca el grafo; ante un fallo transitorio reanuda el checkpoint una vez.

        `ainvoke(None, config)` continúa desde el último paso persistido por
        LangGraph: si el proveedor falló en la primera llamada al modelo, la
        repite; si falló después de una tool, NO vuelve a ejecutar la tool
        (no se duplica una cotización ni un pedido).
        """
        agent = self.runtime.agent
        loop = asyncio.get_running_loop()
        started = loop.time()
        try:
            return await asyncio.wait_for(
                agent.ainvoke({"messages": [HumanMessage(content=content)]}, config=config, context=context),
                timeout=budget,
            )
        except Exception as exc:  # noqa: BLE001 - se clasifica abajo
            kind = classify_failure(exc)
            remaining = budget - (loop.time() - started)
            if not (kind.retryable and self.settings.retry_transient_failures and remaining >= 3.0):
                raise
            log.warning("fallo transitorio del turno (%s), reanudando el checkpoint", type(exc).__name__)
            trace.note(retried=True)
            self.runtime.metrics.incr("turn.retried")
            return await asyncio.wait_for(
                agent.ainvoke(None, config=config, context=context), timeout=remaining
            )

    # ------------------------------------------------------------ turno

    async def run(self, req: ChatRequest) -> ChatResponse:
        s = self.settings
        rt = self.runtime
        trace = TurnTrace()

        # `neutralize` quita Unicode invisible y tokens de control de otros
        # formatos de chat antes de que el texto toque cualquier otra capa.
        text = neutralize((req.text or "").strip()[: s.max_input_chars])
        if not text and req.imageBase64:
            text = "[el cliente envió una imagen]"
        if not text:
            raise TurnRejected(400, "Se requiere text")
        if image_error := image_size_error(req.imageBase64):
            raise TurnRejected(413, image_error)
        if rt.agent is None:
            raise TurnRejected(503, "El agente todavía no está listo")

        conversation_id = req.conversationId or f"{req.tenantId}:{req.customerPhone or 'anon'}"
        # thread_id = conversación: aquí es donde LangGraph recupera el hilo previo.
        thread_id = f"{req.tenantId}:{conversation_id}"
        config: dict[str, Any] = {
            "configurable": {"thread_id": thread_id},
            "recursion_limit": s.recursion_limit,
        }
        context: TurnContext = {
            "tenant_id": req.tenantId,
            "conversation_id": conversation_id,
            "channel": req.channel,
            "scopes": list(req.principalScopes),
            "customer_phone": req.customerPhone,
            "customer_name": req.customerName,
            "customer_email": req.customerEmail,
        }
        rt.metrics.incr("turn.received")

        # Idempotencia ANTES de la ráfaga: un reintento de webhook con el
        # mismo messageId no debe pegarse a un turno nuevo como texto duplicado.
        cached = await rt.idempotency.get(thread_id, req.messageId)
        if cached is not None:
            log.info("messageId repetido, devolviendo respuesta previa: %s", req.messageId)
            rt.metrics.incr("turn.idempotent_hit")
            return ChatResponse(**cached)

        # Ráfaga: varios mensajes seguidos del mismo cliente = un solo turno.
        if rt.coalescer.enabled and req.channel in s.coalesce_channels and not req.imageBase64:
            burst = await rt.coalescer.collect(thread_id, text)
            if burst is None:
                rt.metrics.incr("turn.coalesced")
                trace.mark("coalesce", yielded=True)
                response = ChatResponse(
                    conversationId=conversation_id,
                    reply="",
                    handoff=False,
                    intent="COALESCED",
                    engine="coalesced",
                    latencyMs=trace.elapsed_ms,
                    turnId=trace.turn_id,
                )
                return await self._remember(thread_id, req.messageId, response)
            if len(burst) > 1:
                rt.metrics.incr("turn.burst_merged")
                text = "\n".join(burst)
            trace.mark("coalesce", merged=len(burst))

        content: Any = text
        if req.imageBase64:
            content = [
                {"type": "text", "text": text},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{req.imageBase64}"}},
            ]

        # Todo lo que sigue toca el mismo hilo: se serializa por conversación
        # (no globalmente) para que dos mensajes casi simultáneos del mismo
        # cliente no lean/escriban el carrito en desorden.
        lock = await rt.thread_locks.acquire(thread_id)
        async with lock:
            cached = await rt.idempotency.get(thread_id, req.messageId)
            if cached is not None:
                log.info("messageId repetido, devolviendo respuesta previa: %s", req.messageId)
                rt.metrics.incr("turn.idempotent_hit")
                return ChatResponse(**cached)

            snapshot = await rt.agent.aget_state(config)
            state_values: dict[str, Any] = dict(snapshot.values or {})
            trace.mark("load_state", messages=len(state_values.get("messages") or []))

            if state_values.get("handoff"):
                # Una persona ya tomó la conversación: el bot no vuelve a
                # publicar. Se registra el mensaje del cliente para que quien
                # la atienda vea el hilo completo, pero no se invoca al modelo.
                with contextlib.suppress(Exception):
                    await rt.agent.aupdate_state(config, {"messages": [HumanMessage(content=content)]})
                rt.metrics.incr("turn.handoff_active")
                response = response_from_values(
                    conversation_id,
                    state_values,
                    reply="",
                    handoff=True,
                    intent="HUMAN_ACTIVE",
                    engine="handoff",
                    latency_ms=0,
                    turn_id=trace.turn_id,
                )
                return await self._remember(thread_id, req.messageId, response)

            business = business_name(req.tenantId)

            def _redirect(intent: str, engine: str, reply: str) -> ChatResponse:
                rt.metrics.incr(f"turn.redirect.{intent.lower()}")
                trace.note(engine=engine, intent=intent)
                log.info("turn.done %s", trace.to_dict())
                return response_from_values(
                    conversation_id,
                    state_values,
                    reply=self._channel_text(reply, req.channel),
                    handoff=False,
                    intent=intent,
                    engine=engine,
                    latency_ms=trace.elapsed_ms,
                    turn_id=trace.turn_id,
                )

            # Capa 1 (determinista, sin tokens): inyección y fuera de tema obvio.
            if s.input_heuristics_enabled:
                verdict = detect_injection(text)
                if verdict.is_injection:
                    log.info("intento de inyección (%s) en tenant %s", verdict.label, req.tenantId)
                    response = _redirect("INYECCION", "injection-guard", redirect_reply(business, text))
                    return await self._remember(thread_id, req.messageId, response)
                category = off_scope_category(text) if not req.imageBase64 else None
                if category:
                    log.info("fuera de tema (%s) por heurística en tenant %s", category, req.tenantId)
                    response = _redirect(
                        "FUERA_DE_TEMA", f"scope-heuristic:{category}", redirect_reply(business, text)
                    )
                    return await self._remember(thread_id, req.messageId, response)
            trace.mark("input_heuristics")

            # Capa 2 (LLM barato): clasificador de tema. Solo texto: una imagen
            # o una nota de voz ya transcrita se dejan pasar al agente.
            if not req.imageBase64 and await is_off_topic(
                text,
                model=rt.scope_model,
                settings=s,
                business=business,
                forbidden_topics=get_settings_store().get(req.tenantId).forbidden_topics,
                last_reply=last_assistant_reply(state_values.get("messages") or []),
            ):
                log.info("mensaje fuera de tema por clasificador en tenant %s", req.tenantId)
                response = _redirect("FUERA_DE_TEMA", "scope-guard", redirect_reply(business, text))
                return await self._remember(thread_id, req.messageId, response)
            trace.mark("scope_guard")

            # Higiene de contexto: si el historial ya pesa más que el
            # presupuesto, se compacta ANTES de invocar. Los hechos comerciales
            # viven en el estado y no dependen de esto.
            if s.compact_after_chars > 0 and history_chars(state_values.get("messages")) > s.compact_after_chars:
                with contextlib.suppress(Exception):
                    await compact_thread(
                        rt.agent,
                        config,
                        keep_turns=s.compact_keep_turns,
                        summarizer=build_llm_summarizer(rt.utility_model) if rt.utility_model else None,
                        reason="presupuesto",
                    )
                rt.metrics.incr("turn.compacted")
                trace.mark("compact")

            try:
                result = await self._invoke(content, config, context, self._turn_budget(req), trace)
            except Exception as exc:  # noqa: BLE001 - el canal necesita una respuesta, no un stacktrace
                return await self._handle_failure(
                    exc, req, conversation_id, thread_id, config, state_values, trace
                )
            trace.mark("graph")

            messages = result.get("messages", [])
            reply, reply_message = final_reply(messages)
            engine = "langgraph"
            if not reply:
                # El modelo cerró el turno sin texto (solo tool calls, o
                # contenido vacío). Un "" lo descarta el puente de WhatsApp y
                # el cliente se queda esperando: se contesta algo útil y
                # determinista según el estado.
                reply = fallback_reply(result)
                engine = "reply-fallback"
                rt.metrics.incr("turn.reply_fallback")
                log.warning("turno sin texto del modelo en tenant %s; respaldo determinista", req.tenantId)

            # Capa 3: guard de salida. Si el modelo filtró el prompt, notas
            # internas, código o un enlace inventado, la respuesta se sustituye
            # y el AIMessage del hilo también.
            if reply and s.output_guard_enabled:
                bundle = await resolve_tenant_bundle(req.tenantId, include_catalog=False, include_lessons=False)
                verdict = rt.output_guard.check(
                    reply,
                    business=business,
                    protected_lines=bundle.prompt.protected_lines() if bundle.prompt else (),
                    internal_notes=bundle.internal_notes,
                    allowed_urls=urls_from_messages(messages) | _urls_in(bundle.knowledge),
                    seed=f"{thread_id}:{req.messageId or text}",
                )
                if verdict.changed:
                    log.warning("guard de salida (%s) en tenant %s", ",".join(verdict.reasons), req.tenantId)
                    rt.metrics.incr("turn.output_guard")
                    reply = verdict.reply
                    if not verdict.allowed:
                        engine = "output-guard"
                    if reply_message is not None and getattr(reply_message, "id", None):
                        with contextlib.suppress(Exception):
                            await rt.agent.aupdate_state(
                                config, {"messages": [AIMessage(content=reply, id=reply_message.id)]}
                            )
                trace.mark("output_guard", changed=verdict.changed or None)

            if reply and req.channel == "whatsapp":
                reply = format_for_whatsapp(reply)

            tool_calls = [
                {"tool": m.name, "result": (m.content or "")[:400]}
                for m in messages
                if m.__class__.__name__ == "ToolMessage"
            ][-20:]

            handoff = bool(result.get("handoff"))
            await record_learning(
                tenant_id=req.tenantId,
                conversation_id=conversation_id,
                question=text,
                reply=reply,
                handoff=handoff,
                messages=messages,
                handoff_reason=result.get("handoff_reason"),
            )
            if handoff:
                # La conversación pasa a una persona: para el agente terminó.
                rt.metrics.incr("turn.handoff")
                schedule_episode(rt, req.tenantId, conversation_id, req.channel, messages, result)

            post_update: dict[str, Any] = {}
            if result.get("pending_attachment"):
                # El adjunto es de este turno; si se queda en el checkpoint se
                # reenviaría también en el próximo turno.
                post_update["pending_attachment"] = None
            if int(result.get("failure_streak") or 0) > 0:
                # Un turno que salió bien cierra la racha de fallos técnicos.
                post_update["failure_streak"] = 0
            if post_update:
                with contextlib.suppress(Exception):
                    await rt.agent.aupdate_state(config, post_update)

            latency_ms = trace.elapsed_ms
            trace.note(engine=engine, intent=result.get("stage"), handoff=handoff or None, tools=len(tool_calls))
            trace.mark("post_turn")
            rt.metrics.incr("turn.ok")
            rt.metrics.observe_latency(latency_ms)
            log.info("turn.done %s", trace.to_dict())

            response = response_from_values(
                conversation_id,
                result,
                reply=reply,
                handoff=handoff,
                intent=result.get("stage"),
                engine=engine,
                latency_ms=latency_ms,
                tool_calls=tool_calls,
                turn_id=trace.turn_id,
            )
            return await self._remember(thread_id, req.messageId, response)

    # ------------------------------------------------------------ fallos

    async def _handle_failure(
        self,
        exc: BaseException,
        req: ChatRequest,
        conversation_id: str,
        thread_id: str,
        config: dict[str, Any],
        state_values: dict[str, Any],
        trace: TurnTrace,
    ) -> ChatResponse:
        """Aplica la política de fallos (ver `failures.py`) y contesta 200."""
        rt = self.runtime
        kind = classify_failure(exc)
        decision = decide_failure(
            kind,
            int(state_values.get("failure_streak") or 0),
            handoff_after=self.settings.handoff_after_failures,
        )
        rt.metrics.incr(f"turn.failure.{kind.name.lower()}")
        log_fn = log.exception if kind in (FailureKind.FATAL, FailureKind.RECURSION_LIMIT) else log.warning
        log_fn(
            "fallo del turno (%s, racha=%s) en tenant %s: %s",
            kind.value, decision.streak, req.tenantId, "handoff" if decision.handoff else "respuesta suave",
        )

        if decision.handoff:
            # Se marca handoff en el hilo para que los próximos mensajes de
            # este cliente tampoco vuelvan a pegarle a un grafo que ya se
            # demostró que falla, hasta que una persona lo libere.
            rt.metrics.incr("turn.handoff")
            update: dict[str, Any] = {
                "handoff": True,
                "handoff_reason": kind.value,
                "stage": "HUMANO",
                "failure_streak": decision.streak,
            }
        else:
            update = {"failure_streak": decision.streak}
        with contextlib.suppress(Exception):
            await rt.agent.aupdate_state(config, update)
            # Se relee para que la respuesta refleje lo recién persistido
            # (p. ej. `stage`) en vez del snapshot de antes del fallo.
            state_values = dict((await rt.agent.aget_state(config)).values or state_values)

        trace.note(engine=decision.engine, intent=decision.intent, streak=decision.streak)
        trace.mark("failure")
        log.info("turn.done %s", trace.to_dict())
        response = response_from_values(
            conversation_id,
            state_values,
            reply=self._channel_text(decision.reply, req.channel),
            handoff=decision.handoff,
            intent=decision.intent,
            engine=decision.engine,
            latency_ms=trace.elapsed_ms,
            turn_id=trace.turn_id,
        )
        return await self._remember(thread_id, req.messageId, response)
