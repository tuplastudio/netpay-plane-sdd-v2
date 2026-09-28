"""Ráfagas de mensajes (`app/pipeline/coalesce.py`)."""

from __future__ import annotations

import asyncio

from app.pipeline.coalesce import MessageCoalescer


async def test_window_zero_is_passthrough() -> None:
    coalescer: MessageCoalescer[str] = MessageCoalescer(0)
    assert not coalescer.enabled
    assert await coalescer.collect("t", "hola") == ["hola"]


async def test_burst_is_answered_once_by_the_last_message() -> None:
    coalescer: MessageCoalescer[str] = MessageCoalescer(120)

    async def send(text: str, delay: float) -> list[str] | None:
        await asyncio.sleep(delay)
        return await coalescer.collect("t1", text)

    results = await asyncio.gather(send("hola", 0.0), send("quiero 2 playeras", 0.04), send("rojas", 0.08))
    assert results[0] is None and results[1] is None, "los primeros ceden"
    assert results[2] == ["hola", "quiero 2 playeras", "rojas"], "el último contesta por todos, en orden"
    assert coalescer.pending("t1") == 0


async def test_threads_do_not_mix() -> None:
    coalescer: MessageCoalescer[str] = MessageCoalescer(60)
    a, b = await asyncio.gather(coalescer.collect("a", "uno"), coalescer.collect("b", "dos"))
    assert a == ["uno"] and b == ["dos"]


async def test_messages_outside_the_window_are_separate_turns() -> None:
    coalescer: MessageCoalescer[str] = MessageCoalescer(30)
    first = await coalescer.collect("t", "primero")
    second = await coalescer.collect("t", "segundo")
    assert first == ["primero"] and second == ["segundo"]
