"""Presentación de textos del catálogo: capturados en MAYÚSCULAS, se muestran legibles."""

from __future__ import annotations

import re

_MINUSCULAS = {"a", "al", "de", "del", "el", "la", "las", "los", "y", "e", "en", "con", "por", "para", "o"}
_SIGLAS = {"USPN", "CP", "S/N", "EDI", "CEREDI", "II", "III", "IV", "VI", "N°", "Nº", "SN"}
_PALABRA = re.compile(r"[^\s(),.\-/]+|[\s(),.\-/]+")


def titulo(texto: str | None) -> str:
    """``"USPN URBANO MOCHIS (CENTRO)"`` -> ``"USPN Urbano Mochis (Centro)"``."""
    if not texto:
        return ""
    salida: list[str] = []
    primera = True
    for parte in _PALABRA.findall(texto.strip()):
        if not any(c.isalnum() for c in parte):
            salida.append(parte)
            continue
        alta = parte.upper()
        if alta in _SIGLAS:
            salida.append(alta)
        elif parte.lower() in _MINUSCULAS and not primera:
            salida.append(parte.lower())
        else:
            salida.append(parte[:1].upper() + parte[1:].lower())
        primera = False
    return "".join(salida)


def frase(texto: str | None) -> str:
    """Horarios: ``"LUNES A VIERNES 8:00-20:00"`` -> ``"Lunes a viernes 8:00-20:00"``."""
    if not texto:
        return ""
    limpio = " ".join(texto.split()).lower()
    return limpio[:1].upper() + limpio[1:]
