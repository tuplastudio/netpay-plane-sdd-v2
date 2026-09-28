"""Extracción de respuesta, respaldo determinista y sugerencias
(`app/pipeline/replies.py`)."""

from __future__ import annotations

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.pipeline.replies import fallback_reply, final_reply, last_assistant_reply, message_text, suggestions


def test_message_text_accepts_str_and_content_blocks() -> None:
    assert message_text(AIMessage(content="  hola  ")) == "hola"
    blocks = AIMessage(content=[{"type": "text", "text": "Te sale en $150."}, {"type": "tool_use", "id": "x"}, "¿Te lo cotizo?"])
    assert message_text(blocks) == "Te sale en $150.\n¿Te lo cotizo?"
    assert message_text(AIMessage(content=[])) == ""
    assert message_text(object()) == ""


def test_final_reply_only_looks_at_this_turn() -> None:
    history = [
        HumanMessage(content="cuánto cuesta"),
        AIMessage(content="Te sale en $150"),
        HumanMessage(content="agrégame 2"),
        AIMessage(content="", tool_calls=[{"name": "agregar_al_carrito", "args": {}, "id": "c1"}]),
        ToolMessage(content="Agregado", tool_call_id="c1", name="agregar_al_carrito"),
    ]
    text, message = final_reply(history)
    assert text == "" and message is None, "la respuesta del turno anterior no se reutiliza"
    history.append(AIMessage(content="Listo, van 2."))
    text, message = final_reply(history)
    assert text == "Listo, van 2." and message is history[-1]
    assert last_assistant_reply(history[:3]) == "Te sale en $150"


def test_fallback_reply_prefers_what_the_customer_is_waiting_for() -> None:
    assert "persona del equipo" in fallback_reply({"handoff": True})
    paid = {"carts": {"1": {"lines": [{"variantId": "v", "quantity": "1", "sku": "S", "title": "T"}], "checkoutLink": "https://pagos.example/x"}}}
    assert fallback_reply(paid).endswith("https://pagos.example/x")
    quoted = {"carts": {"1": {"lines": [{"variantId": "v", "quantity": "1", "sku": "S", "title": "T"}], "quoteId": "Q1", "quoteLink": "https://q.example/Q1"}}}
    assert "cotización" in fallback_reply(quoted) and "https://q.example/Q1" in fallback_reply(quoted)
    cart = {"carts": {"1": {"lines": [{"variantId": "v", "quantity": "1", "sku": "S", "title": "T"}]}}}
    assert "total" in fallback_reply(cart)
    assert "repites" in fallback_reply({})


def test_suggestions_follow_the_stage() -> None:
    assert suggestions({"handoff": True}) == []
    assert suggestions({}) == ["¿Qué venden?", "Quiero cotizar", "¿Hacen envíos?"]
    line = {"variantId": "v", "quantity": "1", "sku": "S", "title": "T"}
    assert "Emitir cotización" in suggestions({"carts": {"1": {"lines": [line]}}})
    assert "Sí, quiero pagar" in suggestions({"carts": {"1": {"lines": [line], "quoteId": "Q"}}})
    assert "Quiero factura" in suggestions({"carts": {"1": {"lines": [line], "checkoutLink": "https://p"}}})
