"""Catálogo de unidades médicas, tools de cercanía y ubicación compartida."""

from __future__ import annotations

import asyncio
from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app import main, tools
from app.unidades import abierta_ahora, get_catalogo, normalizar, resumen_horario
from app.unidades.catalogo import haversine_km, servicio_canonico
from app.unidades.horario import ZONA, Ventana
from tests.conftest import FakeAgent

# 2026-09-28 es lunes; 2026-10-03 es sábado; 2026-10-04 es domingo.
LUNES_10 = datetime(2026, 9, 28, 10, 0, tzinfo=ZONA)
LUNES_23 = datetime(2026, 9, 28, 23, 0, tzinfo=ZONA)
SABADO_18 = datetime(2026, 10, 3, 18, 0, tzinfo=ZONA)
DOMINGO_10 = datetime(2026, 10, 4, 10, 0, tzinfo=ZONA)


def _unidad(nombre_parcial: str):
    encontradas = [u for u in get_catalogo().unidades if nombre_parcial in u.nombre]
    assert len(encontradas) == 1, (nombre_parcial, [u.nombre for u in encontradas])
    return encontradas[0]


def _run(tool, **kwargs):
    runtime = SimpleNamespace(context={"tenant_id": "t1", "scopes": []}, tool_call_id="call-1")
    return asyncio.run(tool.coroutine(runtime=runtime, **kwargs))


# ---------------------------------------------------------------- datos


def test_catalogo_completo_y_coordenadas() -> None:
    catalogo = get_catalogo()
    assert len(catalogo.unidades) == 83
    assert all(u.tiene_coordenadas for u in catalogo.unidades)
    assert len({u.id for u in catalogo.unidades}) == 83
    # Todas dentro de Sinaloa (caja aproximada).
    assert all(22.3 <= u.lat <= 27.1 and -109.6 <= u.lon <= -105.2 for u in catalogo.unidades)


def test_servicios_del_catalogo() -> None:
    catalogo = get_catalogo()
    assert all(u.realiza_edi for u in catalogo.unidades)
    assert len([u for u in catalogo.unidades if u.estimulacion_temprana]) == 6
    battelle = [u for u in catalogo.unidades if u.battelle]
    assert len(battelle) == 6
    assert {u.battelle.jurisdiccion for u in battelle} == {
        "I LOS MOCHIS", "II GUASAVE", "III GUAMÚCHIL", "IV CULIACÁN", "V MAZATLÁN", "VI ESCUINAPA",
    }
    zarco = next(u for u in battelle if u.battelle.jurisdiccion == "IV CULIACÁN")
    assert zarco.battelle.equipos == "4 equipos completos"


def test_unidades_sin_datos_quedan_marcadas() -> None:
    for nombre in ("PALMA SOLA", "IXPALINO"):
        u = _unidad(nombre)
        assert u.domicilio is None and u.horario == () and u.notas
    assert _unidad("COL. LA MONTUOSA").codigo_postal is None


def test_normalizar_y_servicios() -> None:
    assert normalizar("  Culiacán, SINALOA! ") == "culiacan sinaloa"
    assert servicio_canonico("Prueba Battelle") == "battelle"
    assert servicio_canonico("estimulación temprana") == "estimulacion_temprana"
    assert servicio_canonico("") == ""
    with pytest.raises(ValueError):
        servicio_canonico("rayos x")


# -------------------------------------------------------------- horarios


def test_abierta_ahora_por_dia_y_hora() -> None:
    fuerte = _unidad("USPN EL FUERTE")  # L-V 8-20
    assert abierta_ahora(fuerte.horario, LUNES_10) is True
    assert abierta_ahora(fuerte.horario, LUNES_23) is False
    assert abierta_ahora(fuerte.horario, SABADO_18) is False
    fines = _unidad("USPN TOPOLOBAMPO")  # L-V 8-20; S-D 8-16
    assert abierta_ahora(fines.horario, SABADO_18) is False
    assert abierta_ahora(fines.horario, DOMINGO_10) is True


def test_hospital_pediatrico_24_horas_y_sin_horario() -> None:
    hospital = _unidad("HOSPITAL PEDIÁTRICO")
    assert abierta_ahora(hospital.horario, LUNES_23) is True
    assert resumen_horario(hospital.horario) == "todos los días 24 horas"
    assert abierta_ahora(_unidad("IXPALINO").horario, LUNES_10) is None


def test_ventanas_traslapadas_y_hora_sin_zona() -> None:
    aguaverde = _unidad("AGUAVERDE")  # L-V 8-16; S-M 12-20
    assert abierta_ahora(aguaverde.horario, datetime(2026, 9, 28, 18, 0, tzinfo=ZONA)) is True  # lunes 18:00 (S-M)
    assert abierta_ahora(aguaverde.horario, datetime(2026, 10, 2, 18, 0, tzinfo=ZONA)) is False  # viernes 18:00
    # Sin zona se interpreta como hora de Sinaloa; con otra zona se convierte.
    assert abierta_ahora((Ventana((0,), 480, 1200),), datetime(2026, 9, 28, 10, 0)) is True
    utc = datetime(2026, 9, 28, 17, 0, tzinfo=ZoneInfo("UTC"))  # 10:00 en Sinaloa (UTC-7)
    assert abierta_ahora((Ventana((0,), 480, 1200),), utc) is True


# ------------------------------------------------------------- cercanía


def test_haversine_conocido() -> None:
    # Culiacán -> Los Mochis: ~ 200 km en línea recta.
    assert 190 < haversine_km(24.8091, -107.394, 25.7928, -108.9901) < 215


def test_cp_exacto_cercana_es_la_misma_unidad() -> None:
    catalogo = get_catalogo()
    ref = catalogo.referencia_por_cp("80230")
    assert ref and ref.origen == "cp_exacto"
    primera, km = catalogo.cercanas(ref, limite=1)[0]
    assert primera.codigo_postal == "80230" and km < 1


def test_cp_fuera_del_catalogo_es_aproximado() -> None:
    ref = get_catalogo().referencia_por_cp("81250")
    assert ref and ref.origen == "cp_aproximado" and "81250" in ref.detalle


def test_cp_invalido_o_fuera_de_sinaloa() -> None:
    catalogo = get_catalogo()
    with pytest.raises(ValueError):
        catalogo.referencia_por_cp("8123")
    with pytest.raises(ValueError):
        catalogo.referencia_por_cp("06600")  # CDMX


def test_battelle_mas_cercana_desde_navolato_es_culiacan() -> None:
    catalogo = get_catalogo()
    ref = catalogo.referencia_por_cp("80320")  # Navolato centro
    unidad, km = catalogo.cercanas(ref, servicio="battelle", limite=1)[0]
    assert unidad.battelle.jurisdiccion == "IV CULIACÁN" and km < 60


def test_buscar_por_texto_y_servicio() -> None:
    catalogo = get_catalogo()
    assert {u.municipio for u in catalogo.buscar("navolato", limite=8)} == {"NAVOLATO"}
    assert len(catalogo.buscar("", servicio="battelle", limite=8)) == 6
    assert catalogo.buscar("Topolobampo")[0].nombre == "USPN TOPOLOBAMPO"
    assert catalogo.buscar("zzzz inexistente") == []


# ---------------------------------------------------------------- tools


def test_tool_por_ubicacion_lista_la_mas_cercana() -> None:
    # Coordenadas de Los Mochis centro.
    out = _run(tools.unidad_mas_cercana, latitud=25.79, longitud=-108.99, limite=2)
    assert "USPN Urbano Mochis" in out
    assert "línea recta" in out and "Hora en Sinaloa" in out


def test_tool_por_cp_y_servicio() -> None:
    out = _run(tools.unidad_mas_cercana, codigo_postal="80320", servicio="battelle", limite=1)
    assert "Culiacán" in out and "Prueba Battelle" in out
    assert "Claudia" not in out and "QUINTERO" not in out  # el personal no se expone


def test_tool_errores_claros() -> None:
    assert _run(tools.unidad_mas_cercana).startswith("ERROR: Falta")
    assert "no es de Sinaloa" in _run(tools.unidad_mas_cercana, codigo_postal="06600")
    assert "fuera de Sinaloa" in _run(tools.unidad_mas_cercana, latitud=19.43, longitud=-99.13)
    assert "Servicio desconocido" in _run(tools.unidad_mas_cercana, codigo_postal="80230", servicio="rayos x")
    assert "5 dígitos" in _run(tools.unidad_mas_cercana, codigo_postal="8023")


def test_tool_avisa_datos_incompletos() -> None:
    out = _run(tools.buscar_unidades, consulta="Palma Sola")
    assert "domicilio: no disponible" in out and "horario: no disponible" in out and "nota de datos" in out


def test_buscar_unidades_battelle_lista_las_seis() -> None:
    out = _run(tools.buscar_unidades, servicio="battelle")
    assert out.count("Prueba Battelle") == 6


def test_detalle_de_unidad_con_battelle_y_discrepancia() -> None:
    guamuchil = _unidad("GUAMÚCHIL")
    out = _run(tools.detalle_de_unidad, unidad_id=guamuchil.id.lower())
    assert "Prueba Battelle: sí" in out and "Agustina Ramírez 69" in out and "confirmar por teléfono" in out
    assert _run(tools.detalle_de_unidad, unidad_id="U999").startswith("ERROR")


def test_escalar_a_humano_exige_scope_y_rechaza_error_tecnico() -> None:
    runtime = SimpleNamespace(context={"tenant_id": "t1", "scopes": ["chat.write"]}, tool_call_id="c")
    cmd = asyncio.run(tools.escalar_a_humano.coroutine(motivo="URGENCIA", runtime=runtime))
    assert cmd.update["handoff"] is True and cmd.update["handoff_reason"] == "URGENCIA"
    rechazo = asyncio.run(tools.escalar_a_humano.coroutine(motivo="error_tecnico", runtime=runtime))
    assert "handoff" not in rechazo.update
    sin_scope = SimpleNamespace(context={"tenant_id": "t1", "scopes": []}, tool_call_id="c")
    denegado = asyncio.run(tools.escalar_a_humano.coroutine(motivo="QUEJA", runtime=sin_scope))
    assert "handoff" not in denegado.update and "Sin permiso" in denegado.update["messages"][0].content


# ------------------------------------------------- ubicación por /chat


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    with TestClient(main.app) as test_client:
        fake = FakeAgent()
        monkeypatch.setattr(main.runtime, "agent", fake)
        monkeypatch.setattr(main.runtime, "utility_model", None)
        test_client.fake = fake  # type: ignore[attr-defined]
        yield test_client


def test_chat_solo_con_ubicacion_arma_el_turno(client: TestClient) -> None:
    resp = client.post(
        "/chat",
        json={"tenantId": "imss-sinaloa", "conversationId": "loc-1", "location": {"latitude": 25.79, "longitude": -108.99}},
    )
    assert resp.status_code == 200
    contenido = client.fake.invocations[0]["payload"]["messages"][0].content
    assert "[ubicación compartida: latitud=25.79000, longitud=-108.99000]" in contenido


def test_chat_texto_mas_ubicacion_y_rango_invalido(client: TestClient) -> None:
    ok = client.post(
        "/chat",
        json={"tenantId": "imss-sinaloa", "conversationId": "loc-2", "text": "¿cuál me queda cerca?",
              "location": {"latitude": 24.8, "longitude": -107.39}},
    )
    assert ok.status_code == 200
    contenido = client.fake.invocations[0]["payload"]["messages"][0].content
    assert contenido.startswith("¿cuál me queda cerca?") and "latitud=24.80000" in contenido
    malo = client.post("/chat", json={"tenantId": "imss-sinaloa", "location": {"latitude": 95, "longitude": 0}})
    assert malo.status_code == 422


def test_working_memory_solo_lleva_la_etapa() -> None:
    from app.state import working_memory_block

    assert working_memory_block({}) == "Etapa: DESCUBRIMIENTO"
    assert working_memory_block({"stage": "HUMANO"}) == "Etapa: HUMANO"


def test_ranking_no_favorece_unidades_ubicadas_solo_por_municipio() -> None:
    # Los Mochis centro: USPN Urbano Mochis (precisión de ciudad) gana a
    # 9 de Diciembre, cuyo punto es la cabecera municipal aproximada.
    catalogo = get_catalogo()
    ref = catalogo.referencia_por_cp("81233")
    primera, _ = catalogo.cercanas(ref, limite=1)[0]
    assert primera.nombre == "USPN URBANO MOCHIS"


# ------------------------------------------------------------ emergencias


@pytest.mark.parametrize(
    "texto",
    [
        "Mi hijo no respira bien",
        "mi bebé se puso morado",
        "está convulsionando",
        "se desmayó y no reacciona",
        "creo que se envenenó con cloro",
        "tiene un sangrado que no para",
        "es una emergencia",
        "NECESITO UNA AMBULANCIA",
    ],
)
def test_emergencias_se_detectan(texto: str) -> None:
    from app.guards import detect_emergency

    assert detect_emergency(texto)


@pytest.mark.parametrize(
    "texto",
    [
        "Mi código postal es 80230",
        "¿Dónde hacen la prueba Battelle?",
        "¿Está abierta la unidad de Topolobampo ahora?",
        "Quiero la evaluación del desarrollo de mi hijo, no es urgente",
        "Hola",
        "",
    ],
)
def test_consultas_normales_no_son_emergencia(texto: str) -> None:
    from app.guards import detect_emergency

    assert not detect_emergency(texto)


def test_chat_emergencia_responde_911_sin_invocar_al_grafo(client: TestClient) -> None:
    resp = client.post(
        "/chat", json={"tenantId": "imss-sinaloa", "conversationId": "em-1", "text": "mi hijo no respira"}
    )
    body = resp.json()
    assert resp.status_code == 200
    assert body["intent"] == "URGENCIA" and body["engine"] == "emergency-guard"
    assert "911" in body["reply"]
    assert client.fake.invocations == []


def test_endpoint_unidades_no_expone_personal(client: TestClient) -> None:
    lista = client.get("/unidades").json()
    assert lista["total"] == 83
    assert not any(n in str(lista) for n in ("PSIC.", "ULISES", "MONREAL", "AMAYRANI", "VERENICE", "DELANDA", "SILVIA"))
    u = client.get("/unidades/u020").json()
    assert u["battelle"] is True and u["horario"] and u["lat"] and "Prueba Battelle" in u["servicios"]
    assert client.get("/unidades/U999").status_code == 404


def test_formato_de_textos_del_catalogo() -> None:
    from app.unidades.formato import frase, titulo

    assert titulo("USPN URBANO MOCHIS") == "USPN Urbano Mochis"
    assert titulo("CULIACÁN (COL. LOMA DE RODRIGUERA)") == "Culiacán (Col. Loma de Rodriguera)"
    assert titulo("AV. SANDRA CALDERON NO. 44, COL. CENTRO") == "Av. Sandra Calderon No. 44, Col. Centro"
    assert titulo("MIGUEL HIDALGO S/N, COL. CENTRO") == "Miguel Hidalgo S/N, Col. Centro"
    assert titulo(None) == ""
    assert frase("LUNES A VIERNES  8:00-20:00") == "Lunes a viernes 8:00-20:00"


def test_buscar_unidades_con_muchas_resultados_es_resumen_y_cuenta_el_total() -> None:
    out = _run(tools.buscar_unidades, consulta="Choix", limite=3)
    assert "HAY 7 UNIDADES (aquí van 3)" in out
    assert out.count("\n- ") == 3 and "domicilio:" not in out  # una línea por unidad, sin detalle
    assert "NO trae distancias" in out and " km " not in out.replace("NO trae distancias: no digas kilómetros", "")


def test_buscar_unidades_con_pocos_resultados_da_detalle() -> None:
    out = _run(tools.buscar_unidades, consulta="Topolobampo")
    assert "HAY" not in out and "domicilio:" in out and "horario:" in out


# ------------------------------------------------------ typos y fonética


@pytest.mark.parametrize(
    ("escrito", "esperado"),
    [
        ("Navolato", "Navolato"),
        ("abolato", "Navolato"),  # error real de Whisper
        ("navolatto", "Navolato"),
        ("los mochs", "Los Mochis"),
        ("vivo en culiakan", "Culiacán"),
        ("topolobamp", "Topolobampo"),
        ("guasabe", "Guasave"),
        ("choiz", "Choix"),
        ("cosala", "Cosalá"),
        ("Mocorito", "Mocorito"),  # municipio sin unidad en el catálogo
        ("mazatlan", "Mazatlán"),
        ("rosario", "El Rosario"),
        ("ahome", "Los Mochis"),
    ],
)
def test_resolver_lugar_tolera_typos_y_fonetica(escrito: str, esperado: str) -> None:
    resolucion = get_catalogo().resolver_lugar(escrito)
    assert resolucion is not None and resolucion.lugar.nombre == esperado


def test_resolver_lugar_no_inventa() -> None:
    catalogo = get_catalogo()
    for basura in ("xyzzy", "quiero una pizza", "hola buenas", ""):
        assert catalogo.resolver_lugar(basura) is None


def test_lugar_sin_unidad_da_las_mas_cercanas() -> None:
    out = _run(tools.unidad_mas_cercana, lugar="Mocorito", limite=2)
    assert "Referencia: Mocorito" in out and "km en línea recta" in out and "Las distancias son desde el centro de Mocorito" in out


def test_tool_avisa_de_la_correccion_para_confirmarla() -> None:
    out = _run(tools.unidad_mas_cercana, lugar="abolato", limite=1)
    assert "Interpreté 'abolato' como 'Navolato'" in out and "¿correcto?" in out
    exacto = _run(tools.unidad_mas_cercana, lugar="Navolato", limite=1)
    assert "Interpreté" not in exacto


def test_tool_lugar_desconocido_pide_cp_o_ubicacion() -> None:
    out = _run(tools.unidad_mas_cercana, lugar="xyzzy")
    assert out.startswith("ERROR: No reconozco el lugar") and "código postal" in out


def test_coordenadas_y_cp_ganan_sobre_lugar() -> None:
    out = _run(tools.unidad_mas_cercana, codigo_postal="80230", lugar="Choix", limite=1)
    assert "CP 80230" in out and "Choix" not in out.split("\n")[1]


@pytest.mark.parametrize(
    ("escrito", "servicio"),
    [("batel", "battelle"), ("prueba Batele", "battelle"), ("bateri", "battelle"),
     ("estimulasion temprana", "estimulacion_temprana"), ("edy", "edi"), ("EDI", "edi")],
)
def test_servicio_tolera_typos_y_voz(escrito: str, servicio: str) -> None:
    assert servicio_canonico(escrito) == servicio


def test_buscar_difuso_corrige_y_reporta() -> None:
    unidades, correcciones = get_catalogo().buscar_difuso("hospital pediatrco")
    assert unidades[0].nombre.startswith("HOSPITAL PEDI") and correcciones == [("pediatrco", "pediatrico")]
    assert [u.nombre for u in get_catalogo().buscar("Ceredi")][0].endswith("(CEREDI)")


def test_buscar_unidades_avisa_de_typos() -> None:
    out = _run(tools.buscar_unidades, consulta="topolobanpo")
    assert "Interpreté 'topolobanpo' como 'topolobampo'" in out and "Topolobampo" in out
    # Un prefijo ya aparece tal cual en el catálogo: no hay nada que corregir.
    assert "Interpreté" not in _run(tools.buscar_unidades, consulta="topolobamp")


def test_difuso_no_toca_palabras_cortas_ni_genericas() -> None:
    from app.unidades import difuso

    assert difuso.mejor("edx", {"edi": "edi"}) is None  # palabras de 3 letras: sin margen
    assert difuso.margen(3) == 0 and difuso.margen(5) == 1 and difuso.margen(9) == 2
    assert difuso.distancia("navolato", "nabolato") == 1 and difuso.distancia("ab", "ba") == 1
    assert difuso.clave_fonetica("Navolatto") == difuso.clave_fonetica("nabolato")


def test_pista_de_colonia_prioriza_la_unidad_de_esa_zona() -> None:
    con_pista = _run(tools.unidad_mas_cercana, lugar="culiakan cerca de la colonia zarco", limite=1)
    assert "Zarco" in con_pista and "Interpreté" in con_pista


def test_pista_no_trae_unidades_lejanas() -> None:
    catalogo = get_catalogo()
    ref, _ = catalogo.referencia_por_lugar("Los Mochis")
    lejos = catalogo.cercanas(ref, limite=1, pista="zarco")[0][0]  # "zarco" solo existe en Culiacán
    assert "CULIAC" not in lejos.nombre.upper()


def test_empate_en_la_ciudad_recomienda_la_unidad_con_mas_servicios() -> None:
    catalogo = get_catalogo()
    ref, _ = catalogo.referencia_por_lugar("Culiacán")
    primera, _ = catalogo.cercanas(ref, limite=1)[0]
    assert len(primera.servicios) == 3  # EDI + estimulación temprana + Battelle
