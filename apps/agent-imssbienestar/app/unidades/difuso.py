"""Coincidencia difusa para nombres de lugares y servicios.

El usuario escribe con typos ("navolatto", "los mochs") o su nota de voz se
transcribe con errores fonéticos ("Abolato", "Batel"). Se compara sobre una
clave fonética del español (b/v, c/s/z, ll/y, h muda, qu/k...) con distancia de
Damerau-Levenshtein, y se exige un margen según la longitud de la palabra para
no "corregir" palabras que en realidad son otra cosa.
"""

from __future__ import annotations

import re
import unicodedata


def _sin_acentos(texto: str) -> str:
    base = unicodedata.normalize("NFKD", texto or "")
    return "".join(c for c in base if not unicodedata.combining(c)).lower()


def normalizar(texto: str) -> str:
    """Minúsculas, sin acentos ni puntuación, espacios colapsados."""
    return " ".join(re.sub(r"[^a-z0-9ñ]+", " ", _sin_acentos(texto).replace("ñ", "ñ")).split())


_REGLAS_FONETICAS: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(p), r)
    for p, r in (
        (r"ph", "f"),
        (r"ll", "y"),
        (r"qu", "k"),
        (r"gu(?=[ei])", "g"),
        (r"g(?=[ei])", "j"),
        (r"c(?=[ei])", "s"),
        (r"z", "s"),
        (r"c", "k"),
        (r"q", "k"),
        (r"v", "b"),
        (r"w", "b"),
        (r"h", ""),
        (r"x", "s"),
        (r"y$", "i"),
        (r"(.)\1+", r"\1"),  # letras repetidas: "navolatto" -> "navolato"
    )
)


def clave_fonetica(palabra: str) -> str:
    """Forma fonética aproximada de una palabra en español ("Navolato" ~ "Nabolato")."""
    clave = normalizar(palabra).replace(" ", "")
    for patron, reemplazo in _REGLAS_FONETICAS:
        clave = patron.sub(reemplazo, clave)
    return clave


def distancia(a: str, b: str) -> int:
    """Damerau-Levenshtein (con transposiciones adyacentes)."""
    if a == b:
        return 0
    if not a or not b:
        return max(len(a), len(b))
    filas = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        filas[i][0] = i
    for j in range(len(b) + 1):
        filas[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            costo = 0 if a[i - 1] == b[j - 1] else 1
            filas[i][j] = min(filas[i - 1][j] + 1, filas[i][j - 1] + 1, filas[i - 1][j - 1] + costo)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                filas[i][j] = min(filas[i][j], filas[i - 2][j - 2] + 1)
    return filas[-1][-1]


def margen(largo: int) -> int:
    """Errores tolerados según el largo de la palabra (las cortas casi no toleran)."""
    if largo <= 3:
        return 0
    if largo <= 6:
        return 1
    if largo <= 10:
        return 2
    return 3


def similares(palabra: str, vocabulario: dict[str, str]) -> list[tuple[str, int]]:
    """Términos del vocabulario parecidos a ``palabra``, del más al menos cercano.

    ``vocabulario`` mapea clave normalizada -> término canónico a mostrar.
    """
    clave = clave_fonetica(palabra)
    if len(clave) < 3:
        return []
    encontrados: dict[str, int] = {}
    for normal, canonico in vocabulario.items():
        candidato = clave_fonetica(normal)
        tope = min(margen(len(clave)), margen(len(candidato)))
        d = distancia(clave, candidato)
        if d <= tope:
            # Un prefijo largo también cuenta ("topolobamp" -> "topolobampo"): ya cae en el margen.
            if canonico not in encontrados or d < encontrados[canonico]:
                encontrados[canonico] = d
    return sorted(encontrados.items(), key=lambda t: (t[1], t[0]))


def mejor(palabra: str, vocabulario: dict[str, str]) -> tuple[str, int] | None:
    """El término más parecido, o ``None`` si no hay ninguno dentro del margen o hay empate ambiguo."""
    candidatos = similares(palabra, vocabulario)
    if not candidatos:
        return None
    if len(candidatos) > 1 and candidatos[0][1] == candidatos[1][1]:
        # Empate exacto entre dos términos distintos: no se adivina.
        return None
    return candidatos[0]
