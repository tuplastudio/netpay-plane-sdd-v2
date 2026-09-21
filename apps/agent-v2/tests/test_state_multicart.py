"""Pruebas del estado multi-carrito (`app/state.py`).

Cubren lo que hace posible manejar varias cotizaciones a la vez: el reducer
de `carts` funde deltas por carrito sin pisar los demás, `open_carts` filtra
registros fantasma, `overall_stage` toma el más avanzado, y
`working_memory_block` cambia de forma según haya uno o varios carritos
abiertos (el caso de un solo pedido debe verse EXACTAMENTE como antes).
"""

from __future__ import annotations

from app.state import (
    SalesState,
    cart_summary,
    open_carts,
    overall_stage,
    working_memory_block,
)
from app.state import _merge_carts  # noqa: SLF001 - se prueba el reducer directo


def test_merge_carts_is_per_cart_and_additive() -> None:
    """Dos deltas de carritos DISTINTOS en el mismo turno no se pisan."""
    left: dict = {}
    right = {
        "playeras": {"cartId": "playeras", "lines": [{"variantId": "v1", "quantity": "2"}]},
        "regalo": {"cartId": "regalo", "lines": [{"variantId": "v2", "quantity": "1"}]},
    }
    merged = _merge_carts(left, right)
    assert set(merged) == {"playeras", "regalo"}
    assert merged["playeras"]["lines"][0]["variantId"] == "v1"
    assert merged["regalo"]["lines"][0]["variantId"] == "v2"


def test_merge_carts_lines_union_within_one_cart_like_before() -> None:
    """Dentro de UN carrito, dos agregados en el mismo turno se unen (no se
    reemplazan) — mismo comportamiento que el carrito único de antes."""
    left = {"1": {"lines": [{"variantId": "v1", "quantity": "2"}]}}
    right = {"1": {"lines": [{"variantId": "v2", "quantity": "3"}]}}
    merged = _merge_carts(left, right)
    variant_ids = {line["variantId"] for line in merged["1"]["lines"]}
    assert variant_ids == {"v1", "v2"}


def test_merge_carts_scalar_field_does_not_erase_other_fields() -> None:
    """Un delta que solo trae `lastTotals` no debe borrar `quoteId` ya guardado."""
    left = {"1": {"quoteId": "q1", "lines": [{"variantId": "v1", "quantity": "2"}]}}
    right = {"1": {"lastTotals": {"totals": {"total": "100"}}}}
    merged = _merge_carts(left, right)
    assert merged["1"]["quoteId"] == "q1"
    assert merged["1"]["lastTotals"]["totals"]["total"] == "100"


def test_merge_carts_quantity_zero_removes_only_that_line_in_that_cart() -> None:
    left = {
        "1": {"lines": [{"variantId": "v1", "quantity": "2"}, {"variantId": "v2", "quantity": "1"}]},
        "2": {"lines": [{"variantId": "v1", "quantity": "5"}]},
    }
    right = {"1": {"lines": [{"variantId": "v1", "quantity": "0"}]}}
    merged = _merge_carts(left, right)
    assert [line["variantId"] for line in merged["1"]["lines"]] == ["v2"]
    assert [line["variantId"] for line in merged["2"]["lines"]] == ["v1"], "el otro carrito no se toca"


def test_merge_carts_untouched_cart_is_preserved() -> None:
    left = {"1": {"lines": [{"variantId": "v1", "quantity": "2"}]}, "2": {"quoteId": "q2"}}
    merged = _merge_carts(left, {"1": {"lastTotals": {"total": "1"}}})
    assert merged["2"] == {"quoteId": "q2"}


def test_open_carts_filters_ghost_records() -> None:
    carts = {
        "1": {"lines": [{"variantId": "v1", "quantity": "1"}]},
        "2": {},  # nunca se usó
        "3": {"lines": []},  # se vació y no se cotizó
        "4": {"quoteId": "q4"},  # sin líneas pero ya cotizado: sigue siendo visible
    }
    visible = open_carts(carts)
    assert set(visible) == {"1", "4"}
    assert open_carts(None) == {}


def test_overall_stage_picks_the_most_advanced_cart() -> None:
    carts = {
        "1": {"lines": [{"variantId": "v1", "quantity": "1"}], "stage": "ARMANDO_CARRITO"},
        "2": {"lines": [{"variantId": "v2", "quantity": "1"}], "stage": "PAGO_ENVIADO"},
    }
    assert overall_stage(carts) == "PAGO_ENVIADO"
    assert overall_stage({}) == "DESCUBRIMIENTO"
    assert overall_stage(None) == "DESCUBRIMIENTO"


def test_working_memory_single_cart_reads_like_before() -> None:
    """Con un solo carrito abierto, el bloque no debe mencionar IDs ni
    "carritos abiertos": debe leerse exactamente como el diseño de un pedido."""
    state = {
        "stage": "COTIZADO",
        "customer": {"name": "Laura"},
        "carts": {
            "1": {
                "lines": [{"variantId": "v1", "sku": "S1", "title": "Lata", "quantity": "2"}],
                "lastTotals": {"totals": {"total": "200", "subtotal": "180"}},
            }
        },
    }
    block = working_memory_block(state)
    assert "Carritos abiertos a la vez" not in block
    assert "[1]" in block
    assert "2 x Lata (S1)" in block
    assert "total $200" in block


def test_working_memory_multiple_carts_lists_each_with_id() -> None:
    state = {
        "stage": "ARMANDO_CARRITO",
        "customer": {},
        "active_cart_id": "regalo",
        "carts": {
            "playeras": {"lines": [{"variantId": "v1", "sku": "S1", "title": "Playera", "quantity": "3"}], "quoteId": "q-1", "quoteLink": "https://q/1"},
            "regalo": {"lines": [{"variantId": "v2", "sku": "S2", "title": "Taza", "quantity": "1"}]},
        },
    }
    block = working_memory_block(state)
    assert "Carritos abiertos a la vez (2)" in block
    assert "[playeras]" in block and "[regalo]" in block
    assert "cotización q-1" in block
    assert "el que se tocó más recientemente" in block
    # el marcador solo va en el carrito activo
    assert block.count("el que se tocó más recientemente") == 1
    playeras_line = next(line for line in block.splitlines() if "[playeras]" in line)
    assert "el que se tocó más recientemente" not in playeras_line


def test_working_memory_no_open_carts() -> None:
    block = working_memory_block({"stage": "DESCUBRIMIENTO", "customer": {}, "carts": {}})
    assert "Carritos abiertos: ninguno todavía." in block


def test_cart_summary_empty_and_filled() -> None:
    assert cart_summary(None) == "vacío"
    assert cart_summary([]) == "vacío"
    assert cart_summary([{"quantity": "2", "title": "Lata", "sku": "S1", "variantId": "v1"}]) == "2 x Lata (S1)"


def test_sales_state_declares_carts_and_active_cart_id() -> None:
    fields = SalesState.__annotations__
    assert "carts" in fields and "active_cart_id" in fields
    assert "cart" not in fields, "el campo singular viejo no debe quedar en el esquema"
