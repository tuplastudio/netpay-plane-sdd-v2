"""Orquestador de un turno de `POST /chat`.

Orden fijo de etapas (cada una es apagable o configurable por env y se
reporta en `GET /diagnostics`):

    neutralize ─► idempotencia (pre) ─► ráfaga (coalesce)
      ─► lock por hilo ─► idempotencia ─► handoff activo
      ─► heurísticas de inyección / fuera de tema ─► clasificador LLM de tema
      ─► compactación por presupuesto ─► grafo (+ reintento si transitorio)
      ─► respuesta final (o respaldo determinista) ─► guard de salida
      ─► formato del canal ─► señales / episodio ─► ChatResponse

Cada etapa es un método `_*` de `TurnPipeline` que devuelve:

* `None`           → etapa siguiente,
* `ChatResponse`   → el turno termina ya con esa respuesta (inyección,
                     fuera de tema, handoff activo, coalesce cedido).

`run()` lee como un guion y un cambio de orden, un bypass de etapa o un
nuevo atajo no obligan a tocar el resto. Antes el mismo `run()` mezclaba
preparación, idempotencia, coalesce, lock, heurísticas, scope, compactación,
grafo, guard de salida y post-turn en 270 líneas.

Nada aquí conoce FastAPI: los rechazos de validación salen como
`TurnRejected(status, detail)` y `api/chat.py` los convierte en HTTP. Así el
pipeline se prueba con un doble del grafo y sin servidor.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import re
from dataclasses import dataclass, field
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
from ..log_context import bind_turn_id, reset_turn_id
from ..memory import build_llm_summarizer, compact_thread, history_chars
from ..security import image_size_error
from ..state import TurnContext
from ..tenant_context import TenantBundle, resolve_tenant_bundle
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


@dataclass
class PipelineContext:
    """Estado mutable de un turno, pasado por cada etapa.

    Mantenerlo como dataclass hace explícito qué datos cruzan la frontera
    entre etapas; antes vivían en variables locales de `run()` y era fácil
    perder de vista quién leía qué.

    Campos derivados cacheados:
    - `business_name`: `settings_store` + `load_profile` lo calculan cada
      vez; aquí se cachea tras `_prepare` para que `_stage_*` y el guard de
      salida no repitan la lectura.
    - `bundle`: el guard de salida lo pide con `include_catalog=False,
      include_lessons=False`; se cachea para no resolverlo dos veces si
      otra etapa (p. ej. un futuro guard de salida con catálogo) lo pide.
    """

    req: ChatRequest
    rt: Runtime
    settings: Settings
    trace: TurnTrace

    conversation_id: str = ""
    thread_id: str = ""
    config: dict[str, Any] = field(default_factory=dict)
    context: TurnContext = field(default_factory=dict)

    text: str = ""
    content: Any = ""
    state_values: dict[str, Any] = field(default_factory=dict)
    business_name: str = ""
    bundle: TenantBundle | None = None

    result: dict[str, Any] = field(default_factory=dict)
    reply: str = ""
    reply_message: AIMessage | None = None
    engine: str = "langgraph"
    handoff: bool = False
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    latency_ms: int = 0

    def ensure_business_name(self) -> str:
        if not self.business_name:
            self.business_name = business_name(self.req.tenantId)
        return self.business_name

    def redirect(
        self,
        *,
        intent: str,
        engine: str,
        reply: str,
        metric: str | None = None,
    ) -> ChatResponse:
        """Atajo: la etapa termina el turno con un redirect (inyección,
        fuera de tema, …). Devuelve el `ChatResponse` listo para que
        `run()` lo persista y devuelva."""
        formatted = format_for_whatsapp(reply) if self.req.channel == "whatsapp" else reply
        self.rt.metrics.incr(metric) if metric else None
        self.trace.note(engine=engine, intent=intent)
        log.info("turn.done %s", self.trace.to_dict())
        return response_from_values(
            self.conversation_id,
            self.state_values,
            reply=formatted,
            handoff=False,
            intent=intent,
            engine=engine,
            latency_ms=self.trace.elapsed_ms,
            turn_id=self.trace.turn_id,
        )


class TurnPipeline:
    def __init__(self, runtime: Runtime, settings: Settings) -> None:
        self.runtime = runtime
        self.settings = settings

    # ------------------------------------------------------------ helpers

    async def _remember(
        self, thread_id: str, message_id: str | None, response: ChatResponse
    ) -> ChatResponse:
        await self.runtime.idempotency.put(thread_id, message_id, response.model_dump())
        return response

    async def _cache_hit(
        self, thread_id: str, message_id: str | None
    ) -> ChatResponse | None:
        cached = await self.runtime.idempotency.get(thread_id, message_id)
        if cached is None:
            return None
        log.info("messageId repetido, devolviendo respuesta previa: %s", message_id)
        self.runtime.metrics.incr("turn.idempotent_hit")
        return ChatResponse(**cached)

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
        except Exception as exc:
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
        rt = self.runtime
        trace = TurnTrace()
        ctx = PipelineContext(req=req, rt=rt, settings=self.settings, trace=trace)
        rt.metrics.incr("turn.received")

        # Liga el turnId al contexto de asyncio: cualquier coroutine lanzada
        # dentro del turno (tools, hooks post-turn, background) lo lleva en
        # sus logs sin tener que pasarlo por argumento. `reset()` se hace en
        # el `finally` para no contaminar turnos siguientes.
        turn_token = bind_turn_id(trace.turn_id)
        try:
            response = await self._run(ctx, trace)
            return response
        finally:
            reset_turn_id(turn_token)

    async def _run(self, ctx: PipelineContext, trace: TurnTrace) -> ChatResponse:
        req = ctx.req
        rt = ctx.rt
        self._prepare(ctx)  # puede lanzar TurnRejected (400/413/503)

        # Idempotencia ANTES de la ráfaga: un reintento de webhook con el
        # mismo messageId no debe pegarse a un turno nuevo como texto
        # duplicado.
        if cached := await self._cache_hit(ctx.thread_id, req.messageId):
            return cached

        # Ráfaga de WhatsApp: mensajes seguidos del mismo cliente = 1 turno.
        if burst := await self._stage_coalesce(ctx):
            return await self._remember(ctx.thread_id, req.messageId, burst)

        # Todo lo que sigue toca el mismo hilo: lock por conversación.
        lock = await rt.thread_locks.acquire(ctx.thread_id)
        async with lock:
            if cached := await self._cache_hit(ctx.thread_id, req.messageId):
                return cached

            await self._load_state(ctx)

            # Una persona ya tomó la conversación: el bot no vuelve a publicar.
            if handoff_response := await self._stage_active_handoff(ctx):
                return await self._remember(ctx.thread_id, req.messageId, handoff_response)

            # Capas de entrada: heurísticas + clasificador de tema.
            for stage in (self._stage_input_heuristics, self._stage_scope_guard):
                if response := await stage(ctx):
                    return await self._remember(ctx.thread_id, req.messageId, response)

            # Higiene de contexto: compacta si el historial ya pesa demasiado.
            await self._stage_auto_compact(ctx)

            # Grafo + reintento si transitorio.
            try:
                ctx.result = await self._invoke(
                    ctx.content, ctx.config, ctx.context, self._turn_budget(req), trace
                )
            except Exception as exc:  # noqa: BLE001
                return await self._handle_failure(
                    exc, req, ctx.conversation_id, ctx.thread_id, ctx.config, ctx.state_values, trace
                )
            ctx.trace.mark("graph")

            # Respuesta final: respaldo si el modelo cerró sin texto + guard
            # de salida + formato del canal.
            await self._stage_finalize_reply(ctx)

            # Post-turn: señales, episodio, respuesta.
            response = await self._build_response(ctx)
            return await self._remember(ctx.thread_id, req.messageId, response)

    # ------------------------------------------------------------ etapas

    def _prepare(self, ctx: PipelineContext) -> None:
        """Sanea texto, valida imagen, resuelve ids. Si algo no pasa, lanza
        `TurnRejected` con el status HTTP correcto (400/413/503)."""
        s = ctx.settings
        req = ctx.req
        ctx.text = neutralize((req.text or "").strip()[: s.max_input_chars])
        if not ctx.text and req.imageBase64:
            ctx.text = "[el cliente envió una imagen]"
        if not ctx.text:
            raise TurnRejected(400, "Se requiere text")
        if image_error := image_size_error(req.imageBase64):
            raise TurnRejected(413, image_error)
        if ctx.rt.agent is None:
            raise TurnRejected(503, "El agente todavía no está listo")

        ctx.conversation_id = req.conversationId or f"{req.tenantId}:{req.customerPhone or 'anon'}"
        # thread_id = conversación: aquí es donde LangGraph recupera el hilo previo.
        ctx.thread_id = f"{req.tenantId}:{ctx.conversation_id}"
        ctx.config = {
            "configurable": {"thread_id": ctx.thread_id},
            "recursion_limit": s.recursion_limit,
        }
        ctx.context = {
            "tenant_id": req.tenantId,
            "conversation_id": ctx.conversation_id,
            "channel": req.channel,
            "scopes": list(req.principalScopes),
            "customer_phone": req.customerPhone,
            "customer_name": req.customerName,
            "customer_email": req.customerEmail,
        }

        if req.imageBase64:
            ctx.content = [
                {"type": "text", "text": ctx.text},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{req.imageBase64}"}},
            ]
        else:
            ctx.content = ctx.text

    async def _stage_coalesce(self, ctx: PipelineContext) -> ChatResponse | None:
        """Varios mensajes seguidos del mismo cliente por WhatsApp se
        contestan como UN turno (los primeros ceden con `intent=COALESCED`,
        el último invoca al modelo con los textos juntos)."""
        rt = ctx.rt
        req = ctx.req
        if not (
            rt.coalescer.enabled
            and req.channel in ctx.settings.coalesce_channels
            and not req.imageBase64
        ):
            return None
        burst = await rt.coalescer.collect(ctx.thread_id, ctx.text)
        if burst is None:
            rt.metrics.incr("turn.coalesced")
            ctx.trace.mark("coalesce", yielded=True)
            return ChatResponse(
                conversationId=ctx.conversation_id,
                reply="",
                handoff=False,
                intent="COALESCED",
                engine="coalesced",
                latencyMs=ctx.trace.elapsed_ms,
                turnId=ctx.trace.turn_id,
            )
        if len(burst) > 1:
            rt.metrics.incr("turn.burst_merged")
            ctx.text = "\n".join(burst)
            if not req.imageBase64:
                ctx.content = ctx.text
        ctx.trace.mark("coalesce", merged=len(burst))
        return None

    async def _load_state(self, ctx: PipelineContext) -> None:
        snapshot = await ctx.rt.agent.aget_state(ctx.config)
        ctx.state_values = dict(snapshot.values or {})
        ctx.trace.mark("load_state", messages=len(ctx.state_values.get("messages") or []))

    async def _stage_active_handoff(self, ctx: PipelineContext) -> ChatResponse | None:
        """Una persona ya tomó la conversación: el bot no vuelve a publicar.
        Se registra el mensaje del cliente para que quien la atienda vea el
        hilo completo, pero no se invoca al modelo."""
        if not ctx.state_values.get("handoff"):
            return None
        with contextlib.suppress(Exception):
            await ctx.rt.agent.aupdate_state(
                ctx.config, {"messages": [HumanMessage(content=ctx.content)]}
            )
        ctx.rt.metrics.incr("turn.handoff_active")
        return response_from_values(
            ctx.conversation_id,
            ctx.state_values,
            reply="",
            handoff=True,
            intent="HUMAN_ACTIVE",
            engine="handoff",
            latency_ms=0,
            turn_id=ctx.trace.turn_id,
        )

    async def _stage_input_heuristics(self, ctx: PipelineContext) -> ChatResponse | None:
        """Capa 1 (determinista, sin tokens): inyección y fuera de tema obvio."""
        if not ctx.settings.input_heuristics_enabled:
            ctx.trace.mark("input_heuristics")
            return None
        req = ctx.req
        business = ctx.ensure_business_name()
        verdict = detect_injection(ctx.text)
        if verdict.is_injection:
            log.info("intento de inyección (%s) en tenant %s", verdict.label, req.tenantId)
            return ctx.redirect(
                intent="INYECCION",
                engine="injection-guard",
                reply=redirect_reply(business, ctx.text),
                metric="turn.redirect.inyeccion",
            )
        category = off_scope_category(ctx.text) if not req.imageBase64 else None
        if category:
            log.info("fuera de tema (%s) por heurística en tenant %s", category, req.tenantId)
            return ctx.redirect(
                intent="FUERA_DE_TEMA",
                engine=f"scope-heuristic:{category}",
                reply=redirect_reply(business, ctx.text),
                metric="turn.redirect.fuera_de_tema",
            )
        ctx.trace.mark("input_heuristics")
        return None

    async def _stage_scope_guard(self, ctx: PipelineContext) -> ChatResponse | None:
        """Capa 2 (LLM barato): clasificador de tema. Solo texto: una imagen
        o una nota de voz ya transcrita se dejan pasar al agente."""
        req = ctx.req
        if req.imageBase64:
            ctx.trace.mark("scope_guard")
            return None
        business = ctx.ensure_business_name()
        if await is_off_topic(
            ctx.text,
            model=ctx.rt.scope_model,
            settings=ctx.settings,
            business=business,
            forbidden_topics=get_settings_store().get(req.tenantId).forbidden_topics,
            last_reply=last_assistant_reply(ctx.state_values.get("messages") or []),
        ):
            log.info("mensaje fuera de tema por clasificador en tenant %s", req.tenantId)
            return ctx.redirect(
                intent="FUERA_DE_TEMA",
                engine="scope-guard",
                reply=redirect_reply(business, ctx.text),
                metric="turn.redirect.fuera_de_tema",
            )
        ctx.trace.mark("scope_guard")
        return None

    async def _stage_auto_compact(self, ctx: PipelineContext) -> None:
        """Higiene de contexto: si el historial pesa más que el presupuesto,
        compacta ANTES de invocar. Los hechos comerciales viven en el estado
        y no dependen de esto."""
        s = ctx.settings
        if s.compact_after_chars <= 0:
            return
        if history_chars(ctx.state_values.get("messages")) <= s.compact_after_chars:
            return
        with contextlib.suppress(Exception):
            await compact_thread(
                ctx.rt.agent,
                ctx.config,
                keep_turns=s.compact_keep_turns,
                summarizer=build_llm_summarizer(ctx.rt.utility_model) if ctx.rt.utility_model else None,
                reason="presupuesto",
            )
        ctx.rt.metrics.incr("turn.compacted")
        ctx.trace.mark("compact")

    async def _stage_finalize_reply(self, ctx: PipelineContext) -> None:
        """Respaldo si el modelo cerró sin texto + guard de salida + WhatsApp."""
        req = ctx.req
        messages = ctx.result.get("messages", [])
        ctx.reply, ctx.reply_message = final_reply(messages)
        ctx.engine = "langgraph"

        if not ctx.reply:
            # El modelo cerró el turno sin texto (solo tool calls, o
            # contenido vacío). Un "" lo descarta el puente de WhatsApp y el
            # cliente se queda esperando: se contesta algo útil y
            # determinista según el estado.
            ctx.reply = fallback_reply(ctx.result)
            ctx.engine = "reply-fallback"
            ctx.rt.metrics.incr("turn.reply_fallback")
            log.warning("turno sin texto del modelo en tenant %s; respaldo determinista", req.tenantId)

        # Resuelve el bundle una sola vez para este turno (output guard + trace).
        bundle = await self._bundle_for_guard(ctx)
        if ctx.reply and ctx.settings.output_guard_enabled:
            await self._apply_output_guard(ctx, bundle, messages)

        if ctx.reply and req.channel == "whatsapp":
            ctx.reply = format_for_whatsapp(ctx.reply)

        ctx.tool_calls = [
            {"tool": m.name, "result": (m.content or "")[:400]}
            for m in messages
            if m.__class__.__name__ == "ToolMessage"
        ][-20:]

        ctx.handoff = bool(ctx.result.get("handoff"))

    async def _bundle_for_guard(self, ctx: PipelineContext) -> TenantBundle:
        """Carga el bundle sin catálogo ni lecciones — el guard solo
        necesita identidad, prompt protegido y notas internas. Cachea en
        `ctx.bundle` para no resolverlo dos veces (otros hooks del turno lo
        vuelven a usar)."""
        if ctx.bundle is not None:
            return ctx.bundle
        bundle = await resolve_tenant_bundle(
            ctx.req.tenantId, include_catalog=False, include_lessons=False
        )
        ctx.bundle = bundle
        return bundle

    async def _apply_output_guard(
        self, ctx: PipelineContext, bundle: TenantBundle, messages: list[Any]
    ) -> None:
        """Capa 3: guard de salida. Si el modelo filtró el prompt, notas
        internas, código o un enlace inventado, la respuesta se sustituye y
        el AIMessage del hilo también."""
        business = ctx.ensure_business_name()
        verdict = ctx.rt.output_guard.check(
            ctx.reply,
            business=business,
            protected_lines=bundle.prompt.protected_lines() if bundle.prompt else (),
            internal_notes=bundle.internal_notes,
            allowed_urls=urls_from_messages(messages) | _urls_in(bundle.knowledge),
            seed=f"{ctx.thread_id}:{ctx.req.messageId or ctx.text}",
        )
        if not verdict.changed:
            ctx.trace.mark("output_guard")
            return
        log.warning("guard de salida (%s) en tenant %s", ",".join(verdict.reasons), ctx.req.tenantId)
        ctx.rt.metrics.incr("turn.output_guard")
        ctx.reply = verdict.reply
        if not verdict.allowed:
            ctx.engine = "output-guard"
        if ctx.reply_message is not None and getattr(ctx.reply_message, "id", None):
            with contextlib.suppress(Exception):
                await ctx.rt.agent.aupdate_state(
                    ctx.config,
                    {"messages": [AIMessage(content=ctx.reply, id=ctx.reply_message.id)]},
                )
        ctx.trace.mark("output_guard", changed=True)

    async def _build_response(self, ctx: PipelineContext) -> ChatResponse:
        rt = ctx.rt
        req = ctx.req
        trace = ctx.trace
        messages = ctx.result.get("messages", [])
        handoff = ctx.handoff
        ctx.latency_ms = trace.elapsed_ms

        # Hooks post-turn: señales de aprendizaje (best-effort, en background)
        # y, si el hilo pasó a una persona, episodio (fire-and-forget).
        rt.background(
            record_learning(
                tenant_id=req.tenantId,
                conversation_id=ctx.conversation_id,
                question=ctx.text,
                reply=ctx.reply,
                handoff=handoff,
                messages=messages,
                handoff_reason=ctx.result.get("handoff_reason"),
            )
        )
        if handoff:
            rt.metrics.incr("turn.handoff")
            schedule_episode(rt, req.tenantId, ctx.conversation_id, req.channel, messages, ctx.result)

        post_update: dict[str, Any] = {}
        if ctx.result.get("pending_attachment"):
            # El adjunto es de este turno; si se queda en el checkpoint se
            # reenviaría también en el próximo turno.
            post_update["pending_attachment"] = None
        if int(ctx.result.get("failure_streak") or 0) > 0:
            # Un turno que salió bien cierra la racha de fallos técnicos.
            post_update["failure_streak"] = 0
        if post_update:
            with contextlib.suppress(Exception):
                await rt.agent.aupdate_state(ctx.config, post_update)

        trace.note(
            engine=ctx.engine,
            intent=ctx.result.get("stage"),
            handoff=handoff or None,
            tools=len(ctx.tool_calls),
        )
        trace.mark("post_turn")
        rt.metrics.incr("turn.ok")
        rt.metrics.observe_latency(ctx.latency_ms)
        log.info("turn.done %s", trace.to_dict())

        return response_from_values(
            ctx.conversation_id,
            ctx.result,
            reply=ctx.reply,
            handoff=handoff,
            intent=ctx.result.get("stage"),
            engine=ctx.engine,
            latency_ms=ctx.latency_ms,
            tool_calls=ctx.tool_calls,
            turn_id=trace.turn_id,
        )

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
            reply=format_for_whatsapp(decision.reply) if req.channel == "whatsapp" else decision.reply,
            handoff=decision.handoff,
            intent=decision.intent,
            engine=decision.engine,
            latency_ms=trace.elapsed_ms,
            turn_id=trace.turn_id,
        )
        return await self._remember(thread_id, req.messageId, response)
