"""``GET /unidades``: catálogo público de unidades para clientes de UI (tarjetas, mapas).

Solo campos aptos para mostrar al usuario: nunca el personal que aplica Battelle.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from ..unidades import Unidad, get_catalogo

router = APIRouter(tags=["unidades"])


def _minutos_a_texto(minutos: int) -> str:
    return f"{minutos // 60 % 24:02d}:{minutos % 60:02d}"


def unidad_publica(u: Unidad) -> dict[str, Any]:
    return {
        "id": u.id,
        "nombre": u.nombre,
        "region": u.region,
        "municipio": u.municipio,
        "domicilio": u.domicilio,
        "codigoPostal": u.codigo_postal,
        "horarioTexto": u.horario_texto,
        "horario": [
            {"dias": list(v.dias), "abre": _minutos_a_texto(v.abre), "cierra": "24:00" if v.cierra == 1440 else _minutos_a_texto(v.cierra)}
            for v in u.horario
        ],
        "servicios": u.servicios,
        "battelle": u.battelle is not None,
        "lat": u.lat,
        "lon": u.lon,
        "precision": u.precision,
        "notas": u.notas,
    }


@router.get("/unidades")
async def listar_unidades() -> dict[str, Any]:
    catalogo = get_catalogo()
    return {"total": len(catalogo.unidades), "unidades": [unidad_publica(u) for u in catalogo.unidades]}


@router.get("/unidades/{unidad_id}")
async def obtener_unidad(unidad_id: str) -> dict[str, Any]:
    unidad = get_catalogo().obtener(unidad_id)
    if unidad is None:
        raise HTTPException(status_code=404, detail="Unidad no encontrada")
    return unidad_publica(unidad)
