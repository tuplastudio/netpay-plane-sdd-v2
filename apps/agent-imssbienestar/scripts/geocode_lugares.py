"""Genera ``data/lugares.json``: cabeceras municipales y localidades de Sinaloa con coordenadas.

Sirve para que "estoy en Mocorito" (municipio sin unidad en el catálogo) o "en Los Mochis"
se resuelva a un punto y el agente diga la unidad más cercana con su distancia.
Usa Nominatim (1 petición/s); solo se corre al actualizar la lista.

    python scripts/geocode_lugares.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geocode_unidades import LAT, LON, UA  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data"

# (nombre mostrado, municipio, alias, consulta de geocodificación)
LUGARES: list[tuple[str, str, list[str], str]] = [
    ("Los Mochis", "Ahome", ["ahome", "mochis"], "Los Mochis, Ahome, Sinaloa"),
    ("Angostura", "Angostura", [], "Angostura, Sinaloa"),
    ("Badiraguato", "Badiraguato", [], "Badiraguato, Sinaloa"),
    ("Concordia", "Concordia", [], "Concordia, Sinaloa"),
    ("Cosalá", "Cosalá", [], "Cosalá, Sinaloa"),
    ("Culiacán", "Culiacán", ["culiacan rosales", "culiacan de rosales"], "Culiacán Rosales, Sinaloa"),
    ("Choix", "Choix", [], "Choix, Sinaloa"),
    ("La Cruz de Elota", "Elota", ["elota", "la cruz"], "La Cruz de Elota, Sinaloa"),
    ("Escuinapa", "Escuinapa", ["escuinapa de hidalgo"], "Escuinapa de Hidalgo, Sinaloa"),
    ("El Fuerte", "El Fuerte", ["fuerte"], "El Fuerte, Sinaloa"),
    ("Guasave", "Guasave", [], "Guasave, Sinaloa"),
    ("Mazatlán", "Mazatlán", [], "Mazatlán, Sinaloa"),
    ("Mocorito", "Mocorito", [], "Mocorito, Sinaloa"),
    ("Navolato", "Navolato", [], "Navolato, Sinaloa"),
    ("El Rosario", "Rosario", ["rosario"], "El Rosario, Rosario, Sinaloa"),
    ("Guamúchil", "Salvador Alvarado", ["salvador alvarado"], "Guamúchil, Salvador Alvarado, Sinaloa"),
    ("San Ignacio", "San Ignacio", [], "San Ignacio, Sinaloa"),
    ("Sinaloa de Leyva", "Sinaloa", ["sinaloa municipio", "leyva"], "Sinaloa de Leyva, Sinaloa"),
    ("Eldorado", "Eldorado", ["el dorado"], "Eldorado, Culiacán, Sinaloa"),
    ("Juan José Ríos", "Guasave", ["juan jose rios", "j j rios"], "Juan José Ríos, Guasave, Sinaloa"),
    ("Topolobampo", "Ahome", [], "Topolobampo, Ahome, Sinaloa"),
    ("Villa Unión", "Mazatlán", ["villa union"], "Villa Unión, Mazatlán, Sinaloa"),
    ("Higuera de Zaragoza", "Ahome", ["higuera"], "Higuera de Zaragoza, Ahome, Sinaloa"),
    ("San Blas", "El Fuerte", [], "San Blas, El Fuerte, Sinaloa"),
    ("Costa Rica", "Culiacán", [], "Costa Rica, Culiacán, Sinaloa"),
    ("Ruiz Cortines", "Guasave", [], "Ruiz Cortines, Guasave, Sinaloa"),
    ("Las Tapias", "Culiacán", [], "Las Tapias, Culiacán, Sinaloa"),
]


def main() -> None:
    salida = []
    with httpx.Client(headers=UA, timeout=20) as client:
        for nombre, municipio, alias, consulta in LUGARES:
            time.sleep(1.1)
            r = client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": f"{consulta}, México", "format": "json", "limit": 5, "countrycodes": "mx"},
            )
            r.raise_for_status()
            hits = [
                h for h in r.json()
                if LAT[0] <= float(h["lat"]) <= LAT[1] and LON[0] <= float(h["lon"]) <= LON[1]
            ]
            # El polígono del municipio suele ir primero: se prefiere la localidad.
            hits.sort(key=lambda h: h.get("addresstype") in ("county", "municipality", "state_district"))
            if not hits:
                print("SIN RESULTADO", nombre)
                continue
            h = hits[0]
            salida.append(
                {"nombre": nombre, "municipio": municipio, "aliases": alias,
                 "lat": round(float(h["lat"]), 5), "lon": round(float(h["lon"]), 5), "tipo": h.get("addresstype", "")}
            )
            print(nombre.ljust(22), h.get("addresstype"), h["lat"][:8], h["lon"][:9])
    (DATA / "lugares.json").write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
