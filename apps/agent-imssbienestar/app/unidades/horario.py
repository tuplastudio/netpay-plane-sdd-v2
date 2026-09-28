"""Horarios de las unidades: ventanas por día de la semana (0 = lunes)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

# Sinaloa está en UTC-7 todo el año (sin horario de verano desde 2022).
ZONA = ZoneInfo("America/Mazatlan")
_NOMBRES = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")


@dataclass(frozen=True)
class Ventana:
    dias: tuple[int, ...]
    abre: int  # minutos desde medianoche
    cierra: int  # 1440 = medianoche del día siguiente (24 h)

    @classmethod
    def desde_dict(cls, raw: dict) -> "Ventana":
        return cls(
            dias=tuple(int(d) for d in raw["dias"]),
            abre=_minutos(raw["abre"]),
            cierra=_minutos(raw["cierra"]),
        )

    def cubre(self, dia: int, minuto: int) -> bool:
        return dia in self.dias and self.abre <= minuto < self.cierra


def _minutos(valor: str) -> int:
    horas, minutos = valor.split(":")
    return int(horas) * 60 + int(minutos)


def _hora(minutos: int) -> str:
    return f"{minutos // 60 % 24:02d}:{minutos % 60:02d}"


def ahora_local(ahora: datetime | None = None) -> datetime:
    """Hora actual en Sinaloa (o ``ahora`` convertida a esa zona)."""
    if ahora is None:
        return datetime.now(ZONA)
    if ahora.tzinfo is None:
        return ahora.replace(tzinfo=ZONA)
    return ahora.astimezone(ZONA)


def abierta_ahora(ventanas: tuple[Ventana, ...], ahora: datetime | None = None) -> bool | None:
    """``True``/``False``; ``None`` si la unidad no tiene horario capturado."""
    if not ventanas:
        return None
    local = ahora_local(ahora)
    minuto = local.hour * 60 + local.minute
    return any(v.cubre(local.weekday(), minuto) for v in ventanas)


def resumen_horario(ventanas: tuple[Ventana, ...]) -> str:
    """Horario normalizado en una línea, p. ej. ``lun-vie 08:00-20:00; sáb-dom 08:00-16:00``."""
    partes: list[str] = []
    for v in ventanas:
        dias = sorted(v.dias)
        corridos = dias == list(range(dias[0], dias[-1] + 1))
        if len(dias) == 7:
            etiqueta = "todos los días"
        elif len(dias) == 1:
            etiqueta = _NOMBRES[dias[0]][:3]
        elif corridos:
            etiqueta = f"{_NOMBRES[dias[0]][:3]}-{_NOMBRES[dias[-1]][:3]}"
        else:
            etiqueta = ",".join(_NOMBRES[d][:3] for d in dias)
        rango = "24 horas" if (v.abre == 0 and v.cierra == 1440) else f"{_hora(v.abre)}-{_hora(v.cierra)}"
        partes.append(f"{etiqueta} {rango}")
    return "; ".join(partes)
