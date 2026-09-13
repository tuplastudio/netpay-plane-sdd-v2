"""Resolución del contexto de un tenant: UN grafo, N negocios.

No hay "un bot por negocio". El grafo compilado (``agent.py``) es único y
compartido; lo que cambia por tenant es un paquete de contexto que se arma
aquí en cada llamada al modelo y se inyecta en el prompt:

- **Perfil** (``knowledge.load_profile``): identidad del frontmatter de
  ``negocio.md`` del tenant.
- **Overrides del panel** (``agent_settings``): nombre, tono, estilo de
  venta, reglas extra, modelo, versión de prompt fijada...
- **Identidad canónica** (``CommerceClient.get_company_context``): el nombre
  del tenant según Commerce API manda sobre cualquier Markdown.
- **Catálogo** (``CommerceClient.search_products``): cacheado por tenant.
- **Conocimiento** (``knowledge.load_knowledge``): Markdown del tenant,
  aislado por subárbol.
- **Versión de prompt** (``prompts.registry``): la fijada por el tenant, si
  existe; si no, la del proceso; si no, ``latest``.
- **Lecciones** (``memory.episodic``): bloque agregado de comportamiento.

Todo está cacheado con TTL corto por tenant (catálogo e identidad) o
invalidado por evento (conocimiento, settings, episodios), así que armar el
paquete en cada turno cuesta lecturas en memoria, no llamadas de red.

Agregar un negocio nuevo = darle un ``tenant_id`` en Commerce API y, si
quiere, su carpeta de conocimiento y su configuración en el panel. Nada de
esto requiere desplegar ni recompilar el grafo.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field, replace
from typing import Any

from .agent_settings import AgentSettings, get_agent_settings
from .commerce import CommerceClient, CommerceError, CommerceUnavailable
from .config import Settings, get_settings
from .knowledge import BusinessProfile, load_internal_notes, load_knowledge, load_profile
from .prompts import PromptVersion, get_prompt_registry

logger = logging.getLogger(__name__)


class _TtlCache:
    """Caché async por tenant con TTL; el ``loader`` se ejecuta bajo lock."""

    def __init__(self, ttl_seconds: float) -> None:
        self.ttl = ttl_seconds
        self._entries: dict[str, tuple[float, Any]] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str, loader: Any) -> Any:
        now = asyncio.get_running_loop().time()
        cached = self._entries.get(key)
        if cached and now - cached[0] < self.ttl:
            return cached[1]
        async with self._lock:
            cached = self._entries.get(key)
            if cached and now - cached[0] < self.ttl:
                return cached[1]
            value = await loader()
            self._entries[key] = (now, value)
            return value

    def invalidate(self, key: str | None = None) -> None:
        if key is None:
            self._entries.clear()
        else:
            self._entries.pop(key, None)


async def _render_catalog(tenant_id: str) -> str:
    client = CommerceClient(tenant_id=tenant_id)
    if not client.live:
        return ""
    try:
        variants = await client.search_products(None, limit=100)
    except (CommerceError, CommerceUnavailable):
        return ""
    grouped: dict[str, list[dict[str, Any]]] = {}
    for variant in variants:
        if variant.get("status") != "ACTIVE":
            continue
        grouped.setdefault(variant["productTitle"] or variant["title"], []).append(variant)
    lines: list[str] = []
    for product, items in grouped.items():
        lines.append(f"{product}:")
        for v in items:
            stock = v.get("stock")
            warn = " SIN EXISTENCIA" if stock is not None and stock <= 0 else ""
            lines.append(f"  - {v['title']} | {v['sku']} | ${v['price']}{warn}")
    return "\n".join(lines)


async def _load_company(tenant_id: str) -> dict[str, Any]:
    try:
        return await CommerceClient(tenant_id=tenant_id).get_company_context()
    except (CommerceError, CommerceUnavailable):
        return {}


_CATALOG = _TtlCache(120.0)
_COMPANY = _TtlCache(120.0)


async def load_catalog(tenant_id: str) -> str:
    """Bloque de catálogo del tenant (cacheado 120 s)."""
    return await _CATALOG.get(tenant_id, lambda: _render_catalog(tenant_id))


async def load_company_context(tenant_id: str) -> dict[str, Any]:
    """Identidad canónica del tenant en Commerce API (cacheada 120 s)."""
    return await _COMPANY.get(tenant_id, lambda: _load_company(tenant_id))


async def warm_catalog(tenant_id: str = "") -> None:
    """Precalienta la caché del catálogo al arrancar (ver ``main._warmup``)."""
    await load_catalog(tenant_id)


def invalidate_tenant_caches(tenant_id: str | None = None) -> None:
    _CATALOG.invalidate(tenant_id)
    _COMPANY.invalidate(tenant_id)


@dataclass(frozen=True)
class TenantBundle:
    """Todo lo que el prompt y los guards necesitan saber de un tenant en un turno."""

    tenant_id: str
    profile: BusinessProfile
    overrides: AgentSettings
    company: dict[str, Any] = field(default_factory=dict)
    catalog: str = ""
    knowledge: str = ""
    internal_notes: tuple[str, ...] = ()
    prompt: PromptVersion | None = None
    lessons: str = ""

    @property
    def business_name(self) -> str:
        return (
            (self.overrides.business_name or "").strip()
            or str(self.company.get("name") or "").strip()
            or self.profile.name
        )

    @property
    def prompt_version(self) -> str:
        return self.prompt.version if self.prompt else ""


async def resolve_tenant_bundle(
    tenant_id: str,
    *,
    settings: Settings | None = None,
    include_catalog: bool = True,
    include_lessons: bool = True,
) -> TenantBundle:
    """Arma el paquete de contexto del tenant. Nunca lanza por un backend caído."""
    settings = settings or get_settings()
    overrides = get_agent_settings(tenant_id) if tenant_id else AgentSettings()
    profile = load_profile(tenant_id)

    catalog = ""
    company: dict[str, Any] = {}
    if tenant_id:
        if include_catalog:
            catalog, company = await asyncio.gather(load_catalog(tenant_id), load_company_context(tenant_id))
        else:
            company = await load_company_context(tenant_id)
    if company.get("name"):
        profile = replace(profile, name=str(company["name"]))

    prompt = get_prompt_registry().resolve(overrides.prompt_version, settings.prompt_version)

    lessons = ""
    if include_lessons and tenant_id and settings.episodic_memory_enabled and settings.episodic_lessons_in_prompt > 0:
        try:
            from .memory.episodic import get_episode_store

            lessons = await get_episode_store().lessons(
                tenant_id, limit=settings.episodic_lessons_in_prompt
            )
        except Exception:  # noqa: BLE001 - las lecciones son opcionales
            logger.warning("no se pudieron cargar lecciones episódicas", exc_info=True)

    return TenantBundle(
        tenant_id=tenant_id,
        profile=profile,
        overrides=overrides,
        company=company,
        catalog=catalog,
        knowledge=load_knowledge(tenant_id),
        internal_notes=tuple(load_internal_notes(tenant_id)),
        prompt=prompt,
        lessons=lessons,
    )
