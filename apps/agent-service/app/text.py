"""Utilidades de texto en español: normalización, tokens, similitud.

Sin dependencias externas: el matching debe ser determinista y auditable
(SPEC-AIA "Matching y decisión").
"""

from __future__ import annotations

import re
import unicodedata
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any


def format_quantity(value: Any) -> str:
    """commerce-api exige cantidad como string 'NN.NNN' (3 decimales,
    quote.dto.ts QUANTITY_RE). El modelo/carrito manejan '1' o '2.5'; esto
    normaliza al formato exacto que la API valida, en el único punto donde
    las líneas cruzan la frontera hacia commerce-api."""
    try:
        q = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError(f"Cantidad inválida: {value!r}")
    return str(q.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))

# Palabras vacías es-MX + muletillas de WhatsApp.
STOPWORDS: frozenset[str] = frozenset(
    """
    a al algo alguna algunas alguno algunos ante antes aqui aquel aquella como con contra cual
    cuando de del desde donde dos e el ella ellas ello ellos en entre era eran es esa esas ese
    eso esos esta estan estas este esto estos ha hace hacen hasta hay la las le les lo los mas me
    mi mis mucho muy nada ni no nos nosotros o os otra otras otro otros para pero poco por porque
    que quien se ser si sin sobre solo son su sus tambien tanto te tener tiene tienen todo todos
    tu tus un una uno unos usted ustedes va van vos y ya
    hola buenas buenos dias tardes noches oye porfa porfavor favor gracias ok okay bueno pues
    quiero quisiera necesito busco buscar dame mandame pasame ver tienes tienen hay manejan
    """.split()
)

# Sinónimos comerciales frecuentes: consulta -> término de catálogo.
SYNONYMS: dict[str, tuple[str, ...]] = {
    "chelas": ("cerveza",),
    "chela": ("cerveza",),
    "refresco": ("soda", "bebida"),
    "soda": ("refresco", "bebida"),
    "compu": ("computadora", "laptop"),
    "lap": ("laptop", "computadora"),
    "celular": ("telefono", "smartphone"),
    "cel": ("telefono", "smartphone"),
    "playera": ("camiseta", "polo"),
    "tenis": ("zapatilla", "calzado"),
    "bolsa": ("bolso", "mochila"),
    "caja": ("paquete",),
    "pieza": ("unidad", "pza"),
    "kilo": ("kg", "kilogramo"),
    "litro": ("lt", "l"),
    "grano": ("granos",),
    "molido": ("molienda",),
}

UNIT_ALIASES: dict[str, str] = {
    "pza": "PZA", "pz": "PZA", "pieza": "PZA", "piezas": "PZA", "unidad": "PZA",
    "unidades": "PZA", "u": "PZA",
    "caja": "CAJA", "cajas": "CAJA", "cj": "CAJA",
    "kg": "KGM", "kilo": "KGM", "kilos": "KGM", "kilogramo": "KGM", "kilogramos": "KGM",
    "g": "GRM", "gr": "GRM", "gramo": "GRM", "gramos": "GRM",
    "l": "LTR", "lt": "LTR", "litro": "LTR", "litros": "LTR",
    "ml": "MLT", "mililitro": "MLT", "mililitros": "MLT",
    "m": "MTR", "metro": "MTR", "metros": "MTR",
    "paquete": "PAQ", "paquetes": "PAQ", "pack": "PAQ",
    "docena": "DOCENA", "docenas": "DOCENA",
}

NUMBER_WORDS: dict[str, int] = {
    "un": 1, "una": 1, "uno": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
    "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10, "once": 11,
    "doce": 12, "quince": 15, "veinte": 20, "veinticinco": 25, "treinta": 30,
    "cincuenta": 50, "cien": 100, "ciento": 100, "doscientos": 200, "mil": 1000,
    "media": 0.5, "medio": 0.5, "par": 2, "docena": 12,
}


def strip_accents(value: str) -> str:
    """Quita diacríticos: 'café' -> 'cafe'."""
    nfkd = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in nfkd if not unicodedata.combining(ch))


def normalize(value: str | None) -> str:
    """Minúsculas, sin acentos, sin puntuación redundante, espacios colapsados."""
    if not value:
        return ""
    lowered = strip_accents(value).lower()
    cleaned = re.sub(r"[^\w\s\-/.]+", " ", lowered, flags=re.UNICODE)
    return re.sub(r"\s+", " ", cleaned).strip()


def tokenize(value: str | None, *, keep_stopwords: bool = False) -> list[str]:
    tokens = [t for t in normalize(value).split() if t]
    if keep_stopwords:
        return tokens
    return [t for t in tokens if t not in STOPWORDS and len(t) > 1]


def stem(token: str) -> str:
    """Stemming mínimo es-MX: normaliza plurales frecuentes.

    'gorras' -> 'gorra', 'concentrados' -> 'concentrado', 'botellas' -> 'botella'.
    No pretende ser lingüísticamente completo: solo evita que un plural
    impida un match obvio de catálogo.
    """
    if len(token) <= 3:
        return token
    if token.endswith("ces"):
        return token[:-3] + "z"
    if token.endswith("es") and len(token) > 4 and token[-3] not in "aeiou":
        return token[:-2]
    if token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def expand_synonyms(tokens: list[str]) -> set[str]:
    expanded: set[str] = set()
    for token in tokens:
        expanded.add(token)
        expanded.add(stem(token))
        for synonym in SYNONYMS.get(token, ()):
            expanded.add(synonym)
            expanded.add(stem(synonym))
    return expanded


def trigrams(value: str) -> set[str]:
    padded = f"  {normalize(value)} "
    return {padded[i : i + 3] for i in range(max(0, len(padded) - 2))}


def trigram_similarity(a: str, b: str) -> float:
    """Similitud tipo pg_trgm, en [0,1]."""
    ta, tb = trigrams(a), trigrams(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def parse_quantity(text: str) -> tuple[str | None, str | None, str | None]:
    """Extrae (cantidad, unidad SAT-like, textoCrudo) de una frase.

    Devuelve cantidad como string para no perder precisión decimal
    (SPEC-AIA: "Cantidades son strings").
    """
    norm = normalize(text)
    if not norm:
        return None, None, None

    unit_pattern = "|".join(sorted(UNIT_ALIASES, key=len, reverse=True))
    numeric = re.search(rf"(\d+(?:[.,]\d+)?)\s*({unit_pattern})?\b", norm)
    if numeric:
        raw_qty = numeric.group(1).replace(",", ".")
        unit_word = numeric.group(2)
        return raw_qty, UNIT_ALIASES.get(unit_word or "", None), numeric.group(0).strip()

    words = norm.split()
    for index, word in enumerate(words):
        if word in NUMBER_WORDS:
            unit_word = words[index + 1] if index + 1 < len(words) else None
            unit = UNIT_ALIASES.get(unit_word or "", None)
            value = NUMBER_WORDS[word]
            qty = str(value) if isinstance(value, int) else f"{value}"
            return qty, unit, " ".join(words[index : index + 2])
    return None, None, None


def looks_like_sku(text: str) -> str | None:
    """Detecta un SKU escrito por el cliente (SKU-001, JAZ-ORIG-X12, ABC1234)."""
    for token in re.findall(r"\b[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+\b", text or ""):
        if any(ch.isdigit() for ch in token) and any(ch.isalpha() for ch in token):
            return token.strip()
    for token in re.findall(r"\b[A-Za-z]{2,}\d{2,}[A-Za-z0-9]*\b", text or ""):
        return token.strip()
    return None


_UUID_RE = re.compile(r"\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)


def format_for_whatsapp(reply: str) -> str:
    """Markdown de chat web -> texto plano de WhatsApp.

    El modelo tiende a escribir **negrita**, encabezados y viñetas aunque se
    le pida lo contrario; en WhatsApp eso se ve como asteriscos sueltos. Se
    normaliza de forma determinista en vez de confiar en el prompt.
    """
    text = reply
    # [texto](url) -> "texto: url": WhatsApp no renderiza enlaces markdown y el
    # cliente vería los corchetes en vez de un link tocable.
    text = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", r"\1: \2", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"*\1*", text)          # **x** -> *x*
    text = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", text)         # encabezados
    text = re.sub(r"(?m)^\s*[-*•]\s+", "• ", text)            # viñetas -> •
    text = re.sub(r"(?m)^\s*(\d+)[.)]\s+", r"\1. ", text)     # listas numeradas
    text = re.sub(r"`([^`]+)`", r"\1", text)                  # código inline
    text = _UUID_RE.sub(lambda m: m.group(1), text)           # folios cortos
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def truncate(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 1].rstrip() + "…"
