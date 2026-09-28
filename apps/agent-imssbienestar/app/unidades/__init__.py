"""Catálogo de unidades médicas y búsqueda por cercanía.

- ``catalogo``: carga ``data/unidades.json`` + ``data/geocodes.json`` y expone
  búsqueda por texto, por código postal y por coordenadas.
- ``horario``: interpreta los horarios y dice si una unidad está abierta ahora.
"""

from .catalogo import (
    Battelle,
    Catalogo,
    Lugar,
    Referencia,
    Resolucion,
    Unidad,
    get_catalogo,
    normalizar,
    reset_catalogo,
)
from .horario import abierta_ahora, ahora_local, resumen_horario

__all__ = [
    "Battelle",
    "Catalogo",
    "Lugar",
    "Referencia",
    "Resolucion",
    "Unidad",
    "abierta_ahora",
    "ahora_local",
    "get_catalogo",
    "normalizar",
    "reset_catalogo",
    "resumen_horario",
]
