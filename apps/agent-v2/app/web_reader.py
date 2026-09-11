"""Leer una página web y convertirla en conocimiento del negocio.

Usa `crawl4ai` (Chromium vía Playwright) para bajar una URL pública y sacar su
Markdown. El resultado se trata exactamente igual que un `.md` subido a mano
en `knowledge.py`: es DATO del negocio, nunca una instrucción para el modelo
(mismo principio que `INJECTION_PATTERNS` en knowledge.py — esa detección ya
corre sobre cualquier documento al leerlo, incluido el que este módulo
escribe, así que no se duplica aquí).

Setup de una sola vez (ya corrido en este sandbox, pero si `crawl_url` falla
con "el navegador de crawl4ai no está instalado" hay que correrlo donde se
despliegue el servicio):

    cd apps/agent-v2
    ./.venv/bin/pip install crawl4ai==0.9.3
    ./.venv/bin/python -m playwright install chromium
    ./.venv/bin/crawl4ai-setup      # opcional, valida la instalación
    ./.venv/bin/crawl4ai-doctor     # opcional, prueba un crawl real

Si el navegador no está instalado, `crawl_url()` NUNCA lanza — regresa un
`WebCrawlResult` con `error` seteado, para que el panel lo muestre como un
error de usuario (no un 500).

Guardas de SSRF (`_validate_public_url`): solo `http`/`https`, se resuelve el
host por DNS y se rechaza si CUALQUIER IP resuelta cae en rangos privados,
loopback, link-local, reservados, multicast o "sin especificar" (RFC 1918,
RFC 4193, 127.0.0.0/8, 169.254.0.0/16, ::1, fe80::/10, etc. — lo que ya cubre
`ipaddress.IPv4Address`/`IPv6Address` con sus propiedades `is_private` /
`is_loopback` / `is_link_local` / `is_reserved` / `is_multicast` /
`is_unspecified`). No hay un helper compartido de SSRF en el repo (se buscó
en `apps/commerce-api/src/common`; los guards que existen ahí son de
autorización de tenant, no de red) — esto es un equivalente pequeño y
autocontenido, no una librería general.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from dataclasses import dataclass, field
from datetime import datetime, timezone
from urllib.parse import urlsplit

from .knowledge import KnowledgeUploadError, save_uploaded_doc

# Tope de navegación por crawl4ai (ms) y tope total de la operación (s,
# incluye levantar Chromium + navegar + parsear): dos relojes porque el
# primero solo cubre la espera de red/DOM y un arranque de browser lento
# podría de todos modos colgar la request sin el segundo.
_PAGE_TIMEOUT_MS = 20_000
_TOTAL_TIMEOUT_SECONDS = 45.0

# ~200 KB de markdown es de sobra para cualquier artículo real; tope
# defensivo contra una página gigante (o un sitio que sirve un dump infinito)
# antes de que este texto entre a MAX_UPLOAD_BYTES de knowledge.py.
_MAX_MARKDOWN_CHARS = 200_000

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")


class WebReadError(ValueError):
    """Error limpio al leer o guardar una URL: inválida, bloqueada por el
    guard de SSRF, timeout, sitio caído, navegador no instalado, o ninguna
    sección seleccionada sobrevivió al re-crawl. `main.py` la traduce a HTTP 400."""


@dataclass
class WebSection:
    """Una sección de nivel superior del Markdown extraído (heading + cuerpo),
    para que el panel ofrezca un checkbox por sección."""

    heading: str
    body: str


@dataclass
class WebCrawlResult:
    url: str
    title: str = ""
    markdown: str = ""
    sections: list[WebSection] = field(default_factory=list)
    error: str | None = None


def _validate_public_url(url: str) -> None:
    """Solo http/https, y el host no puede resolver a una IP interna.
    Lanza `WebReadError` con un mensaje presentable en el panel."""
    parts = urlsplit((url or "").strip())
    if parts.scheme not in {"http", "https"}:
        raise WebReadError("Solo se aceptan URLs http:// o https://")
    host = parts.hostname
    if not host:
        raise WebReadError("URL inválida: falta el dominio")
    if host.lower() in {"localhost", "localhost.localdomain", "ip6-localhost"}:
        raise WebReadError("No se permiten URLs locales")

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise WebReadError(f"No se pudo resolver el dominio: {host}") from exc
    if not infos:
        raise WebReadError(f"No se pudo resolver el dominio: {host}")

    for info in infos:
        raw_ip = info[4][0].split("%", 1)[0]  # descarta el zone id de IPv6 link-local
        try:
            ip = ipaddress.ip_address(raw_ip)
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise WebReadError("No se permiten URLs que apunten a redes internas")


def _browser_missing_message(detail: str) -> str | None:
    lowered = detail.lower()
    if "executable doesn't exist" in lowered or "playwright install" in lowered or "browsertype.launch" in lowered:
        return (
            "El navegador de crawl4ai no está instalado en este servidor. Corre: "
            "cd apps/agent-v2 && ./.venv/bin/python -m playwright install chromium"
        )
    return None


def _split_top_level_sections(markdown_text: str, *, fallback_title: str) -> list[WebSection]:
    """Divide el Markdown por su nivel de encabezado MÁS ALTO (el mínimo `#`
    presente): si la página usa `#`/`##`/`###`, corta en los `#`; si solo usa
    `##` en adelante, corta en los `##`. Los subtítulos de nivel más profundo
    quedan dentro del cuerpo de su sección, sin sub-dividir más — el panel
    solo necesita secciones de nivel superior para el checkbox por sección."""
    lines = markdown_text.splitlines()
    matches = [
        (i, len(m.group(1)), m.group(2).strip())
        for i, line in enumerate(lines)
        if (m := _HEADING_RE.match(line))
    ]
    if not matches:
        body = markdown_text.strip()
        return [WebSection(heading=fallback_title, body=body)] if body else []

    top_level = min(level for _, level, _ in matches)
    top_matches = [(idx, title) for idx, level, title in matches if level == top_level]

    sections: list[WebSection] = []
    intro = "\n".join(lines[: top_matches[0][0]]).strip()
    if intro:
        sections.append(WebSection(heading="Introducción", body=intro))

    for pos, (line_idx, title) in enumerate(top_matches):
        start = line_idx + 1
        end = top_matches[pos + 1][0] if pos + 1 < len(top_matches) else len(lines)
        body = "\n".join(lines[start:end]).strip()
        sections.append(WebSection(heading=title or fallback_title, body=body))
    return sections


async def crawl_url(url: str) -> WebCrawlResult:
    """Baja `url` y regresa título + markdown + secciones de nivel superior.

    Nunca lanza: cualquier falla (URL inválida, SSRF, timeout, sitio caído,
    navegador no instalado) vuelve como `WebCrawlResult.error`, para que las
    rutas de `main.py` la devuelvan como un 400 legible, no un 500.
    """
    try:
        _validate_public_url(url)
    except WebReadError as exc:
        return WebCrawlResult(url=url, error=str(exc))

    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
    except ImportError:
        return WebCrawlResult(
            url=url,
            error=(
                "crawl4ai no está instalado. Corre en apps/agent-v2: "
                "./.venv/bin/pip install crawl4ai==0.9.3 && "
                "./.venv/bin/python -m playwright install chromium"
            ),
        )

    browser_cfg = BrowserConfig(headless=True, verbose=False)
    run_cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=_PAGE_TIMEOUT_MS,
        word_count_threshold=1,
        wait_until="domcontentloaded",
    )

    try:
        async with AsyncWebCrawler(config=browser_cfg) as crawler:
            result = await asyncio.wait_for(
                crawler.arun(url=url, config=run_cfg), timeout=_TOTAL_TIMEOUT_SECONDS
            )
    except TimeoutError:
        return WebCrawlResult(url=url, error="La página tardó demasiado en responder")
    except Exception as exc:  # noqa: BLE001 — cualquier falla de crawl4ai/Playwright se vuelve mensaje limpio
        detail = str(exc)
        error = _browser_missing_message(detail) or f"No se pudo leer la página: {detail[:300]}"
        return WebCrawlResult(url=url, error=error)

    if not result.success:
        detail = (result.error_message or "").strip()
        browser_missing = _browser_missing_message(detail)
        status = result.status_code
        if browser_missing:
            error = browser_missing
        elif status == 404:
            error = "La página no existe (404)"
        elif status and status >= 400:
            error = f"El sitio respondió con error {status}"
        else:
            error = detail[:300] or "No se pudo leer la página"
        return WebCrawlResult(url=url, error=error)

    title = str((result.metadata or {}).get("title") or "").strip() or url
    markdown_text = str(result.markdown or "").strip()[:_MAX_MARKDOWN_CHARS]
    if not markdown_text:
        return WebCrawlResult(url=url, title=title, error="La página no tiene contenido de texto para extraer")

    sections = _split_top_level_sections(markdown_text, fallback_title=title)
    return WebCrawlResult(url=url, title=title, markdown=markdown_text, sections=sections)


def _default_filename(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:80]
    return f"{slug or 'pagina-web'}.md"


def render_saved_markdown(*, url: str, title: str, sections: list[WebSection]) -> str:
    """Arma el `.md` que se guarda: un encabezado con la fuente y la fecha de
    captura (dato de auditoría, no frontmatter — no debe mezclarse con el
    perfil de negocio que `knowledge.py` parsea de `---\\n...\\n---`), seguido
    del título y las secciones elegidas."""
    captured_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    parts = [f"Fuente: {url}\nCapturado: {captured_at}", f"# {title.strip() or url}"]
    for section in sections:
        heading = section.heading.strip() or "Sección"
        body = section.body.strip()
        parts.append(f"## {heading}\n\n{body}" if body else f"## {heading}")
    return "\n\n".join(parts).strip() + "\n"


async def save_web_page(
    tenant_id: str,
    *,
    url: str,
    title: str,
    selected_sections: list[str] | None,
    filename: str | None,
) -> tuple[str, WebCrawlResult]:
    """Vuelve a crawlear `url` (la fuente de verdad es el sitio, no lo que el
    panel mostró en el preview, que pudo quedar desactualizado o venir
    manipulado desde el cliente) y guarda un único `.md` con las secciones
    elegidas -- `selected_sections=None` guarda todas -- vía
    `save_uploaded_doc`, exactamente como una subida manual.

    Lanza `WebReadError` si el re-crawl falla o si ninguna de las secciones
    pedidas sigue existiendo; `KnowledgeUploadError` si `save_uploaded_doc`
    rechaza el archivo resultante (no debería, pero se deja subir).
    """
    result = await crawl_url(url)
    if result.error:
        raise WebReadError(result.error)

    chosen = result.sections
    if selected_sections is not None:
        wanted = set(selected_sections)
        chosen = [s for s in result.sections if s.heading in wanted]
        if not chosen:
            raise WebReadError(
                "Ninguna de las secciones seleccionadas sigue existiendo en la página (¿cambió desde el preview?)"
            )

    doc_title = title.strip() or result.title or url
    markdown_doc = render_saved_markdown(url=url, title=doc_title, sections=chosen)

    name = (filename or "").strip() or _default_filename(doc_title)
    if not name.lower().endswith(".md"):
        name = f"{name}.md"

    try:
        doc_id = save_uploaded_doc(tenant_id, name, markdown_doc.encode("utf-8"))
    except KnowledgeUploadError:
        raise
    return doc_id, result
