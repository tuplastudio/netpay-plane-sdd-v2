"""Cliente HTTP hacia la API comercial (NestJS). Agente v2.

Es el único camino del agente hacia datos y efectos comerciales. El tenant y
el principal NO vienen del modelo: se derivan de la API key de servicio
(SPEC-AIA "Herramientas y autoridad", T-FND-05).

Sin `AGENT_API_KEY_REF` el cliente entra en modo offline y devuelve
`CommerceUnavailable`, para que el agente degrade a conversación y handoff
en lugar de inventar datos.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import time
import uuid
from typing import Any

import httpx

from .config import Settings, get_settings

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


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
    def __init__(self, settings: Settings | None = None, *, tenant_id: str = "") -> None:
        self.settings = settings or get_settings()
        self.tenant_id = tenant_id.strip()

    @property
    def live(self) -> bool:
        return self.settings.commerce_live or bool(self.tenant_id and self.settings.internal_key)

    def _auth_headers(self) -> dict[str, str]:
        """Credenciales del backend sin confiar en datos elegidos por el modelo.

        Para el agente multi-tenant, firma el tenant del ``runtime.context`` con
        la llave interna compartida. Commerce API verifica firma y caducidad y
        crea un principal SERVICE limitado a las capacidades del agente. La API
        key histórica sigue como fallback para instalaciones de un solo tenant.
        """
        if self.tenant_id and self.settings.internal_key:
            timestamp = str(int(time.time()))
            payload = f"{timestamp}.{self.tenant_id}".encode("utf-8")
            signature = hmac.new(
                self.settings.internal_key.encode("utf-8"), payload, hashlib.sha256
            ).hexdigest()
            return {
                "x-agent-tenant": self.tenant_id,
                "x-agent-timestamp": timestamp,
                "x-agent-signature": signature,
            }
        if self.settings.commerce_api_key:
            return {"authorization": f"Bearer {self.settings.commerce_api_key}"}
        return {}

    # ---------- transporte ----------

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> Any:
        if not self.live:
            raise CommerceUnavailable("AGENT_API_KEY_REF no configurada")

        headers = {
            **self._auth_headers(),
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
        return body.get("data", body) if isinstance(body, dict) else body

    # ---------- catálogo ----------

    async def search_products(self, query: str | None = None, *, limit: int = 50) -> list[dict[str, Any]]:
        # `status` explícito: sin filtro, /catalog/products devuelve también
        # DRAFT y ARCHIVED (p. ej. un catálogo anterior que se archivó al
        # reemplazarlo). El agente solo debe cotizar lo que de verdad se vende.
        data = await self._request(
            "GET",
            "/catalog/products",
            params={"q": query or "", "limit": min(limit, 100), "status": "ACTIVE"},
        )
        return self._flatten_variants(data)

    async def get_product(self, product_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/catalog/products/{product_id}")

    @staticmethod
    def _flatten_variants(products: Any) -> list[dict[str, Any]]:
        items = products.get("items", products) if isinstance(products, dict) else products
        variants: list[dict[str, Any]] = []
        for product in items or []:
            for variant in product.get("variants", []) or []:
                if variant.get("status", "ACTIVE") != "ACTIVE":
                    # Variante archivada (p. ej. catálogo anterior reemplazado):
                    # aunque el producto padre siga activo, esto no se vende.
                    continue
                stock = variant.get("stock")
                variants.append(
                    {
                        "variantId": variant["id"],
                        "sku": variant.get("sku", ""),
                        "title": variant.get("title", ""),
                        "productTitle": product.get("title", ""),
                        "description": product.get("description") or "",
                        "tags": product.get("tags") or [],
                        "synonyms": product.get("synonyms") or [],
                        "price": str(variant.get("price", "0.00")),
                        "stock": float(stock) if stock not in (None, "") else None,
                        "status": variant.get("status", "ACTIVE"),
                    }
                )
        return variants

    async def get_company_context(self) -> dict[str, Any]:
        """Identidad canónica del tenant autenticado en Commerce API."""
        return await self._request("GET", "/tenants/me/agent-context") or {}

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
        self,
        *,
        full_name: str,
        phone: str | None = None,
        email: str | None = None,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        """Resuelve (o crea) el cliente y lo deja completo y ligado.

        Con `conversation_id`, el backend resuelve el canal y el teléfono
        desde la conversación real (más confiable que lo que sepa el agente),
        completa lo que le falte a la ficha (sin pisar un nombre real ya
        cargado) y, si el hilo no tenía cliente asignado, lo vincula — así
        deja de quedar "Cliente sin ficha" en el panel para cotizaciones que
        ya tienen un cliente real detrás. Ver
        `CustomerService.resolveChannelContact` en commerce-api.
        """
        if conversation_id and not _UUID_RE.fullmatch(conversation_id.strip()):
            # Los hilos de WhatsApp tienen id UUID; cualquier otro id (chat
            # web, pruebas) no es una conversación que el backend pueda ligar.
            conversation_id = None
        return await self._request(
            "POST",
            "/customers/resolve-channel",
            json_body={
                "fullName": full_name,
                "phone": phone,
                "email": email,
                "conversationId": conversation_id,
            },
        )

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

    async def get_quote_pdf_base64(self, quote_id: str) -> str:
        """PDF comercial de la cotización, en base64 (para adjuntar por WhatsApp).

        No usa `_request`: esa devuelve JSON, este endpoint devuelve el PDF
        crudo (`application/pdf`). Va autenticado con la misma API key del
        agente, así que no depende de que el enlace público sea alcanzable
        desde fuera (la PDF viaja como adjunto, no como URL).
        """
        if not self.live:
            raise CommerceUnavailable("AGENT_API_KEY_REF no configurada")
        headers = {
            **self._auth_headers(),
            "x-request-id": str(uuid.uuid4()),
        }
        url = f"{self.settings.commerce_api_url.rstrip('/')}/quotes/{quote_id}/pdf"
        try:
            async with httpx.AsyncClient(timeout=self.settings.commerce_timeout) as client:
                response = await client.get(url, headers=headers)
        except httpx.HTTPError as exc:
            raise CommerceUnavailable(f"API comercial inalcanzable: {exc}") from exc
        if response.status_code >= 400:
            raise CommerceError(response.status_code, "PDF_ERROR", "no se pudo generar el PDF")
        return base64.b64encode(response.content).decode("ascii")

    async def share_quote(self, quote_id: str) -> dict[str, Any]:
        # notify=false: el agente pone el enlace en su propia respuesta; sin
        # esto el dispatcher de notificaciones le mandaba el mismo enlace al
        # cliente por WhatsApp una segunda vez.
        token = await self._request("POST", f"/quotes/{quote_id}/share", json_body={"notify": False})
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

    async def record_usage(
        self, *, model: str, input_tokens: int, output_tokens: int, cost_usd: str
    ) -> None:
        """Reporta consumo de tokens del turno. Best-effort: nunca debe tumbar
        el turno de chat, así que el llamador la envuelve en try/except."""
        await self._request(
            "POST",
            "/usage/events",
            json_body={
                "model": model,
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "costUsd": cost_usd,
            },
        )

    async def request_invoice(
        self,
        order_id: str,
        *,
        rfc: str,
        legal_name: str,
        postal_code: str,
        cfdi_use: str,
        constancia_url: str | None = None,
        notes: str | None = None,
    ) -> dict[str, Any]:
        return await self._request(
            "PATCH",
            f"/orders/{order_id}/invoice-request",
            json_body={
                "rfc": rfc,
                "legalName": legal_name,
                "postalCode": postal_code,
                "cfdiUse": cfdi_use,
                "constanciaUrl": constancia_url,
                "notes": notes,
            },
        )

    # ---------- diagnóstico ----------

    async def health(self) -> dict[str, Any]:
        try:
            # El probe es público y no necesita escoger un tenant. Probar el
            # catálogo con una API key global daría un falso negativo en el
            # modo multi-tenant firmado.
            await self._request("GET", "/healthz")
            return {"ok": True}
        except CommerceUnavailable as exc:
            return {"ok": False, "reason": str(exc)}
        except CommerceError as exc:
            return {"ok": False, "reason": exc.message, "code": exc.code}
