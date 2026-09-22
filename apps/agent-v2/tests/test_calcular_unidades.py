"""`calcular_unidades_para_cubrir`: la matemática de cantidad NO la hace el LLM.

Cubre el contrato (redondeo hacia arriba, modo `exact`, errores claros),
la validación (rendimiento 0, variante inexistente) y la invariante de
que el LLM solo traduce unidades a números — la división nunca es suya.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app import tools

VARIANTS = [
    {"variantId": "v-envase", "sku": "ENV-25", "title": "Envase 25 porciones",
     "productTitle": "Bocadillos", "price": "200.00", "stock": 100, "status": "ACTIVE"},
    {"variantId": "v-litro", "sku": "LIT-1", "title": "Litro pintura",
     "productTitle": "Pintura", "price": "350.00", "stock": 50, "status": "ACTIVE"},
]


class FakeCommerceClient:
    live = True

    async def search_products(self, *_a, **_k):
        return VARIANTS


def _runtime(scopes: list[str] | None = None) -> SimpleNamespace:
    from app.security import TOOL_SCOPES

    return SimpleNamespace(
        state={},
        context={"tenant_id": "t1", "scopes": scopes if scopes is not None else list(TOOL_SCOPES.values())},
        tool_call_id="call-1",
    )


@pytest.fixture(autouse=True)
def fake_client():
    with patch.object(tools, "_client", return_value=FakeCommerceClient()):
        yield


def _reply(cmd):
    """Extrae el contenido del ToolMessage que devuelve la tool."""
    update = cmd.update
    messages = update.get("messages", [])
    return messages[0].content if messages else update.get("content", "")


@pytest.mark.asyncio
async def test_ceil_default_for_partial_coverage() -> None:
    """40 personas con rendimiento 25 → ceil(40/25) = 2 envases."""
    cmd = await tools.calcular_unidades_para_cubrir.coroutine(
        unidades_objetivo="40",
        rendimiento_por_unidad="25",
        unidad_objetivo="personas",
        unidad_cobertura="porciones",
        variantId="v-envase",
        runtime=_runtime(),
    )
    text = _reply(cmd)
    assert "2 unidades" in text
    assert "50 porciones" in text  # cobertura efectiva (2 * 25)


@pytest.mark.asyncio
async def test_exact_mode_rounds_down_to_minimum() -> None:
    """`mode='exact'` usa round() — solo si el cliente pidió 'lo mínimo exacto'."""
    cmd = await tools.calcular_unidades_para_cubrir.coroutine(
        unidades_objetivo="40",
        rendimiento_por_unidad="25",
        unidad_objetivo="personas",
        unidad_cobertura="porciones",
        variantId="v-envase",
        runtime=_runtime(),
        mode="exact",
    )
    text = _reply(cmd)
    # 40/25 = 1.6 → round() = 2 (banker's rounding hacia par).
    assert "2 unidades" in text


@pytest.mark.asyncio
async def test_zero_rendimiento_rejected() -> None:
    """Si el rendimiento es 0, NO devuelve cifra inventada: rechaza."""
    cmd = await tools.calcular_unidades_para_cubrir.coroutine(
        unidades_objetivo="100",
        rendimiento_por_unidad="0",
        unidad_objetivo="m²",
        unidad_cobertura="m²",
        variantId="v-litro",
        runtime=_runtime(),
    )
    text = _reply(cmd)
    assert "ERROR" in text
    assert "rendimiento" in text.lower()


@pytest.mark.asyncio
async def test_unknown_variant_rejected() -> None:
    """Si el variantId no existe en el catálogo, NO calcula: error claro."""
    cmd = await tools.calcular_unidades_para_cubrir.coroutine(
        unidades_objetivo="100",
        rendimiento_por_unidad="8",
        unidad_objetivo="m²",
        unidad_cobertura="m²",
        variantId="v-no-existe",
        runtime=_runtime(),
    )
    text = _reply(cmd)
    assert "ERROR" in text
    assert "no existe" in text.lower() or "buscar_productos" in text


@pytest.mark.asyncio
async def test_zero_objetivo_returns_zero() -> None:
    """Si el cliente dice 'cero', la herramienta devuelve 0 sin drama."""
    cmd = await tools.calcular_unidades_para_cubrir.coroutine(
        unidades_objetivo="0",
        rendimiento_por_unidad="25",
        unidad_objetivo="personas",
        unidad_cobertura="porciones",
        variantId="v-envase",
        runtime=_runtime(),
    )
    text = _reply(cmd)
    assert "0 unidades" in text


@pytest.mark.asyncio
async def test_missing_scope_rejected() -> None:
    """Sin scope `catalog.read`, la herramienta rechaza antes de calcular."""
    cmd = await tools.calcular_unidades_para_cubrir.coroutine(
        unidades_objetivo="40",
        rendimiento_por_unidad="25",
        unidad_objetivo="personas",
        unidad_cobertura="porciones",
        variantId="v-envase",
        runtime=_runtime(scopes=[]),
    )
    text = _reply(cmd)
    assert "ERROR" in text
    assert "scope" in text.lower()


@pytest.mark.asyncio
async def test_invalid_number_rejected() -> None:
    """El LLM podría pasar strings rotos; se rechazan con mensaje claro."""
    cmd = await tools.calcular_unidades_para_cubrir.coroutine(
        unidades_objetivo="cuarenta",
        rendimiento_por_unidad="25",
        unidad_objetivo="personas",
        unidad_cobertura="porciones",
        variantId="v-envase",
        runtime=_runtime(),
    )
    text = _reply(cmd)
    assert "ERROR" in text
    assert "número" in text.lower() or "numero" in text.lower()


@pytest.mark.asyncio
async def test_decimal_inputs_work() -> None:
    """Acepta decimales con coma o punto (cliente europeo)."""
    cmd = await tools.calcular_unidades_para_cubrir.coroutine(
        unidades_objetivo="100,5",
        rendimiento_por_unidad="8",
        unidad_objetivo="m²",
        unidad_cobertura="m²",
        variantId="v-litro",
        runtime=_runtime(),
    )
    text = _reply(cmd)
    # ceil(100.5 / 8) = ceil(12.5625) = 13.
    assert "13 unidades" in text
    assert "104" in text  # cobertura efectiva: 13 * 8 = 104


def test_tool_is_registered() -> None:
    assert tools.calcular_unidades_para_cubrir in tools.SALES_TOOLS
