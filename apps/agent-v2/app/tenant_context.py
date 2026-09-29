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
import contextvars
import logging
from dataclasses import dataclass, field, replace
from typing import Any, Awaitable, Callable

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


_VARIANTS = _TtlCache(120.0)


async def load_variants(tenant_id: str, loader: Callable[[], Awaitable[list[dict[str, Any]]]]) -> list[dict[str, Any]]:
    """Variantes activas del tenant (cacheadas 120 s).

    El ``loader`` lo pone quien llama (normalmente ``CommerceClient.search_products``)
    para que las pruebas puedan inyectar un doble sin red. Comparte TTL e
    invalidación con el bloque de catálogo del prompt.
    """
    return await _VARIANTS.get(tenant_id, loader)


async def _render_catalog(tenant_id: str) -> str:
    client = CommerceClient(tenant_id=tenant_id)
    if not client.live:
        return ""
    try:
        variants = await load_variants(tenant_id, lambda: client.search_products(None, limit=100))
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
    return cap_catalog("\n".join(lines), get_settings().catalog_max_chars)


CATALOG_TRUNCATED_NOTE = (
    "(… catálogo recortado: hay {more} productos más; usa buscar_productos para "
    "encontrar cualquiera que no aparezca aquí)"
)


def cap_catalog(text: str, max_chars: int) -> str:
    """Recorta el bloque de catálogo a ``max_chars`` sin partir una línea.

    El catálogo se reinyecta en CADA llamada al modelo: por encima del tope
    cuesta más tokens de los que aporta, porque el modelo igual debe usar
    ``buscar_productos`` (caché de 120 s, sin tokens) para variantId, precio
    y existencia. Se anota cuántos productos (encabezados) quedaron fuera.
    ``max_chars <= 0`` desactiva el tope.
    """
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    kept: list[str] = []
    used = 0
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if used + len(line) + 1 > max_chars:
            remaining = lines[index:]
            more = sum(1 for l in remaining if l and not l.startswith(" "))
            # No dejar un encabezado de producto sin sus variantes.
            while kept and kept[-1] and not kept[-1].startswith(" "):
                kept.pop()
                more += 1
            kept.append(CATALOG_TRUNCATED_NOTE.format(more=max(more, 1)))
            return "\n".join(kept)
        kept.append(line)
        used += len(line) + 1
    return "\n".join(kept)


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
    _VARIANTS.invalidate(tenant_id)
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


# ---------------------------------------------------------------- memo por turno
#
# `sales_prompt` corre en CADA llamada al modelo (2-4 por turno con tools) y
# el guard de salida vuelve a pedir el bundle al final. Dentro de un mismo
# turno nada de esto cambia (settings, conocimiento, catálogo con TTL,
# lecciones con TTL), así que se memoiza por turno en un ContextVar: el
# pipeline abre el ámbito con `turn_scope()` y las tasks que LangGraph crea
# dentro del turno heredan el mismo dict (asyncio copia el contexto por
# referencia al crear tasks). Fuera de un turno (arranque, endpoints del
# panel) no hay memo y se resuelve como siempre.

_TURN_MEMO: contextvars.ContextVar[dict[tuple[str, bool, bool], "TenantBundle"] | None] = (
    contextvars.ContextVar("tenant_bundle_turn_memo", default=None)
)


class turn_scope:
    """Context manager: memo de bundles válido solo durante el turno.

    Uso en el pipeline::

        with turn_scope():
            ... invocar grafo, guard de salida ...
    """

    def __enter__(self) -> None:
        self._token = _TURN_MEMO.set({})

    def __exit__(self, *_exc: Any) -> None:
        _TURN_MEMO.reset(self._token)


def invalidate_turn_memo() -> None:
    """Vacía el memo del turno en curso (para pruebas o tras un cambio de
    settings a mitad de turno)."""
    memo = _TURN_MEMO.get()
    if memo is not None:
        memo.clear()


async def resolve_tenant_bundle(
    tenant_id: str,
    *,
    settings: Settings | None = None,
    include_catalog: bool = True,
    include_lessons: bool = True,
) -> TenantBundle:
    """Arma el paquete de contexto del tenant. Nunca lanza por un backend caído.

    Dentro de un turno (`turn_scope`) el resultado se memoiza por
    ``(tenant_id, include_catalog, include_lessons)``: la segunda llamada al
    modelo del mismo turno y el guard de salida no vuelven a leer disco,
    sqlite ni caché.
    """
    memo = _TURN_MEMO.get()
    key = (tenant_id, include_catalog, include_lessons)
    if memo is not None and key in memo:
        return memo[key]
    bundle = await _resolve_tenant_bundle(
        tenant_id, settings=settings, include_catalog=include_catalog, include_lessons=include_lessons
    )
    if memo is not None:
        memo[key] = bundle
    return bundle


async def _resolve_tenant_bundle(
    tenant_id: str,
    *,
    settings: Settings | None,
    include_catalog: bool,
    include_lessons: bool,
) -> TenantBundle:
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
