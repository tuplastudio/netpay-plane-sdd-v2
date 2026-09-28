"""Catálogo de unidades médicas: carga, búsqueda por texto, CP y coordenadas.

Los datos viven en ``data/`` (``UNIDADES_DATA_DIR`` para moverlos):

- ``unidades.json``: el catálogo oficial capturado (una fila por unidad).
- ``geocodes.json``: coordenadas por ``id`` generadas por
  ``scripts/geocode_unidades.py``. Son de la LOCALIDAD, no del domicilio, así
  que toda distancia que se le dé al usuario es aproximada y en línea recta.

Reglas de honestidad de los datos:

- Una unidad sin coordenadas nunca entra en un ranking por distancia (no se
  inventa una posición), pero sí aparece en búsquedas por texto.
- Un código postal que no está en el catálogo se resuelve al CP más cercano
  NUMÉRICAMENTE dentro de la misma zona postal y se marca como aproximado.
"""

from __future__ import annotations

import json
import math
import os
import re
import unicodedata
from dataclasses import dataclass, field, replace
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

from . import difuso
from .horario import Ventana, abierta_ahora

SERVICIOS = ("edi", "estimulacion_temprana", "battelle")
_ALIAS_SERVICIO = {
    "edi": "edi",
    "evaluacion del desarrollo infantil": "edi",
    "estimulacion": "estimulacion_temprana",
    "estimulacion temprana": "estimulacion_temprana",
    "estimulacion_temprana": "estimulacion_temprana",
    "battelle": "battelle",
    "prueba battelle": "battelle",
}
# Rango de códigos postales de Sinaloa (el catálogo incluye 83139, de Mazatlán).
_CP_MIN, _CP_MAX = 80000, 83999
# Un CP fuera del catálogo solo se aproxima si hay uno a esta distancia numérica.
_CP_TOLERANCIA = 400
_CP_RE = re.compile(r"^\d{5}$")

_R_TIERRA_KM = 6371.0088
# Incertidumbre de posición por precisión del geocódigo, en km (solo para ordenar).
_INCERTIDUMBRE_KM = {"municipio": 8.0}


def normalizar(texto: str) -> str:
    """Minúsculas, sin acentos ni puntuación: para comparar nombres."""
    return difuso.normalizar(texto)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dlmb = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * _R_TIERRA_KM * math.asin(math.sqrt(a))


# Términos (ya normalizados) que apuntan a un servicio. Incluye cómo suele transcribirse
# "Battelle" (nombre inglés) por voz: "batel", "bateli", "bateri"...
_TERMINOS_SERVICIO = {
    "battelle": "battelle", "batel": "battelle", "batele": "battelle", "bateli": "battelle",
    "bateri": "battelle", "batelle": "battelle", "battel": "battelle", "baterie": "battelle",
    "estimulacion": "estimulacion_temprana", "temprana": "estimulacion_temprana",
    "edi": "edi", "evaluacion": "edi",
}


def servicio_canonico(valor: str) -> str:
    """``"prueba Battelle"``/``"batel"``/``"estimulasion"`` -> servicio canónico; ``""`` si no se pidió ninguno.

    Tolera typos y errores de transcripción. Lanza ``ValueError`` con el catálogo de
    servicios válidos si no se reconoce.
    """
    clave = normalizar(valor).replace("_", " ")
    if not clave:
        return ""
    if clave in _ALIAS_SERVICIO:
        return _ALIAS_SERVICIO[clave]
    for token in clave.split():
        if token in _TERMINOS_SERVICIO:
            return _TERMINOS_SERVICIO[token]
        encontrado = difuso.mejor(token, _TERMINOS_SERVICIO)
        if encontrado:
            return encontrado[0]
    raise ValueError(f"Servicio desconocido: usa uno de {', '.join(SERVICIOS)}.")


@dataclass(frozen=True)
class Battelle:
    """La unidad aplica la prueba Battelle. ``responsable`` NO se muestra al usuario."""

    jurisdiccion: str
    equipos: str
    responsable: str = ""
    nombre_fuente: str = ""
    domicilio: str | None = None
    codigo_postal: str | None = None
    horario_texto: str | None = None
    horario: tuple[Ventana, ...] = ()


@dataclass(frozen=True)
class Unidad:
    id: str
    region: str
    municipio: str | None
    nombre: str
    domicilio: str | None
    codigo_postal: str | None
    horario_texto: str | None
    horario: tuple[Ventana, ...]
    realiza_edi: bool
    estimulacion_temprana: bool
    lat: float | None = None
    lon: float | None = None
    precision: str = ""
    notas: str = ""
    battelle: Battelle | None = None
    localidad: str = ""
    tipo: str = ""
    aliases: tuple[str, ...] = ()
    _texto: str = field(default="", repr=False, compare=False)

    @property
    def tiene_coordenadas(self) -> bool:
        return self.lat is not None and self.lon is not None

    def ofrece(self, servicio: str) -> bool:
        if servicio == "edi":
            return self.realiza_edi
        if servicio == "estimulacion_temprana":
            return self.estimulacion_temprana
        if servicio == "battelle":
            return self.battelle is not None
        return True

    @property
    def servicios(self) -> list[str]:
        nombres = {"edi": "EDI", "estimulacion_temprana": "Estimulación temprana", "battelle": "Prueba Battelle"}
        return [nombres[s] for s in SERVICIOS if self.ofrece(s)]

    def abierta(self, ahora: datetime | None = None) -> bool | None:
        return abierta_ahora(self.horario, ahora)


@dataclass(frozen=True)
class Referencia:
    """Punto desde el que se mide: ubicación del usuario o CP resuelto."""

    lat: float
    lon: float
    origen: str  # "ubicacion" | "cp_exacto" | "cp_aproximado"
    detalle: str = ""


@dataclass(frozen=True)
class Lugar:
    """Un municipio o localidad con coordenadas (``data/lugares.json`` + localidades de unidades)."""

    nombre: str
    municipio: str
    lat: float
    lon: float
    aliases: tuple[str, ...] = ()
    precision: str = "localidad"
    sede: bool = False  # cabecera del municipio que nombra


@dataclass(frozen=True)
class Resolucion:
    """Resultado de interpretar un lugar escrito por el usuario."""

    lugar: Lugar
    corregido_de: str = ""  # texto original si hubo que corregirlo (typo/fonética)
    ambiguos: tuple[str, ...] = ()


def _cargar_unidad(raw: dict[str, Any], geo: dict[str, Any] | None) -> Unidad:
    bat = raw.get("battelle")
    battelle = (
        Battelle(
            jurisdiccion=bat["jurisdiccion"],
            equipos=bat["equipos"],
            responsable=bat.get("responsable", ""),
            nombre_fuente=bat.get("nombre_fuente", ""),
            domicilio=bat.get("domicilio"),
            codigo_postal=bat.get("cp"),
            horario_texto=bat.get("horario_texto"),
            horario=tuple(Ventana.desde_dict(v) for v in bat.get("horario", [])),
        )
        if bat
        else None
    )
    texto = normalizar(
        " ".join(
            filter(
                None,
                [raw["nombre"], raw.get("municipio"), raw.get("domicilio"), raw["region"], raw.get("geo_query"),
                 raw.get("localidad"), *raw.get("aliases", [])],
            )
        )
    )
    return Unidad(
        id=raw["id"],
        region=raw["region"],
        municipio=raw.get("municipio"),
        nombre=raw["nombre"],
        domicilio=raw.get("domicilio"),
        codigo_postal=raw.get("codigo_postal"),
        horario_texto=raw.get("horario_texto"),
        horario=tuple(Ventana.desde_dict(v) for v in raw.get("horario", [])),
        realiza_edi=bool(raw.get("realiza_edi", True)),
        estimulacion_temprana=bool(raw.get("estimulacion_temprana")),
        lat=geo["lat"] if geo else None,
        lon=geo["lon"] if geo else None,
        precision=geo["precision"] if geo else "",
        notas=raw.get("notas", ""),
        battelle=battelle,
        localidad=raw.get("localidad", ""),
        tipo=raw.get("tipo", ""),
        aliases=tuple(raw.get("aliases", [])),
        _texto=texto,
    )


# Palabras genéricas de los nombres de unidades: nunca se "corrigen" hacia ellas.
_GENERICAS = {
    "uspn", "centro", "salud", "urbano", "rural", "col", "colonia", "calle", "del", "las", "los", "sin",
    "numero", "avenida", "carretera", "domicilio", "conocido", "esq", "esquina", "unidad", "principal",
    "frente", "costado", "primaria", "junto", "sinaloa", "region", "norte", "sur", "poste", "canal",
}


class Catalogo:
    def __init__(self, unidades: Iterable[Unidad], lugares: Iterable[Lugar] = ()) -> None:
        self.unidades: tuple[Unidad, ...] = tuple(unidades)
        self._lugares = self._armar_lugares(lugares)
        self._vocab_busqueda = self._armar_vocabulario()
        self._por_id = {u.id: u for u in self.unidades}
        self._por_cp: dict[str, list[Unidad]] = {}
        for u in self.unidades:
            if u.codigo_postal and _CP_RE.match(u.codigo_postal):
                self._por_cp.setdefault(u.codigo_postal, []).append(u)

    @classmethod
    def desde_directorio(cls, directorio: Path) -> "Catalogo":
        crudo = json.loads((directorio / "unidades.json").read_text(encoding="utf-8"))
        geo_path = directorio / "geocodes.json"
        geo = json.loads(geo_path.read_text(encoding="utf-8")) if geo_path.exists() else {}
        lugares_path = directorio / "lugares.json"
        lugares = (
            [
                Lugar(l["nombre"], l["municipio"], l["lat"], l["lon"], tuple(l.get("aliases", [])), l.get("tipo") or "localidad")
                for l in json.loads(lugares_path.read_text(encoding="utf-8"))
            ]
            if lugares_path.exists()
            else []
        )
        return cls([_cargar_unidad(r, geo.get(r["id"])) for r in crudo], lugares)

    def obtener(self, unidad_id: str) -> Unidad | None:
        return self._por_id.get((unidad_id or "").strip().upper())

    # ------------------------------------------------------------ referencia

    def referencia_por_cp(self, codigo_postal: str) -> Referencia | None:
        """Punto de referencia para un CP. ``None`` si no se puede ubicar.

        Lanza ``ValueError`` si el CP no tiene 5 dígitos o cae fuera de Sinaloa.
        """
        cp = (codigo_postal or "").strip()
        if not _CP_RE.match(cp):
            raise ValueError("El código postal debe tener 5 dígitos.")
        numero = int(cp)
        if not _CP_MIN <= numero <= _CP_MAX:
            raise ValueError("Ese código postal no es de Sinaloa; el catálogo solo cubre Sinaloa.")

        exactas = [u for u in self._por_cp.get(cp, []) if u.tiene_coordenadas]
        if exactas:
            return Referencia(
                lat=sum(u.lat for u in exactas) / len(exactas),  # type: ignore[misc]
                lon=sum(u.lon for u in exactas) / len(exactas),  # type: ignore[misc]
                origen="cp_exacto",
                detalle=f"CP {cp} ({exactas[0].municipio or exactas[0].nombre.title()})",
            )
        candidatos = [
            (abs(int(c) - numero), c, u)
            for c, unidades in self._por_cp.items()
            for u in unidades
            if u.tiene_coordenadas
        ]
        if not candidatos:
            return None
        distancia, cercano, unidad = min(candidatos, key=lambda t: (t[0], t[1]))
        if distancia > _CP_TOLERANCIA:
            return None
        return Referencia(
            lat=unidad.lat,  # type: ignore[arg-type]
            lon=unidad.lon,  # type: ignore[arg-type]
            origen="cp_aproximado",
            detalle=f"CP {cp} no está en el catálogo; se usó el CP {cercano} ({unidad.municipio or unidad.nombre.title()}) como zona aproximada",
        )

    # --------------------------------------------------------------- cercanía

    def cercanas(
        self,
        ref: Referencia,
        *,
        servicio: str = "",
        limite: int = 3,
        pista: str = "",
    ) -> list[tuple[Unidad, float]]:
        pares = [
            (u, haversine_km(ref.lat, ref.lon, u.lat, u.lon))  # type: ignore[arg-type]
            for u in self.unidades
            if u.tiene_coordenadas and u.ofrece(servicio)
        ]
        # Una unidad ubicada solo por su cabecera municipal cae justo en el
        # centro de la ciudad y "empataría" con las que sí están ahí: se le
        # suma una incertidumbre SOLO para ordenar (la distancia mostrada es la real).
        # Con una referencia gruesa (el centro de una ciudad o un CP aproximado) varias unidades
        # quedan a "la misma" distancia: entre unidades a ~2 km gana la que más servicios ofrece,
        # que es la mejor recomendación cuando no hay más pista. Con ubicación exacta manda la distancia.
        grueso = ref.origen in {"lugar", "cp_aproximado"}
        premio = 0.8 if grueso else 0.05
        pares.sort(
            key=lambda p: p[1] + _INCERTIDUMBRE_KM.get(p[0].precision, 0.0) - premio * (len(p[0].servicios) - 1)
        )
        if pista:
            pares = self._priorizar_por_pista(pares, ref, pista)
        return pares[: max(1, limite)]

    def _priorizar_por_pista(
        self, pares: list[tuple[Unidad, float]], ref: Referencia, pista: str
    ) -> list[tuple[Unidad, float]]:
        """Dentro de una misma zona, sube las unidades cuyo domicilio/nombre menciona la pista.

        En una ciudad todas las unidades comparten el mismo punto (la ciudad): "cerca de la
        colonia Zarco" solo se distingue por el texto. Solo reordena entre unidades a menos
        de 15 km de la más cercana, nunca trae una lejana.
        """
        excluir = set(normalizar(ref.detalle).split())
        palabras = {
            w for w in normalizar(pista).split()
            if len(w) >= 4 and w not in _GENERICAS and w not in excluir
        }
        if not palabras or not pares:
            return pares
        tope = pares[0][1] + 15.0
        zona = [p for p in pares if p[1] <= tope]
        resto = [p for p in pares if p[1] > tope]

        def coincidencias(u: Unidad) -> int:
            return len(palabras & set(u._texto.split()))

        zona.sort(key=lambda p: -coincidencias(p[0]))  # estable: conserva el orden por distancia
        return zona + resto

    # ----------------------------------------------------------------- lugares

    def _armar_lugares(self, lugares: Iterable[Lugar]) -> tuple[Lugar, ...]:
        """Lugares de ``lugares.json`` + localidades de las unidades geocodificadas con precisión de localidad.

        Las unidades ubicadas solo por su cabecera ("municipio"/"ciudad") no aportan un lugar
        nuevo: su punto no es el de su localidad.
        """
        lugares = [
            replace(
                l,
                sede=normalizar(l.municipio) in {normalizar(l.nombre), *(normalizar(a) for a in l.aliases)},
            )
            for l in lugares
        ]
        vistos = {normalizar(l.nombre) for l in lugares}
        derivados: list[Lugar] = []
        for u in self.unidades:
            if not (u.localidad and u.tiene_coordenadas and u.precision == "localidad"):
                continue
            clave = normalizar(u.localidad)
            if clave in vistos:
                continue
            vistos.add(clave)
            # "USPN LA CONCEPCIÓN (LA CONCHA)": lo que va entre paréntesis es cómo le dice la gente.
            apodos = tuple(
                a.strip()
                for a in re.findall(r"\(([^)]+)\)", u.nombre)
                if not re.match(r"(?i)\s*(col\b|centro\b|pemex\b)", a)
            )
            derivados.append(
                Lugar(u.localidad, (u.municipio or "").title(), u.lat, u.lon, apodos, "localidad")  # type: ignore[arg-type]
            )
        return (*lugares, *derivados)

    def _armar_vocabulario(self) -> dict[str, str]:
        """Palabras de lugares y nombres de unidades contra las que se corrigen los typos."""
        vocab: dict[str, str] = {}
        fuentes: list[str] = []
        for u in self.unidades:
            fuentes += [u.nombre, u.municipio or "", u.localidad, *u.aliases]
        for l in self._lugares:
            fuentes += [l.nombre, l.municipio, *l.aliases]
        for texto in fuentes:
            for palabra in normalizar(texto).split():
                if len(palabra) >= 4 and palabra not in _GENERICAS:
                    vocab.setdefault(palabra, palabra)
        return vocab

    def resolver_lugar(self, texto: str) -> Resolucion | None:
        """Interpreta "Navolato", "en los mochs", "abolato" como un lugar conocido.

        ``None`` si no hay ninguno razonablemente parecido. Si dos lugares distintos empatan
        se devuelve el primero con ``ambiguos`` para que el agente pregunte.
        """
        consulta = normalizar(texto)
        if not consulta:
            return None
        # 1) Coincidencia exacta con el nombre (o alias) completo, la más larga primero.
        def buscar_exacto(nombres_de) -> list[tuple[int, Lugar]]:
            hallados: list[tuple[int, Lugar]] = []
            for l in self._lugares:
                for nombre in nombres_de(l):
                    clave = normalizar(nombre)
                    if clave and re.search(rf"(?<![a-z0-9]){re.escape(clave)}(?![a-z0-9])", consulta):
                        hallados.append((len(clave), l))
            return hallados

        candidatos = buscar_exacto(lambda l: (l.nombre, *l.aliases))
        if not candidatos:
            # "Navolato" también nombra a todo el municipio: se usa su cabecera.
            candidatos = [(n, l) for n, l in buscar_exacto(lambda l: (l.municipio,)) if l.sede]
        if candidatos:
            candidatos.sort(key=lambda t: (-t[0], not t[1].sede, t[1].nombre))
            mejor_largo, primero = candidatos[0]
            otros = sorted({l.nombre for n, l in candidatos if n == mejor_largo} - {primero.nombre})
            return Resolucion(primero, ambiguos=tuple(otros))

        # 2) Difuso por palabra y por par de palabras ("los mochs", "abolato").
        vocab: dict[str, str] = {}
        for l in self._lugares:
            for nombre in (l.nombre, *l.aliases):
                clave = normalizar(nombre)
                vocab[clave] = l.nombre
                for palabra in clave.split():
                    if len(palabra) >= 4 and palabra not in _GENERICAS:
                        vocab.setdefault(palabra, l.nombre)
        palabras = consulta.split()
        ventanas = [" ".join(palabras[i : i + n]) for n in (2, 1) for i in range(len(palabras) - n + 1)]
        mejores: list[tuple[int, str, str]] = []
        for ventana in ventanas:
            if len(ventana.replace(" ", "")) < 4:
                continue
            for canonico, d in difuso.similares(ventana, vocab):
                mejores.append((d, canonico, ventana))
        if not mejores:
            return None
        mejores.sort(key=lambda t: (t[0], -len(t[2]), t[1]))
        d, canonico, original = mejores[0]
        empatan = sorted({c for dd, c, o in mejores if dd == d and o == original and c != canonico})
        lugar = next(l for l in self._lugares if l.nombre == canonico)
        return Resolucion(lugar, corregido_de=original, ambiguos=tuple(empatan))

    def referencia_por_lugar(self, texto: str) -> tuple[Referencia, Resolucion] | None:
        resolucion = self.resolver_lugar(texto)
        if resolucion is None:
            return None
        l = resolucion.lugar
        return Referencia(lat=l.lat, lon=l.lon, origen="lugar", detalle=f"{l.nombre}" + (f", {l.municipio}" if l.municipio and normalizar(l.municipio) != normalizar(l.nombre) else "")), resolucion

    # ------------------------------------------------------------------ texto

    def buscar_difuso(
        self, consulta: str = "", *, servicio: str = "", limite: int = 5
    ) -> tuple[list[Unidad], list[tuple[str, str]]]:
        """Como ``buscar`` pero tolera typos; devuelve también ``[(escrito, interpretado)]``.

        Cada palabra que no aparece tal cual se mapea a la palabra conocida más parecida
        (municipio, localidad o nombre de unidad).
        """
        palabras = [p for p in normalizar(consulta).split() if len(p) > 1]
        correcciones: list[tuple[str, str]] = []
        efectivas: list[str] = []
        for palabra in palabras:
            if any(palabra in u._texto for u in self.unidades) or palabra in _GENERICAS:
                efectivas.append(palabra)
                continue
            encontrado = difuso.mejor(palabra, self._vocab_busqueda)
            if encontrado:
                efectivas.append(encontrado[0])
                correcciones.append((palabra, encontrado[0]))
            else:
                efectivas.append(palabra)
        encontradas: list[tuple[int, Unidad]] = []
        for u in self.unidades:
            if not u.ofrece(servicio):
                continue
            if efectivas and not all(p in u._texto for p in efectivas):
                continue
            nombre = normalizar(u.nombre)
            puntos = sum(2 if p in nombre else 1 for p in efectivas)
            encontradas.append((-puntos, u))
        encontradas.sort(key=lambda t: (t[0], t[1].id))
        return [u for _, u in encontradas[: max(1, limite)]], correcciones

    def buscar(self, consulta: str = "", *, servicio: str = "", limite: int = 5) -> list[Unidad]:
        """Unidades cuyo nombre/municipio/domicilio contiene TODAS las palabras (con tolerancia a typos).

        Sin ``consulta`` lista las que ofrecen el ``servicio`` (o todas).
        """
        return self.buscar_difuso(consulta, servicio=servicio, limite=limite)[0]


@lru_cache(maxsize=1)
def get_catalogo() -> Catalogo:
    directorio = Path(os.environ.get("UNIDADES_DATA_DIR") or Path(__file__).resolve().parents[2] / "data")
    return Catalogo.desde_directorio(directorio)


def reset_catalogo() -> None:
    get_catalogo.cache_clear()
