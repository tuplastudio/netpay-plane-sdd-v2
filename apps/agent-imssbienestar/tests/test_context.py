import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.memory.context import (
    SUMMARY_PREFIX,
    build_llm_summarizer,
    clear_history,
    compact_thread,
    cut_index,
    deterministic_summary,
    history_chars,
    is_summary_message,
)
from tests.conftest import FakeAgent, FakeModel

CONFIG = {"configurable": {"thread_id": "t:c"}}


def _conversation(turns: int) -> list:
    messages = []
    for i in range(turns):
        messages.append(HumanMessage(content=f"mensaje {i}", id=f"h{i}"))
        if i % 2 == 0:
            messages.append(AIMessage(content="", id=f"a{i}", tool_calls=[{"name": "buscar_productos", "args": {"consulta": "x"}, "id": f"call{i}"}]))
            messages.append(ToolMessage(content="Resultados: ...", tool_call_id=f"call{i}", id=f"t{i}", name="buscar_productos"))
        messages.append(AIMessage(content=f"respuesta {i}", id=f"r{i}"))
    return messages


def test_history_chars_counts_text_and_multimodal() -> None:
    messages = [HumanMessage(content="hola"), HumanMessage(content=[{"type": "text", "text": "abc"}, {"type": "image_url", "image_url": {"url": "x"}}])]
    assert history_chars(messages) == 7
    assert history_chars(None) == 0


def test_cut_index_lands_on_human_message() -> None:
    messages = _conversation(5)
    cut = cut_index(messages, keep_turns=2)
    assert isinstance(messages[cut], HumanMessage)
    assert messages[cut].content == "mensaje 3"
    assert cut_index(messages, keep_turns=5) == 0
    assert cut_index(messages, keep_turns=10) == 0
    assert cut_index(messages, keep_turns=0) == len(messages)
    assert cut_index([], keep_turns=2) == 0


def test_deterministic_summary_uses_state_not_customer_text() -> None:
    messages = _conversation(3)
    state = {
        "stage": "COTIZADO",
        "carts": {"1": {"lines": [{"quantity": "2", "title": "Lata", "sku": "L1", "variantId": "v1"}], "quoteId": "q1"}},
        "customer": {"name": "Laura"},
    }
    summary = deterministic_summary(messages, state)
    assert "Turnos del cliente resumidos: 3" in summary
    assert "COTIZADO" in summary
    assert "buscar_productos x2" in summary
    assert "ya dio su nombre" in summary
    assert "Laura" not in summary
    assert "mensaje 0" not in summary


@pytest.mark.asyncio
async def test_compact_thread_keeps_tail_and_prepends_summary() -> None:
    agent = FakeAgent()
    messages = _conversation(6)
    agent.seed(
        "t:c",
        messages=messages,
        stage="ARMANDO_CARRITO",
        carts={"1": {"lines": [{"quantity": "1", "title": "Lata", "sku": "L", "variantId": "v"}]}},
    )
    result = await compact_thread(agent, CONFIG, keep_turns=2, reason="test")

    assert result.compacted and result.source == "heuristic"
    new_messages = agent.threads["t:c"]["messages"]
    assert is_summary_message(new_messages[0])
    assert new_messages[0].content.startswith(SUMMARY_PREFIX)
    tail = new_messages[1:]
    assert [m.content for m in tail if isinstance(m, HumanMessage)] == ["mensaje 4", "mensaje 5"]
    assert result.kept == len(tail)
    assert result.removed == len(messages) - len(tail)
    # el par tool_call/ToolMessage del turno 4 sigue completo
    assert any(isinstance(m, ToolMessage) for m in tail)
    # el resto del estado no se toca
    assert agent.threads["t:c"]["stage"] == "ARMANDO_CARRITO"
    assert agent.threads["t:c"]["carts"]["1"]["lines"]


@pytest.mark.asyncio
async def test_compact_thread_noop_when_short() -> None:
    agent = FakeAgent()
    agent.seed("t:c", messages=_conversation(2))
    result = await compact_thread(agent, CONFIG, keep_turns=6)
    assert not result.compacted
    assert len(agent.threads["t:c"]["messages"]) == len(_conversation(2))


@pytest.mark.asyncio
async def test_compact_thread_uses_llm_summary_and_falls_back() -> None:
    agent = FakeAgent()
    agent.seed("t:c", messages=_conversation(6))
    model = FakeModel(replies=["El cliente busca pintura y ya eligió una lata."])
    result = await compact_thread(agent, CONFIG, keep_turns=1, summarizer=build_llm_summarizer(model))
    assert result.source == "llm"
    assert "ya eligió una lata" in agent.threads["t:c"]["messages"][0].content
    # la transcripción que ve el modelo va sin PII
    sent = model.calls[0][1].content
    assert "cliente:" in sent

    agent.seed("t:c", messages=_conversation(6))
    failing = FakeModel(error=RuntimeError("proveedor caído"))
    result = await compact_thread(agent, CONFIG, keep_turns=1, summarizer=build_llm_summarizer(failing))
    assert result.compacted and result.source == "heuristic"


@pytest.mark.asyncio
async def test_llm_summarizer_redacts_pii() -> None:
    model = FakeModel(replies=["ok"])
    summarizer = build_llm_summarizer(model)
    await summarizer([HumanMessage(content="soy Laura, mi cel 6671234567 y laura@x.mx")], {})
    sent = model.calls[0][1].content
    assert "6671234567" not in sent and "laura@x.mx" not in sent


@pytest.mark.asyncio
async def test_compact_twice_folds_previous_summary() -> None:
    agent = FakeAgent()
    agent.seed("t:c", messages=_conversation(6))
    await compact_thread(agent, CONFIG, keep_turns=3)
    agent.threads["t:c"]["messages"].extend(_conversation(3))
    await compact_thread(agent, CONFIG, keep_turns=1)
    summaries = [m for m in agent.threads["t:c"]["messages"] if is_summary_message(m)]
    assert len(summaries) == 1
    assert "Resumen anterior:" in summaries[0].content


@pytest.mark.asyncio
async def test_clear_history_keeps_facts() -> None:
    agent = FakeAgent()
    agent.seed(
        "t:c", messages=_conversation(2), carts={"1": {"lines": [{"variantId": "v", "quantity": "1"}]}}, customer={"name": "L"}
    )
    removed = await clear_history(agent, CONFIG)
    assert removed == len(_conversation(2))
    assert agent.threads["t:c"]["messages"] == []
    assert agent.threads["t:c"]["carts"]["1"]["lines"] and agent.threads["t:c"]["customer"] == {"name": "L"}
    assert await clear_history(agent, CONFIG) == 0
