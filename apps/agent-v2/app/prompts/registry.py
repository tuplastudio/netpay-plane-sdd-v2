"""Registro de prompts versionados en disco.

Layout esperado (``settings.prompts_dir``, por defecto ``apps/agent-v2/prompts``)::

    prompts/
      v1.0.0/
        manifest.yaml          # version, status, description, changelog
        00_identidad.md        # bloques estáticos, en orden alfabético
        10_como_hablas.md
        ...
        styles/consultivo.md   # bloques opcionales por estilo de venta
      v1.1.0/
        ...

Cada carpeta ``vX.Y.Z`` es una versión inmutable del prompt. ``latest``
resuelve a la versión más alta (orden semver) cuyo ``status`` no sea
``draft``. Un tenant puede fijar una versión concreta desde el panel
(``AgentSettings.prompt_version``) y el proceso trae un valor por defecto en
``PROMPT_VERSION`` (env). Si la versión pedida no existe se degrada a
``latest`` con un warning: un número mal escrito en el panel nunca puede
dejar al agente sin prompt.

Plantillas: los bloques admiten ``{{variable}}``. La sustitución es por
línea y una línea cuyo placeholder resuelve a vacío se elimina entera (así
"Horario de atención: {{hours}}." desaparece cuando el negocio no declaró
horario). No se usa ``str.format`` a propósito: el prompt lleva llaves y
JSON de ejemplo y no queremos escaparlos.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

import yaml

logger = logging.getLogger(__name__)

LATEST = "latest"
MANIFEST_NAME = "manifest.yaml"
STYLES_SUBDIR = "styles"

_VERSION_DIR_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")
_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


class PromptVersionNotFound(LookupError):
    """No existe una carpeta de prompt para la versión pedida."""


class PromptRegistryEmpty(RuntimeError):
    """El directorio de prompts no tiene ninguna versión válida."""


def parse_version(value: str) -> tuple[int, int, int] | None:
    """``"v1.2.3"`` o ``"1.2.3"`` → ``(1, 2, 3)``; ``None`` si no es semver."""
    match = _VERSION_DIR_RE.match((value or "").strip())
    if not match:
        return None
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def normalize_version(value: str) -> str:
    """Forma canónica ``X.Y.Z`` (sin ``v``) o ``latest``. Cadena vacía si es inválida."""
    raw = (value or "").strip().lower()
    if not raw or raw == LATEST:
        return LATEST
    parsed = parse_version(raw)
    if parsed is None:
        return ""
    return ".".join(str(part) for part in parsed)


def render_template(text: str, variables: Mapping[str, Any]) -> str:
    """Sustituye ``{{var}}`` línea por línea.

    Una línea que referencia una variable vacía o desconocida se elimina
    completa. Las líneas sin placeholders pasan intactas.
    """
    rendered: list[str] = []
    for line in text.splitlines():
        drop = False

        def replace(match: re.Match[str]) -> str:
            nonlocal drop
            value = variables.get(match.group(1))
            if value is None or str(value).strip() == "":
                drop = True
                return ""
            return str(value)

        out = _PLACEHOLDER_RE.sub(replace, line)
        if not drop:
            rendered.append(out)
    return "\n".join(rendered).strip()


@dataclass(frozen=True)
class PromptBlock:
    """Un archivo ``.md`` de la versión: nombre (sin extensión) y texto crudo."""

    name: str
    text: str

    def render(self, variables: Mapping[str, Any] | None = None) -> str:
        return render_template(self.text, variables or {})


@dataclass(frozen=True)
class PromptVersion:
    """Una versión cargada en memoria: manifest + bloques + estilos."""

    version: str
    path: Path
    manifest: dict[str, Any]
    blocks: tuple[PromptBlock, ...]
    styles: dict[str, str] = field(default_factory=dict)

    @property
    def status(self) -> str:
        return str(self.manifest.get("status") or "stable").lower()

    @property
    def description(self) -> str:
        return str(self.manifest.get("description") or "").strip()

    def block(self, name: str) -> PromptBlock | None:
        for candidate in self.blocks:
            if candidate.name == name:
                return candidate
        return None

    def static_text(self, variables: Mapping[str, Any] | None = None) -> str:
        """Todos los bloques renderizados y unidos, en orden de archivo."""
        parts = [block.render(variables) for block in self.blocks]
        return "\n\n".join(part for part in parts if part)

    def protected_lines(self, min_chars: int = 40) -> tuple[str, ...]:
        """Líneas distintivas del prompt (para detectar fugas en la salida).

        Se excluyen las líneas con placeholders (cambian por tenant y el
        guard las compara literal) y las muy cortas (falsos positivos).
        """
        lines: list[str] = []
        for block in self.blocks:
            for raw in block.text.splitlines():
                line = " ".join(raw.split())
                if len(line) >= min_chars and not _PLACEHOLDER_RE.search(line):
                    lines.append(line)
        for style_text in self.styles.values():
            for raw in style_text.splitlines():
                line = " ".join(raw.split())
                if len(line) >= min_chars:
                    lines.append(line)
        return tuple(lines)

    def to_dict(self, *, include_text: bool = False) -> dict[str, Any]:
        data: dict[str, Any] = {
            "version": self.version,
            "status": self.status,
            "description": self.description,
            "created": str(self.manifest.get("created") or ""),
            "changelog": list(self.manifest.get("changelog") or []),
            "blocks": [b.name for b in self.blocks],
            "styles": sorted(self.styles),
        }
        if include_text:
            data["blockTexts"] = {b.name: b.text for b in self.blocks}
            data["styleTexts"] = dict(self.styles)
        return data


def _load_version_dir(path: Path) -> PromptVersion | None:
    parsed = parse_version(path.name)
    if parsed is None or not path.is_dir():
        return None
    version = ".".join(str(part) for part in parsed)

    manifest: dict[str, Any] = {}
    manifest_path = path / MANIFEST_NAME
    if manifest_path.is_file():
        try:
            loaded = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
            if isinstance(loaded, dict):
                manifest = loaded
        except (OSError, yaml.YAMLError) as exc:
            logger.warning("prompt %s: manifest ilegible (%s), se usa vacío", version, exc)

    blocks: list[PromptBlock] = []
    for file in sorted(path.glob("*.md")):
        if file.name.upper().startswith("README"):
            continue
        try:
            text = file.read_text(encoding="utf-8").strip()
        except OSError as exc:
            logger.warning("prompt %s: no se pudo leer %s (%s)", version, file.name, exc)
            continue
        if text:
            blocks.append(PromptBlock(name=file.stem, text=text))
    if not blocks:
        logger.warning("prompt %s: carpeta sin bloques .md, se ignora", version)
        return None

    styles: dict[str, str] = {}
    styles_dir = path / STYLES_SUBDIR
    if styles_dir.is_dir():
        for file in sorted(styles_dir.glob("*.md")):
            try:
                styles[file.stem.lower()] = file.read_text(encoding="utf-8").strip()
            except OSError:
                continue

    return PromptVersion(
        version=version, path=path, manifest=manifest, blocks=tuple(blocks), styles=styles
    )


class PromptRegistry:
    """Carga todas las versiones de ``root`` una vez; ``reload()`` para releer."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self._versions: dict[str, PromptVersion] = {}
        self.reload()

    def reload(self) -> None:
        versions: dict[str, PromptVersion] = {}
        if self.root.is_dir():
            for child in sorted(self.root.iterdir()):
                loaded = _load_version_dir(child)
                if loaded is not None:
                    versions[loaded.version] = loaded
        if not versions:
            raise PromptRegistryEmpty(f"sin versiones de prompt en {self.root}")
        self._versions = versions
        logger.info("prompts cargados: %s (latest=%s)", ", ".join(self.versions()), self.latest())

    def versions(self) -> list[str]:
        """Versiones disponibles, de la más nueva a la más vieja."""
        return sorted(self._versions, key=lambda v: parse_version(v) or (0, 0, 0), reverse=True)

    def latest(self) -> str:
        """Versión más alta cuyo ``status`` no sea ``draft``; si todas son draft, la más alta."""
        ordered = self.versions()
        for version in ordered:
            if self._versions[version].status != "draft":
                return version
        return ordered[0]

    def get(self, version: str) -> PromptVersion:
        canonical = normalize_version(version)
        if canonical == LATEST:
            return self._versions[self.latest()]
        if canonical not in self._versions:
            raise PromptVersionNotFound(version)
        return self._versions[canonical]

    def resolve(self, *requested: str | None) -> PromptVersion:
        """Primera versión válida de la cadena de preferencias.

        Uso típico: ``resolve(tenant_override, process_default)`` — el tenant
        gana si fijó una versión existente; si no, el default del proceso; si
        ninguno existe, ``latest`` con warning. Nunca lanza.
        """
        for candidate in requested:
            if not candidate:
                continue
            try:
                return self.get(candidate)
            except PromptVersionNotFound:
                logger.warning("versión de prompt %r no existe; se usa latest", candidate)
        return self.get(LATEST)

    def to_dict(self) -> dict[str, Any]:
        return {
            "root": str(self.root),
            "latest": self.latest(),
            "versions": [self._versions[v].to_dict() for v in self.versions()],
        }


_REGISTRY: PromptRegistry | None = None


def get_prompt_registry() -> PromptRegistry:
    """Singleton perezoso sobre ``settings.prompts_dir``."""
    global _REGISTRY
    if _REGISTRY is None:
        from ..config import get_settings

        _REGISTRY = PromptRegistry(get_settings().prompts_dir)
    return _REGISTRY


def reset_prompt_registry() -> None:
    """Para pruebas: fuerza a recrear el singleton con la config actual."""
    global _REGISTRY
    _REGISTRY = None
