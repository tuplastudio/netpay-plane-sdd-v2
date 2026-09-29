"""Estado de proceso del agente: checkpointer, grafo, locks, idempotencia,
métricas y el pipeline del turno.

Vive aparte de `main.py` para que los routers de `api/` y el pipeline no
importen la aplicación FastAPI (ciclo) y para que las pruebas puedan
sustituir piezas (`runtime.agent = FakeAgent()`) sin levantar un modelo.

Garantías de robustez
---------------------

* `ThreadLocks` indexa por `thread_id` (no un lock global) y la purga
  oportunista usa un *generation counter* para no borrar un lock que
  otro task está a punto de adquirir.
* `background()` reemplaza `asyncio.ensure_future` (deprecado): registra
  la tarea en `self._background_tasks` y `stop()` la espera con un
  timeout corto antes de cerrar el checkpointer, así una coroutine de
  aprendizaje/episodio colgada no impide el apagado limpio.
* `agent` puede ser `None` si el arranque aún no terminó: las rutas lo
  consultan vía `runtime.ready` (503) y `Runtime.stop()` lo baja a
  `None` antes de cerrar la conexión del checkpointer.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import Awaitable
from typing import Any

import aiosqlite
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from .agent import build_agent, build_model, build_scope_model
from .config import Settings, get_settings
from .guards import OutputGuard
from .pipeline.coalesce import MessageCoalescer
from .pipeline.trace import Metrics

log = logging.getLogger("agent-v2.runtime")

# Cuánto se espera, al apagar, a las tareas en background. Es corto a
# propósito: lo que esté colgado se cancela; lo que esté a punto de
# terminar aterriza. Si se queda corta, las coroutines canceladas
# registran su propio warning.
_BACKGROUND_DRAIN_SECONDS = 5.0


class ThreadLocks:
    """Un lock por `thread_id`, no uno global.

    Dos mensajes casi simultáneos del mismo cliente (doble tap, reintento de
    Evolution API que se cruza con el mensaje real) invocan el grafo sobre el
    mismo hilo: sin serializar por hilo se puede leer el carrito antes de que
    el otro turno lo actualice. Un lock global serializaría a TODOS los
    clientes del servicio, así que se indexa por thread_id.

    La purga oportunista se hace bajo un *generation counter*: solo se barre
    cuando el contador avanza y la generación de cada lock es la del barrido
    en curso. Un task que pidió un lock durante el barrido conserva su lock
    (la generación siguiente no lo ve).
    """

    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = {}
        self._generation: dict[str, int] = {}
        self._current_generation = 0
        self._guard = asyncio.Lock()

    async def acquire(self, thread_id: str) -> asyncio.Lock:
        async with self._guard:
            lock = self._locks.get(thread_id)
            if lock is None:
                lock = asyncio.Lock()
                self._locks[thread_id] = lock
                self._generation[thread_id] = self._current_generation
            else:
                # Refresca la generación: este lock acaba de ser "usado".
                self._generation[thread_id] = self._current_generation
            # Purga oportunista: nada obliga a que un thread_id viejo se
            # vuelva a usar, y sin esto el dict crece sin límite. Solo
            # borramos locks cuya generación sea estrictamente anterior a
            # la actual: nunca el que acabamos de tocar.
            if len(self._locks) > 5000:
                self._current_generation += 1
                stale = [
                    key
                    for key, gen in list(self._generation.items())
                    if gen < self._current_generation - 1 and not self._locks[key].locked()
                ]
                for key in stale:
                    self._locks.pop(key, None)
                    self._generation.pop(key, None)
            return lock

    def pending(self, thread_id: str) -> int:
        """Cuántos locks están tomados para este hilo (0 = libre)."""
        lock = self._locks.get(thread_id)
        return 1 if lock is not None and lock.locked() else 0


class TurnLimiter:
    """Tope de turnos simultáneos: global y por tenant.

    Sin esto, un tenant con una ráfaga de cientos de mensajes (campaña,
    integrador en bucle, ataque) acapara el event loop, la cuota del
    proveedor y la conexión del checkpointer para TODOS los negocios. Dos
    semáforos: uno del proceso y uno por tenant (creados bajo demanda y
    purgados cuando quedan libres). `0` en cualquiera de los dos topes lo
    desactiva.

    `acquire()` espera como máximo `queue_timeout`; si no consigue lugar
    lanza `TurnOverloaded` y el pipeline contesta una respuesta suave
    (`engine="overloaded"`) en vez de encolar sin límite o de un 5xx que el
    puente descarta en silencio.
    """

    def __init__(self, max_total: int, max_per_tenant: int, queue_timeout: float) -> None:
        self.max_total = max(0, int(max_total))
        self.max_per_tenant = max(0, int(max_per_tenant))
        self.queue_timeout = max(0.0, float(queue_timeout))
        self._total = asyncio.Semaphore(self.max_total) if self.max_total else None
        self._tenants: dict[str, asyncio.Semaphore] = {}
        self._in_flight: dict[str, int] = {}

    @property
    def enabled(self) -> bool:
        return bool(self._total or self.max_per_tenant)

    def in_flight(self, tenant_id: str | None = None) -> int:
        if tenant_id is None:
            return sum(self._in_flight.values())
        return self._in_flight.get(tenant_id, 0)

    def _tenant_sem(self, tenant_id: str) -> asyncio.Semaphore | None:
        if not self.max_per_tenant:
            return None
        sem = self._tenants.get(tenant_id)
        if sem is None:
            sem = asyncio.Semaphore(self.max_per_tenant)
            self._tenants[tenant_id] = sem
        return sem

    @contextlib.asynccontextmanager
    async def acquire(self, tenant_id: str):
        """`async with limiter.acquire(tenant):` — lanza `TurnOverloaded` si
        no hay lugar en `queue_timeout` segundos."""
        tenant_sem = self._tenant_sem(tenant_id)
        held: list[asyncio.Semaphore] = []
        try:
            for sem in (tenant_sem, self._total):
                if sem is None:
                    continue
                try:
                    await asyncio.wait_for(sem.acquire(), timeout=self.queue_timeout)
                except asyncio.TimeoutError as exc:
                    scope = "tenant" if sem is tenant_sem else "proceso"
                    raise TurnOverloaded(scope) from exc
                held.append(sem)
            self._in_flight[tenant_id] = self._in_flight.get(tenant_id, 0) + 1
            yield
        finally:
            if held:
                count = self._in_flight.get(tenant_id, 1) - 1
                if count <= 0:
                    self._in_flight.pop(tenant_id, None)
                    # Tenant sin turnos en vuelo: se suelta su semáforo para
                    # que el dict no crezca con cada tenant que escribió una vez.
                    self._tenants.pop(tenant_id, None)
                else:
                    self._in_flight[tenant_id] = count
            for sem in held:
                sem.release()


class TurnOverloaded(Exception):
    """No hubo lugar para el turno dentro de `queue_timeout` (ver TurnLimiter)."""

    def __init__(self, scope: str) -> None:
        super().__init__(f"sin capacidad ({scope})")
        self.scope = scope


class IdempotencyStore:
    """Persiste `messageId -> respuesta ya calculada` por hilo.

    Evolution API reintenta webhooks de WhatsApp: el mismo mensaje puede
    llegar dos veces con el mismo `messageId`. Sin esto el agente vuelve a
    cotizar o a generar un link de pago nuevo en el reintento. Vive en su
    propio archivo sqlite (no en el de `AsyncSqliteSaver`) para no competir
    por la única conexión que el checkpointer mantiene abierta.
    """

    def __init__(self, path: Any) -> None:
        self._path = path
        self._conn: aiosqlite.Connection | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        self._conn = await aiosqlite.connect(str(self._path))
        await self._conn.execute(
            "CREATE TABLE IF NOT EXISTS processed_messages ("
            "thread_id TEXT NOT NULL, message_id TEXT NOT NULL, "
            "response TEXT NOT NULL, created_at REAL NOT NULL, "
            "PRIMARY KEY (thread_id, message_id))"
        )
        await self._conn.commit()

    async def stop(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def get(self, thread_id: str, message_id: str | None) -> dict[str, Any] | None:
        if not message_id or self._conn is None:
            return None
        async with self._lock:
            cursor = await self._conn.execute(
                "SELECT response FROM processed_messages WHERE thread_id = ? AND message_id = ?",
                (thread_id, message_id),
            )
            row = await cursor.fetchone()
        return json.loads(row[0]) if row else None

    async def put(self, thread_id: str, message_id: str | None, response: dict[str, Any]) -> None:
        if not message_id or self._conn is None:
            return
        async with self._lock:
            await self._conn.execute(
                "INSERT OR REPLACE INTO processed_messages "
                "(thread_id, message_id, response, created_at) VALUES (?, ?, ?, ?)",
                (thread_id, message_id, json.dumps(response), time.time()),
            )
            # Límite explícito por hilo: no hace falta recordar más que los
            # últimos reintentos razonables de un mismo mensaje.
            await self._conn.execute(
                "DELETE FROM processed_messages WHERE thread_id = ? AND message_id NOT IN ("
                "SELECT message_id FROM processed_messages WHERE thread_id = ? "
                "ORDER BY created_at DESC LIMIT 50)",
                (thread_id, thread_id),
            )
            await self._conn.commit()

    async def delete_thread(self, thread_id: str) -> None:
        if self._conn is None:
            return
        async with self._lock:
            await self._conn.execute("DELETE FROM processed_messages WHERE thread_id = ?", (thread_id,))
            await self._conn.commit()


class Runtime:
    """Checkpointer y grafo viven todo el proceso: abrir la BD por turno
    perdería el hilo y costaría una conexión cada mensaje."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._stack: contextlib.AsyncExitStack | None = None
        self.agent: Any = None
        self.checkpointer: AsyncSqliteSaver | None = None
        self.thread_locks = ThreadLocks()
        self.scope_model: Any = None
        self.idempotency = IdempotencyStore(self.settings.data_dir / "idempotency.sqlite")
        self.output_guard = OutputGuard(self.settings)
        self.coalescer: MessageCoalescer[str] = MessageCoalescer(self.settings.coalesce_window_ms)
        self.metrics = Metrics(self.settings.metrics_latency_samples)
        self.limiter = TurnLimiter(
            self.settings.max_concurrent_turns,
            self.settings.max_concurrent_turns_per_tenant,
            self.settings.queue_timeout_seconds,
        )
        # Modelo para resúmenes de compactación y extracción episódica: tareas
        # internas, así que usan el modelo fijo del proceso, no el del tenant.
        self.utility_model: Any = None
        self.pipeline: Any = None
        # Tareas en background que se esperan en stop() (ver background()).
        self._background_tasks: set[asyncio.Task[Any]] = set()

    @property
    def ready(self) -> bool:
        return self.agent is not None

    @property
    def background_count(self) -> int:
        """Tareas en background todavía sin terminar (diagnóstico)."""
        return sum(1 for t in self._background_tasks if not t.done())

    async def start(self) -> None:
        # Import tardío: el pipeline importa guards/memory/tenant_context, y
        # este módulo se importa desde `api/*` al arrancar.
        from .pipeline.turn import TurnPipeline

        settings = self.settings
        self._stack = contextlib.AsyncExitStack()
        self.checkpointer = await self._stack.enter_async_context(
            AsyncSqliteSaver.from_conn_string(str(settings.checkpoint_path))
        )
        self.agent = build_agent(self.checkpointer, settings)
        self.scope_model = build_scope_model(settings)
        self.utility_model = (
            build_model(
                settings,
                model=settings.episodic_model or settings.summary_model or settings.model,
                temperature=0.2,
                max_tokens=600,
            )
            if settings.llm_live
            else None
        )
        self.pipeline = TurnPipeline(self, settings)
        await self.idempotency.start()

    def background(self, coro: Awaitable[Any]) -> asyncio.Task[Any]:
        """Lanza `coro` como tarea y lo registra para que `stop()` la espere.

        Reemplaza `asyncio.ensure_future` (deprecado en Python 3.10+). Las
        tareas se eliminan solas al terminar; las canceladas o colgadas se
        drenan con timeout en `stop()` para no bloquear el apagado.
        """
        task = asyncio.create_task(coro)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)
        return task

    async def _drain_background(self) -> None:
        """Espera (con timeout) a las tareas en background pendientes."""
        if not self._background_tasks:
            return
        pending = [t for t in self._background_tasks if not t.done()]
        if not pending:
            return
        log.info("drenando %d tarea(s) en background antes de apagar", len(pending))
        _done, still_pending = await asyncio.wait(
            pending, timeout=_BACKGROUND_DRAIN_SECONDS, return_when=asyncio.ALL_COMPLETED
        )
        for task in still_pending:
            task.cancel()
        if still_pending:
            # Segundo wait para que las cancelaciones propaguen su CancelledError.
            await asyncio.gather(*still_pending, return_exceptions=True)

    def cancel_background(self) -> None:
        """Cancela sin esperar: para rutas de shutdown duro (SIGKILL-style)."""
        for task in list(self._background_tasks):
            if not task.done():
                task.cancel()

    async def stop(self) -> None:
        """Apagado limpio: drena background → cierra BD → baja referencias."""
        try:
            await self._drain_background()
        except Exception:
            log.warning("fallo drenando tareas en background", exc_info=True)
        await self.idempotency.stop()
        if self._stack is not None:
            await self._stack.aclose()
            self._stack = None
        self.agent = None
        self.checkpointer = None
        self.pipeline = None


runtime = Runtime()
