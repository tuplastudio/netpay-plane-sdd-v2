"""Geocodifica ``data/unidades.json`` con Nominatim (OpenStreetMap) -> ``data/geocodes.json``.

Solo se corre al actualizar el catálogo; el agente NO llama a ningún geocodificador
en tiempo de ejecución. Respeta el límite de Nominatim (1 petición/segundo).
Las coordenadas son de la LOCALIDAD, no del domicilio exacto de la unidad:
``precision`` lo dice ("localidad" | "ciudad" | "municipio") y el agente
lo comunica al usuario como distancia aproximada.

    python scripts/geocode_unidades.py [--only U001,U002]
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import httpx

DATA = Path(__file__).resolve().parent.parent / "data"
UA = {"User-Agent": "agent-imssbienestar-build/0.1 (cgalaviz@tupla.dev)"}
# Caja aproximada de Sinaloa: descarta resultados en otro estado/país.
LAT = (22.3, 27.1)
LON = (-109.6, -105.2)
PRECISION = {"hamlet": "localidad", "village": "localidad", "town": "localidad", "suburb": "localidad",
             "neighbourhood": "localidad", "quarter": "localidad", "city": "ciudad", "locality": "localidad",
             "municipality": "municipio", "county": "municipio", "state_district": "municipio"}


def geocode(client: httpx.Client, query: str) -> dict | None:
    time.sleep(1.1)
    r = client.get("https://nominatim.openstreetmap.org/search",
                   params={"q": f"{query}, México", "format": "json", "limit": 5, "countrycodes": "mx"})
    r.raise_for_status()
    validos = []
    for hit in r.json():
        lat, lon = float(hit["lat"]), float(hit["lon"])
        if LAT[0] <= lat <= LAT[1] and LON[0] <= lon <= LON[1]:
            validos.append({"lat": round(lat, 5), "lon": round(lon, 5), "display": hit.get("display_name", ""),
                            "precision": PRECISION.get(hit.get("addresstype", ""), "localidad")})
    # Nominatim suele poner primero el polígono del municipio: se prefiere una localidad o ciudad.
    puntuales = [h for h in validos if h["precision"] != "municipio"]
    return (puntuales or validos or [None])[0]


def main() -> None:
    units = json.loads((DATA / "unidades.json").read_text(encoding="utf-8"))
    out_path = DATA / "geocodes.json"
    out = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {}
    only = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else None
    with httpx.Client(headers=UA, timeout=20) as client:
        for u in units:
            if only and u["id"] not in only:
                continue
            if u["id"] in out and not only:
                continue
            hit = geocode(client, u["geo_query"])
            if hit is None and u.get("municipio"):
                hit = geocode(client, f'{u["municipio"].title()}, Sinaloa')
                if hit:
                    hit["precision"] = "municipio"
            if hit:
                # ``geo_precision`` en unidades.json fuerza la etiqueta cuando se usó
                # una referencia más gruesa (p. ej. la cabecera municipal).
                hit["precision"] = u.get("geo_precision", hit["precision"])
                out[u["id"]] = hit
                print(u["id"], u["nombre"][:38].ljust(38), hit["precision"], hit["lat"], hit["lon"])
            else:
                print(u["id"], u["nombre"], "SIN RESULTADO")
            out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
