"""Herramientas del agente de unidades médicas (LangChain tools).

Reglas que se mantienen del agente base y no se negocian:
  - El tenant y los scopes vienen del contexto de la invocación, nunca del
    texto del usuario ni del modelo.
  - El modelo no inventa datos: domicilios, horarios y servicios salen SOLO
    del catálogo (``data/unidades.json``) a través de estas tools.
  - Las distancias son aproximadas y en línea recta (las coordenadas son de la
    localidad, no del domicilio); el texto que devuelven las tools lo dice.

Las tools de consulta son públicas (información del catálogo): no piden scope.
``escalar_a_humano`` sí, como en el agente base.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from langchain.tools import ToolRuntime, tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command

from .security import clamp_text, require_scope
from .state import TurnContext
from .unidades import (
    Catalogo,
    Referencia,
    Unidad,
    abierta_ahora,
    ahora_local,
    get_catalogo,
    resumen_horario,
)
from .unidades.catalogo import normalizar, servicio_canonico
from .unidades.formato import frase, titulo

# Sinaloa con margen: una ubicación fuera de aquí no es de la zona de cobertura.
_LAT = (22.0, 27.5)
_LON = (-110.0, -105.0)
# Si la unidad más cercana está más lejos que esto, se avisa en vez de recomendarla sin más.
_MAX_KM_RECOMENDABLE = 120.0
_LIMITE_MAX = 8

_NO_HANDOFF_REASONS = {"ERROR_TECNICO"}


def _ctx(runtime: ToolRuntime) -> TurnContext:
    return dict(runtime.context or {})  # type: ignore[arg-type,return-value]


def _fail(message: str) -> str:
    return f"ERROR: {message}"


def _tool_reply(runtime: ToolRuntime, text: str, *, update: dict[str, Any] | None = None) -> Command:
    """Respuesta de herramienta + actualización de estado en un solo Command."""
    payload: dict[str, Any] = {"messages": [ToolMessage(content=text, tool_call_id=runtime.tool_call_id)]}
    if update:
        payload.update(update)
    return Command(update=payload)


# ------------------------------------------------------------------ formato


def _estado(unidad: Unidad, ahora: datetime) -> str:
    abierta = abierta_ahora(unidad.horario, ahora)
    if abierta is None:
        return "horario no disponible"
    return "abierta ahora" if abierta else "cerrada ahora"


def _linea_unidad(unidad: Unidad, ahora: datetime, *, km: float | None = None, indice: int | None = None) -> str:
    prefijo = f"{indice}. " if indice is not None else "- "
    partes = [f"{prefijo}{titulo(unidad.nombre)} [{unidad.id}]"]
    if unidad.municipio:
        partes.append(f"municipio: {titulo(unidad.municipio)}")
    if km is not None:
        partes.append(f"a ~{km:.0f} km en línea recta" if km >= 1 else "a menos de 1 km en línea recta")
    partes.append(f"domicilio: {titulo(unidad.domicilio)}" if unidad.domicilio else "domicilio: no disponible en el catálogo")
    if unidad.codigo_postal:
        partes.append(f"CP {unidad.codigo_postal}")
    if unidad.horario_texto:
        partes.append(f"horario: {frase(unidad.horario_texto)} ({_estado(unidad, ahora)})")
    else:
        partes.append("horario: no disponible en el catálogo")
    partes.append("servicios: " + ", ".join(unidad.servicios))
    if km is not None and unidad.precision == "municipio":
        partes.append("posición del punto aproximada (cabecera municipal): la distancia puede variar bastante")
    if unidad.notas:
        partes.append(f"nota de datos: {unidad.notas}")
    return " | ".join(partes)


def _cabecera_tiempo(ahora: datetime) -> str:
    dias = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
    return f"Hora en Sinaloa: {dias[ahora.weekday()]} {ahora:%H:%M}."


def _servicio(valor: str) -> tuple[str, str | None]:
    try:
        return servicio_canonico(valor), None
    except ValueError as exc:
        return "", str(exc)


def _limite(valor: int, por_defecto: int) -> int:
    try:
        return max(1, min(int(valor), _LIMITE_MAX))
    except (TypeError, ValueError):
        return por_defecto


def _nota_correccion(original: str, canonico: str) -> str:
    """Aviso al modelo cuando se interpretó un typo/error de voz (no cuando solo faltó un artículo)."""
    if not original or normalizar(original) in normalizar(canonico):
        return ""
    return (
        f"Interpreté '{original}' como '{canonico}'. Confírmalo con el usuario en tu respuesta "
        f"(por ejemplo: 'Entendí {canonico}, ¿correcto?')."
    )


def _referencia(
    catalogo: Catalogo, cp: str, latitud: float | None, longitud: float | None, lugar: str = ""
) -> tuple[Referencia | None, str | None, list[str]]:
    """Punto de referencia: coordenadas (ganan), luego CP, luego lugar (municipio/localidad).

    Devuelve ``(referencia, error, notas)``; ``notas`` son avisos para el modelo (typos corregidos, etc.).
    """
    notas: list[str] = []
    if latitud is not None and longitud is not None:
        try:
            lat, lon = float(latitud), float(longitud)
        except (TypeError, ValueError):
            return None, "Coordenadas inválidas.", notas
        if not (_LAT[0] <= lat <= _LAT[1] and _LON[0] <= lon <= _LON[1]):
            return None, "Esa ubicación está fuera de Sinaloa; el catálogo solo cubre Sinaloa.", notas
        return Referencia(lat=lat, lon=lon, origen="ubicacion", detalle="ubicación compartida"), None, notas
    cp = clamp_text(cp, 10, collapse_newlines=True)
    if cp:
        try:
            ref = catalogo.referencia_por_cp(cp)
        except ValueError as exc:
            return None, str(exc), notas
        if ref is None:
            return None, f"No pude ubicar el CP {cp} con el catálogo; pide el municipio o la localidad.", notas
        return ref, None, notas
    lugar = clamp_text(lugar, 120, collapse_newlines=True)
    if lugar:
        hallado = catalogo.referencia_por_lugar(lugar)
        if hallado is None:
            return None, (
                f"No reconozco el lugar '{lugar}'. Dile al usuario que no lo ubicaste y pídele su código "
                "postal o que comparta su ubicación."
            ), notas
        ref, resolucion = hallado
        if nota := _nota_correccion(resolucion.corregido_de, resolucion.lugar.nombre):
            notas.append(nota)
        if resolucion.ambiguos:
            notas.append(
                f"También podría ser: {', '.join(resolucion.ambiguos)}. Si el usuario no dio más contexto, pregúntale cuál."
            )
        notas.append(f"Las distancias son desde el centro de {ref.detalle}, no desde su domicilio.")
        return ref, None, notas
    return None, "Falta el código postal, la ubicación o el lugar (municipio/localidad) del usuario.", notas


# -------------------------------------------------------------------- tools


@tool
async def unidad_mas_cercana(
    runtime: ToolRuntime,
    codigo_postal: str = "",
    latitud: float | None = None,
    longitud: float | None = None,
    lugar: str = "",
    servicio: str = "",
    limite: int = 3,
) -> str:
    """Unidades médicas más cercanas al usuario, con domicilio, horario y si están abiertas ahora.

    Pasa UNA de estas tres referencias, en este orden de preferencia:
    `latitud` y `longitud` (ubicación compartida), `codigo_postal` de 5 dígitos, o
    `lugar` (el municipio o localidad tal como lo escribió el usuario: "Navolato",
    "Topolobampo", "Mocorito"). El `lugar` tolera errores de ortografía y de
    transcripción de voz ("abolato" -> Navolato).
    `servicio` (opcional) filtra por: `edi`, `estimulacion_temprana` o `battelle`
    (también entiende "batel", "estimulasion"); vacío = cualquiera.
    `limite`: cuántas devolver (1 a 8, por defecto 3).

    Las distancias son aproximadas y en línea recta, no ruta de manejo.
    """
    catalogo = get_catalogo()
    servicio_ok, error = _servicio(servicio)
    if error:
        return _fail(error)
    ref, error, notas = _referencia(catalogo, codigo_postal, latitud, longitud, lugar)
    if error or ref is None:
        return _fail(error or "No pude ubicar al usuario.")

    ahora = ahora_local()
    resultados = catalogo.cercanas(
        ref, servicio=servicio_ok, limite=_limite(limite, 3), pista=lugar if ref.origen == "lugar" else ""
    )
    if not resultados:
        return "No hay unidades con ese servicio en el catálogo."

    lineas = [_cabecera_tiempo(ahora), f"Referencia: {ref.detalle}.", *notas]
    if ref.origen == "cp_aproximado":
        lineas.append("AVISO: la zona es aproximada; dile al usuario que confirme con su ubicación o municipio.")
    lineas.append("Distancias aproximadas (línea recta).")
    lineas.extend(_linea_unidad(u, ahora, km=km, indice=i) for i, (u, km) in enumerate(resultados, 1))
    if resultados[0][1] > _MAX_KM_RECOMENDABLE:
        lineas.append(
            f"AVISO: la unidad más cercana está a ~{resultados[0][1]:.0f} km; avísalo y ofrece confirmar el municipio."
        )
    return "\n".join(lineas)


@tool
async def buscar_unidades(runtime: ToolRuntime, consulta: str = "", servicio: str = "", limite: int = 5) -> str:
    """Busca unidades por nombre, municipio o localidad ("Navolato", "Topolobampo", "Choix").

    `consulta` vacía + `servicio` lista todas las que ofrecen ese servicio
    (útil para "¿dónde hacen la prueba Battelle?"). `servicio`: `edi`,
    `estimulacion_temprana` o `battelle`. `limite`: 1 a 8, por defecto 5.
    """
    catalogo = get_catalogo()
    servicio_ok, error = _servicio(servicio)
    if error:
        return _fail(error)
    consulta = clamp_text(consulta, 120, collapse_newlines=True)
    if not consulta and not servicio_ok:
        return _fail("Pasa una consulta (municipio, localidad o nombre) o un servicio.")
    solo_servicio = bool(servicio_ok and not consulta)
    todas, correcciones = catalogo.buscar_difuso(consulta, servicio=servicio_ok, limite=len(catalogo.unidades))
    total = len(todas)
    encontradas = todas[: _LIMITE_MAX if solo_servicio else _limite(limite, 5)]
    if not encontradas:
        return (
            f"No encontré unidades para '{consulta}'"
            + (f" con el servicio {servicio_ok}" if servicio_ok else "")
            + ". Pide el municipio o el código postal."
        )
    ahora = ahora_local()
    lineas = [_cabecera_tiempo(ahora), "Esta búsqueda NO trae distancias: no digas kilómetros ni 'la más cercana'."]
    for original, canonico in correcciones:
        if nota := _nota_correccion(original, canonico):
            lineas.append(nota)
    if total >= 3:
        # Muchas unidades: resumen de una línea por unidad. Detallarlas todas produce
        # mensajes larguísimos; con `detalle_de_unidad` se abre la que el usuario elija.
        lineas.append(
            f"HAY {total} UNIDADES" + (f" (aquí van {len(encontradas)})" if total > len(encontradas) else "") + ". No las detalles: nombra hasta 3 en una sola línea y pregunta "
            "en qué localidad vive o su código postal para decirle la más cercana."
        )
        for u in encontradas:
            lineas.append(f"- {titulo(u.nombre)} [{u.id}] | {titulo(u.municipio) or 'municipio no indicado'} | servicios: {', '.join(u.servicios)}")
    else:
        lineas.extend(_linea_unidad(u, ahora) for u in encontradas)
    return "\n".join(lineas)


@tool
async def detalle_de_unidad(unidad_id: str, runtime: ToolRuntime) -> str:
    """Ficha completa de una unidad por su id (p. ej. `U020`), con datos de la prueba Battelle si aplica."""
    unidad = get_catalogo().obtener(clamp_text(unidad_id, 12, collapse_newlines=True))
    if unidad is None:
        return _fail("No existe esa unidad; búscala con buscar_unidades o unidad_mas_cercana.")
    ahora = ahora_local()
    lineas = [_cabecera_tiempo(ahora), _linea_unidad(unidad, ahora), f"Región: {unidad.region}."]
    if unidad.horario:
        lineas.append(f"Horario normalizado: {resumen_horario(unidad.horario)}.")
    if unidad.battelle:
        b = unidad.battelle
        lineas.append(f"Prueba Battelle: sí ({b.equipos}; jurisdicción sanitaria {b.jurisdiccion}).")
        if b.domicilio or b.horario_texto:
            propios = ", ".join(
                filter(None, [b.domicilio, f"CP {b.codigo_postal}" if b.codigo_postal else "", b.horario_texto])
            )
            lineas.append(f"Datos propios de Battelle (difieren del catálogo general; confirmar por teléfono): {propios}.")
    else:
        lineas.append("Prueba Battelle: no se aplica en esta unidad.")
    return "\n".join(lineas)


@tool
async def escalar_a_humano(motivo: str, runtime: ToolRuntime, resumen: str = "") -> Command:
    """Pasa la conversación a una persona del equipo.

    Motivos: USUARIO_LO_PIDE, FUERA_DE_CONOCIMIENTO, QUEJA, URGENCIA,
    ERROR_TECNICO. `resumen`: una línea con lo que el usuario necesita.
    NO escales por ERROR_TECNICO: reintenta la herramienta que falló.
    """
    if denied := require_scope(_ctx(runtime).get("scopes"), "escalar_a_humano"):
        return _tool_reply(runtime, _fail(denied))
    motivo = clamp_text(motivo, 80, collapse_newlines=True).strip().upper() or "USUARIO_LO_PIDE"
    if motivo in _NO_HANDOFF_REASONS:
        return _tool_reply(
            runtime,
            _fail(
                "No escales por un error técnico. Dile al usuario en una línea que en un "
                "momento lo reintentas y vuelve a llamar la herramienta que falló."
            ),
        )
    return _tool_reply(
        runtime,
        "Conversación marcada para que la tome una persona del equipo.",
        update={"handoff": True, "handoff_reason": motivo, "stage": "HUMANO"},
    )


TOOLS = [
    unidad_mas_cercana,
    buscar_unidades,
    detalle_de_unidad,
    escalar_a_humano,
]
