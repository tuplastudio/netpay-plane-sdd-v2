"""Prompts versionados del agente v2.

- ``registry``: descubre y carga ``prompts/vX.Y.Z/`` desde disco (bloques
  ``.md``, ``manifest.yaml``, estilos), resuelve ``latest`` y versiones
  fijadas por tenant.
- ``assembler``: combina los bloques estáticos de una versión con lo dinámico
  del turno (identidad, memoria, catálogo, conocimiento, lecciones) usando
  delimitadores de datos.

Uso::

    from app.prompts import get_prompt_registry, assemble_prompt
    version = get_prompt_registry().resolve(tenant_pin, settings.prompt_version)
    text = assemble_prompt(version, profile=..., overrides=..., working_memory=...)
"""

from .assembler import (
    DATA_TAGS,
    assemble_prompt,
    escape_data,
    identity_variables,
    overrides_block,
    wrap_data,
)
from .registry import (
    LATEST,
    PromptBlock,
    PromptRegistry,
    PromptRegistryEmpty,
    PromptVersion,
    PromptVersionNotFound,
    get_prompt_registry,
    normalize_version,
    parse_version,
    render_template,
    reset_prompt_registry,
)

__all__ = [
    "DATA_TAGS",
    "LATEST",
    "PromptBlock",
    "PromptRegistry",
    "PromptRegistryEmpty",
    "PromptVersion",
    "PromptVersionNotFound",
    "assemble_prompt",
    "escape_data",
    "get_prompt_registry",
    "identity_variables",
    "normalize_version",
    "overrides_block",
    "parse_version",
    "render_template",
    "reset_prompt_registry",
    "wrap_data",
]
