"""Cliente HTTP hacia la API comercial (NestJS).

Es el único camino del agente hacia datos y efectos comerciales. El tenant y
el principal NO vienen del modelo: se derivan de la API key de servicio
(SPEC-AIA "Herramientas y autoridad", T-FND-05).

Sin `AGENT_API_KEY_REF` el cliente entra en modo offline y devuelve
`CommerceUnavailable`, para que el agente degrade a conversación y handoff
en lugar de inventar datos.
"""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from .config import Settings, get_settings
from .matching import CatalogVariant


class CommerceUnavailable(RuntimeError):
    """La API comercial no está configurada o no respondió."""


class CommerceError(RuntimeError):
    """La API respondió con error de negocio."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.status = status
        self.code = code
        self.message = message


class CommerceClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    @property
    def live(self) -> bool:
        return self.settings.commerce_live

    # ---------- transporte ----------

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        raw: bool = False,
    ) -> Any:
        if not self.live:
            raise CommerceUnavailable("AGENT_API_KEY_REF no configurada")

        headers = {
            "authorization": f"Bearer {self.settings.commerce_api_key}",
            "content-type": "application/json",
            "x-request-id": str(uuid.uuid4()),
        }
        if idempotency_key:
            headers["idempotency-key"] = idempotency_key

        url = f"{self.settings.commerce_api_url.rstrip('/')}{path}"
        try:
            async with httpx.AsyncClient(timeout=self.settings.commerce_timeout) as client:
                response = await client.request(
                    method, url, params=params, json=json_body, headers=headers
                )
        except httpx.HTTPError as exc:
            raise CommerceUnavailable(f"API comercial inalcanzable: {exc}") from exc

        if response.status_code >= 400:
            try:
                payload = response.json()
            except ValueError:
                payload = {}
            detail = payload.get("error") or payload.get("detail") or payload
            code = detail.get("code", "HTTP_ERROR") if isinstance(detail, dict) else "HTTP_ERROR"
            message = (
                detail.get("message", response.text)
                if isinstance(detail, dict)
                else str(detail)[:300]
            )
            raise CommerceError(response.status_code, code, message)

        if not response.content:
            return None
        body = response.json()
        if raw:
            return body
        return body.get("data", body) if isinstance(body, dict) else body

    # ---------- catálogo ----------

    # Techo real del backend (`catalog.service.ts: listProducts`); pedir más
    # que esto solo lo recorta de vuelta, así que no tiene caso mandarlo.
    _CATALOG_PAGE_LIMIT = 100
    # Techo de páginas para el volcado completo: evita un loop sin fin si el
    # backend un día deja de mandar `nextCursor: null`.
    _CATALOG_MAX_PAGES = 50

    async def search_products(self, query: str | None = None, *, limit: int = 20) -> list[CatalogVariant]:
        data = await self._request(
            "GET",
            "/catalog/products",
            params={"q": query or "", "limit": min(limit, self._CATALOG_PAGE_LIMIT)},
        )
        return self._flatten_variants(data)

    async def full_catalog(self) -> list[CatalogVariant]:
        """Catálogo completo del tenant, paginado.

        `search_products(None, limit=N)` solo trae la primera página: con
        tenants de más de `_CATALOG_PAGE_LIMIT` SKUs el agente dejaba de ver
        (y de poder cotizar) todo lo que quedara después del corte. Aquí se
        recorre `pageInfo.nextCursor` hasta agotarlo.
        """
        variants: list[CatalogVariant] = []
        cursor: str | None = None
        for _ in range(self._CATALOG_MAX_PAGES):
            body = await self._request(
                "GET",
                "/catalog/products",
                params={
                    "limit": self._CATALOG_PAGE_LIMIT,
                    **({"cursor": cursor} if cursor else {}),
                },
                raw=True,
            )
            if not isinstance(body, dict):
                break
            variants.extend(self._flatten_variants(body.get("data")))
            cursor = (body.get("pageInfo") or {}).get("nextCursor")
            if not cursor:
                break
        return variants

    async def get_product(self, product_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/catalog/products/{product_id}")

    @staticmethod
    def _flatten_variants(products: Any) -> list[CatalogVariant]:
        items = products.get("items", products) if isinstance(products, dict) else products
        variants: list[CatalogVariant] = []
        for product in items or []:
            for variant in product.get("variants", []) or []:
                stock = variant.get("stock")
                variants.append(
                    CatalogVariant(
                        id=variant["id"],
                        sku=variant.get("sku", ""),
                        title=variant.get("title", ""),
                        description=product.get("description") or "",
                        price=str(variant.get("price", "0.00")),
                        sat_product_code=variant.get("satProductCode", ""),
                        sat_unit_code=variant.get("satUnitCode", "H87"),
                        stock=float(stock) if stock not in (None, "") else None,
                        status=variant.get("status", "ACTIVE"),
                        product_title=product.get("title", ""),
                    )
                )
        return variants

    # ---------- clientes ----------

    async def find_customer(self, query: str) -> list[dict[str, Any]]:
        return await self._request("GET", "/customers", params={"q": query}) or []

    async def create_customer(
        self, *, full_name: str, phone: str | None = None, email: str | None = None
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/customers",
            json_body={"fullName": full_name, "phone": phone, "email": email},
        )

    async def lookup_customer(self, needle: str) -> dict[str, Any] | None:
        """Primer cliente que coincida por teléfono/correo/nombre, o None."""
        existing = await self.find_customer(needle)
        items = existing.get("items", existing) if isinstance(existing, dict) else existing
        return items[0] if items else None

    async def customer_history(self, customer_id: str) -> dict[str, Any]:
        """Cotizaciones y pedidos previos del cliente (cabeceras, sin líneas)."""
        return await self._request("GET", f"/customers/{customer_id}/history") or {}

    async def ensure_customer(
        self, *, full_name: str, phone: str | None = None, email: str | None = None
    ) -> dict[str, Any]:
        """Busca por teléfono/correo/nombre y crea si no existe (idempotente)."""
        needle = phone or email or full_name
        if needle:
            existing = await self.find_customer(needle)
            items = existing.get("items", existing) if isinstance(existing, dict) else existing
            if items:
                return items[0]
        return await self.create_customer(full_name=full_name, phone=phone, email=email)

    # ---------- precios y cotizaciones ----------

    async def price_preview(
        self, lines: list[dict[str, Any]], *, delivery_mode: str | None = None
    ) -> dict[str, Any]:
        """Calculadora oficial. No crea nada: solo totaliza."""
        return await self._request(
            "POST",
            "/pricing/preview",
            json_body={"lines": lines, "deliveryMode": delivery_mode},
        )

    async def create_quote(
        self,
        *,
        customer_id: str,
        lines: list[dict[str, Any]],
        notes: str | None = None,
        issue: bool = True,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/quotes",
            json_body={
                "customerId": customer_id,
                "lines": lines,
                "notes": notes,
                "issue": issue,
            },
            idempotency_key=idempotency_key,
        )

    async def get_quote(self, quote_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/quotes/{quote_id}")

    async def share_quote(self, quote_id: str) -> dict[str, Any]:
        token = await self._request("POST", f"/quotes/{quote_id}/share")
        base = self.settings.public_base_url.rstrip("/")
        token_value = token.get("token") if isinstance(token, dict) else token
        return {"token": token_value, "url": f"{base}/quotes/public/{token_value}"}

    # ---------- pedidos y checkout ----------

    async def order_from_quote(self, quote_id: str, *, idempotency_key: str | None = None) -> dict[str, Any]:
        return await self._request(
            "POST", f"/orders/from-quote/{quote_id}", idempotency_key=idempotency_key
        )

    async def start_checkout(
        self,
        order_id: str,
        *,
        lines: list[dict[str, Any]],
        delivery_mode: str = "PICKUP",
        address_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        result = await self._request(
            "POST",
            f"/orders/{order_id}/checkout",
            json_body={
                "lines": lines,
                "deliveryMode": delivery_mode,
                "addressId": address_id,
            },
            idempotency_key=idempotency_key,
        )
        base = self.settings.public_base_url.rstrip("/")
        token = result.get("checkoutToken") if isinstance(result, dict) else None
        if token:
            result["checkoutUrl"] = f"{base}/checkout/{token}"
        return result

    async def get_order(self, order_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/orders/{order_id}")

    async def list_orders(self, *, status: str | None = None) -> Any:
        return await self._request("GET", "/orders", params={"status": status} if status else None)

    # ---------- diagnóstico ----------

    async def health(self) -> dict[str, Any]:
        try:
            await self._request("GET", "/catalog/products", params={"limit": 1})
            return {"ok": True}
        except CommerceUnavailable as exc:
            return {"ok": False, "reason": str(exc)}
        except CommerceError as exc:
            return {"ok": False, "reason": exc.message, "code": exc.code}
