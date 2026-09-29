"""Zonas de envío por polígono (T-SHIP-07): la ubicación compartida por
WhatsApp llega al bot como texto con lat/lng y las tools la mandan a
commerce-api.

Cubren, sin red (el `CommerceClient` se sustituye por un fake):
- `_parse_point`: coordenadas como strings del modelo (vacías, coma decimal,
  fuera de rango).
- `validar_zona_de_envio` con solo lat/lng; texto según `matchedBy`.
- `recordar_direccion_entrega` acepta ubicación sin CP y la guarda.
- `calcular_total` manda la ubicación guardada al preview (y no manda
  lat/lng cuando no hay ubicación, para no romper clientes viejos).
- El prompt v1.6.0 explica el flujo de ubicación.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from app import tools
from app.prompts.registry import get_prompt_registry
from app.security import TOOL_SCOPES


def _runtime(state: dict | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        state=state or {},
        context={"tenant_id": "t1", "scopes": list(TOOL_SCOPES.values())},
        tool_call_id="call-1",
    )


def _text(cmd) -> str:
    return cmd.update["messages"][0].content


class TestParsePoint:
    def test_accepts_strings_and_comma_decimal(self) -> None:
        assert tools._parse_point("19.4326", "-99.1332") == (19.4326, -99.1332)
        assert tools._parse_point("19,43", "-99,13") == (19.43, -99.13)
        assert tools._parse_point(19.43, -99.13) == (19.43, -99.13)

    def test_empty_or_partial_is_none(self) -> None:
        assert tools._parse_point("", "") is None
        assert tools._parse_point("19.43", "") is None
        assert tools._parse_point(None, None) is None

    def test_out_of_range_or_garbage_is_none(self) -> None:
        assert tools._parse_point("95", "-99.13") is None
        assert tools._parse_point("19.43", "-200") is None
        assert tools._parse_point("norte", "-99.13") is None
        assert tools._parse_point("nan", "-99.13") is None


class FakeLookupClient:
    live = True

    def __init__(self, response: dict) -> None:
        self.response = response
        self.seen: dict = {}

    async def lookup_delivery_zone(self, **kwargs):
        self.seen = kwargs
        return self.response


async def test_validar_zona_sends_point_and_reports_polygon_match() -> None:
    client = FakeLookupClient(
        {"price": "35.00", "zoneId": "z", "zoneName": "Centro", "fallback": False, "matchedBy": "polygon"}
    )
    with patch.object(tools, "_client", return_value=client):
        cmd = await tools.validar_zona_de_envio.coroutine(lat="19.4326", lng="-99.1332", runtime=_runtime())
    assert client.seen["lat"] == 19.4326
    assert client.seen["lng"] == -99.1332
    assert client.seen["postal_code"] is None
    text = _text(cmd)
    assert "Centro" in text and "35.00" in text
    assert "ubicación" in text


async def test_validar_zona_without_point_does_not_send_lat_lng() -> None:
    """Clientes/backends viejos: sin ubicación no aparecen las llaves lat/lng."""
    client = FakeLookupClient(
        {"price": "40.00", "zoneId": "z", "zoneName": "CP", "fallback": False, "matchedBy": "postalCode"}
    )
    with patch.object(tools, "_client", return_value=client):
        cmd = await tools.validar_zona_de_envio.coroutine(postalCode="06000", runtime=_runtime())
    assert "lat" not in client.seen and "lng" not in client.seen
    assert "código postal" in _text(cmd)


async def test_validar_zona_point_outside_polygons_asks_for_cp() -> None:
    client = FakeLookupClient({"price": "99.00", "zoneId": None, "zoneName": None, "fallback": True, "matchedBy": "fallback"})
    with patch.object(tools, "_client", return_value=client):
        cmd = await tools.validar_zona_de_envio.coroutine(lat="25.0", lng="-100.0", runtime=_runtime())
    text = _text(cmd)
    assert "estándar" in text
    assert "CP" in text


async def test_validar_zona_requires_some_criterion() -> None:
    cmd = await tools.validar_zona_de_envio.coroutine(lat="19.43", runtime=_runtime())  # falta lng
    assert "Necesito" in _text(cmd)


async def test_recordar_accepts_location_without_cp() -> None:
    cmd = await tools.recordar_direccion_entrega.coroutine(
        lat="19.4326", lng="-99.1332", line1="Av. Juárez 10", runtime=_runtime()
    )
    addr = cmd.update["delivery_address"]
    assert addr["lat"] == 19.4326 and addr["lng"] == -99.1332
    assert "postalCode" not in addr
    assert addr["line1"] == "Av. Juárez 10"
    assert "ubicación" in _text(cmd)


async def test_recordar_still_requires_cp_without_location() -> None:
    cmd = await tools.recordar_direccion_entrega.coroutine(city="CDMX", runtime=_runtime())
    assert "delivery_address" not in cmd.update
    cmd = await tools.recordar_direccion_entrega.coroutine(postalCode="12", runtime=_runtime())
    assert "delivery_address" not in cmd.update


async def test_recordar_keeps_cp_and_location_together() -> None:
    cmd = await tools.recordar_direccion_entrega.coroutine(
        postalCode="06000", lat="19.43", lng="-99.13", runtime=_runtime()
    )
    addr = cmd.update["delivery_address"]
    assert addr["postalCode"] == "06000" and addr["lat"] == 19.43


def _cart_state(address: dict) -> dict:
    return {
        "delivery_address": address,
        "carts": {"1": {"cartId": "1", "lines": [{"variantId": "v", "sku": "S", "title": "T", "quantity": "1.000"}]}},
        "active_cart_id": "1",
    }


class FakePreviewClient:
    live = True

    def __init__(self) -> None:
        self.seen: dict = {}

    async def price_preview(self, lines, *, delivery_mode=None, postal_code=None, city=None, state=None, **extra):
        self.seen = {"postal_code": postal_code, **extra}
        return {
            "totals": {"subtotal": "100.00", "discount": "0.00", "taxBase": "100.00", "tax": "16.00", "shipping": "35.00", "total": "151.00"},
            "shippingZone": {"id": "z", "name": "Centro", "fallback": False, "matchedBy": "polygon"},
        }


async def test_calcular_total_sends_saved_location() -> None:
    client = FakePreviewClient()
    rt = _runtime(_cart_state({"lat": 19.43, "lng": -99.13}))
    with patch.object(tools, "_client", return_value=client):
        cmd = await tools.calcular_total.coroutine(deliveryMode="LOCAL_DELIVERY", runtime=rt)
    assert client.seen["lat"] == 19.43 and client.seen["lng"] == -99.13
    assert "Centro" in _text(cmd)


async def test_calcular_total_explicit_point_wins_and_omits_when_absent() -> None:
    client = FakePreviewClient()
    rt = _runtime(_cart_state({"lat": 19.43, "lng": -99.13}))
    with patch.object(tools, "_client", return_value=client):
        await tools.calcular_total.coroutine(deliveryMode="LOCAL_DELIVERY", lat="20.6", lng="-103.3", runtime=rt)
    assert client.seen["lat"] == 20.6

    client = FakePreviewClient()
    rt = _runtime(_cart_state({"postalCode": "06000"}))
    with patch.object(tools, "_client", return_value=client):
        await tools.calcular_total.coroutine(deliveryMode="LOCAL_DELIVERY", runtime=rt)
    assert "lat" not in client.seen, "sin ubicación no se mandan lat/lng"


class TestPromptV160:
    def test_block_explains_location_flow(self) -> None:
        block = get_prompt_registry().get("1.6.0").block("55_envio_domicilio")
        assert block is not None
        assert "compartió su ubicación" in block.text
        assert "lat" in block.text and "lng" in block.text
        assert "validar_zona_de_envio" in block.text
        # Ya no manda a ignorar la ubicación.
        assert "NO la guardes como dirección" not in block.text

    def test_older_version_untouched(self) -> None:
        """Una versión congelada no cambia: 1.5.0 conserva la regla anterior."""
        block = get_prompt_registry().get("1.5.0").block("55_envio_domicilio")
        assert block is not None
        assert "NO la guardes como dirección" in block.text
