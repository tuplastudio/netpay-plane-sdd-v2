"""Heurísticas deterministas sobre el mensaje del cliente.

Corren ANTES del clasificador LLM de tema (``guards/scope.py``) y del grafo.
No gastan tokens, no dependen del proveedor y son la razón por la que un
fallo del clasificador (que falla hacia abierto por diseño) ya no deja pasar
los casos obvios: "ignora tus instrucciones", "escribe una función en
Python", "qué clima hace hoy".

Dos detectores:

- ``detect_injection``: intentos de manipular al agente (ignorar reglas,
  revelar el prompt, modo desarrollador, suplantar autoridad, marcadores de
  rol de otros formatos de chat). Un acierto en categoría fuerte = rechazo
  sin invocar al modelo.
- ``off_scope_category``: peticiones claramente ajenas a vender (código,
  clima, tarea escolar, traducción, redacción, temas ilegales). Patrones a
  propósito estrechos: ante duda devuelven ``None`` y decide el LLM.

``neutralize`` limpia el texto antes de cualquier otra cosa: Unicode
invisible (ver ``security.strip_hidden_unicode``) y tokens de control de
otros formatos (``<|im_start|>``, ``[INST]``, ``<<SYS>>``).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..security import strip_hidden_unicode

_FLAGS = re.IGNORECASE | re.UNICODE

# (categoría, fuerte, patrón). "fuerte" = basta un acierto para rechazar.
_INJECTION_PATTERNS: tuple[tuple[str, bool, re.Pattern[str]], ...] = (
    (
        "ignorar_reglas",
        True,
        re.compile(
            r"\b(ignor(a|á|es|en|ar|ando)|olvid(a|á|es|en|ar)|omit(e|as|an|ir)|desobedec(e|es|er)|salt(a|es|ar)|sáltate|deja\s+de\s+lado|haz\s+caso\s+omiso\s+(a|de))\s+"
            r"(todas?\s+|todo\s+)?(tus|las|sus|esas|estas|cualquier)?\s*"
            r"(reglas?|instrucciones?|indicaciones?|restricciones?|directrices|l[ií]mites|prompt|programaci[oó]n)",
            _FLAGS,
        ),
    ),
    (
        "ignorar_reglas",
        True,
        re.compile(
            r"\b(ignore|forget|disregard|bypass|override)\s+(all\s+)?(the\s+|your\s+|any\s+)?"
            r"(previous|prior|above|earlier|system)?\s*(instructions?|rules?|prompts?|guidelines?|restrictions?)",
            _FLAGS,
        ),
    ),
    (
        "revelar_prompt",
        True,
        re.compile(
            r"\b(mu[eé]strame|muestra|dime|d[ií]game|revela|rev[eé]lame|repite|rep[ií]teme|imprime|escribe|copia|"
            r"cu[aá]l(es)?\s+(es|son)|c[oó]mo\s+(es|son)|dame|ens[eé][ñn]ame|comparte|transcribe)\s+"
            r"(me\s+)?(textual(mente)?\s+)?(tu|tus|el|la|los|las|su|sus)\s+"
            r"(system\s*prompt|prompt|instrucciones?|reglas?|configuraci[oó]n|mensaje\s+del?\s+sistema|"
            r"programaci[oó]n|directrices|herramientas?|funciones?\s+internas|notas?\s+internas?)",
            _FLAGS,
        ),
    ),
    (
        "revelar_prompt",
        True,
        re.compile(
            r"\b(show|print|reveal|repeat|display|output|tell)\s+(me\s+)?(your|the)\s+"
            r"(system\s*prompt|prompt|instructions?|rules|configuration|hidden\s+rules)",
            _FLAGS,
        ),
    ),
    (
        "modo_desarrollador",
        True,
        re.compile(
            r"\b(modo\s+(desarrollador|developer|dios|admin|debug|sin\s+(restricciones|filtros|l[ií]mites|censura)|libre|jailbreak)|"
            r"developer\s+mode|god\s+mode|jailbreak|\bDAN\b|do\s+anything\s+now|sin\s+censura)",
            _FLAGS,
        ),
    ),
    (
        "suplantar_rol",
        True,
        re.compile(
            r"\b(act[uú]a|comp[oó]rtate|responde|habla|finge|simula|pretende|haz)\s+(como|de|que\s+eres)\s+"
            r"(si\s+fueras\s+)?(un|una|otro|otra|el|la)?\s*"
            r"(asistente|ia|inteligencia\s+artificial|modelo|chatgpt|gpt|claude|gemini|bot|chatbot)\b"
            r".{0,40}?(sin\s+(restricciones|l[ií]mites|filtros|reglas)|libre|diferente|distint[oa]|que\s+(todo\s+)?lo\s+puede)",
            _FLAGS,
        ),
    ),
    (
        "suplantar_rol",
        True,
        re.compile(
            r"\b(ahora\s+eres|desde\s+ahora\s+eres|a\s+partir\s+de\s+ahora\s+(eres|ser[aá]s)|you\s+are\s+now|from\s+now\s+on\s+you\s+are)\b",
            _FLAGS,
        ),
    ),
    (
        "falsa_autoridad",
        True,
        re.compile(
            r"\b(soy|somos|habla|te\s+escribe|aqu[ií])\s+(el|la|tu|un|una|los|del)?\s*"
            r"(desarrollador(a)?|developer|programador(a)?|administrador(a)?|admin|due[ñn][oa]\s+del\s+(sistema|bot|agente)|"
            r"ingenier[oa]\s+de\s+(tupla|openai|anthropic|easy\s*sell)|soporte\s+(t[eé]cnico\s+)?de\s+(tupla|easy\s*sell)|"
            r"equipo\s+de\s+(tupla|openai|anthropic)|probador|tester|auditor)\b"
            r".{0,80}?(reglas?|instrucciones?|prompt|configuraci[oó]n|desactiva|activa|modo|prueba|test)",
            _FLAGS,
        ),
    ),
    (
        "marcador_de_rol",
        True,
        re.compile(
            r"(^|\n)\s*(system|assistant|sistema|asistente|\[system\]|\[sistema\])\s*:|"
            r"<\|im_(start|end)\|>|\[/?INST\]|<</?SYS>>|###\s*(system|instruction|sistema)\b",
            _FLAGS,
        ),
    ),
    (
        "nuevas_instrucciones",
        False,
        re.compile(r"\b(nuevas?\s+instrucciones?|new\s+instructions?)\b", _FLAGS),
    ),
    (
        "sistema_habla",
        False,
        re.compile(
            r"\b(instrucci[oó]n(es)?\s+del\s+sistema|el\s+sistema\s+(dice|indica|te\s+ordena|te\s+pide)|"
            r"anula\s+(tus|las)\s+reglas|reemplaza\s+(tus|las)\s+(reglas|instrucciones))\b",
            _FLAGS,
        ),
    ),
    (
        "extraer_datos",
        True,
        re.compile(
            r"\b(dame|mu[eé]strame|lista|pasa(me)?|env[ií]ame|exporta)\s+(me\s+)?(todos?\s+|la\s+lista\s+de\s+|los\s+datos\s+de\s+)?"
            r"(los\s+|las\s+)?(tel[eé]fonos?|correos?|clientes|pedidos|cotizaciones|direcciones)\s+"
            r"(de\s+(otros|todos|los\s+dem[aá]s)|que\s+tienes\s+(guardados|registrados)|de\s+la\s+base)",
            _FLAGS,
        ),
    ),
)

_CONTROL_TOKENS_RE = re.compile(r"<\|[a-z_]+\|>|\[/?INST\]|<</?SYS>>", re.IGNORECASE)

# Categoría → patrones. Ninguno debe disparar con vocabulario comercial
# normal ("clima" solo con "hoy/mañana/hace/pronóstico": en México "clima"
# también es aire acondicionado; "java" puede ser café).
_OFF_SCOPE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "ilegal",
        re.compile(
            r"\b(c[oó]mo\s+(puedo\s+)?(hackear|hackeo|robar|falsificar|clonar|fabricar|evadir|lavar)|"
            r"hackear\s+(una?|la|el|mi|su)\s+(cuenta|whatsapp|facebook|instagram|correo|celular|red)|"
            r"clonar\s+(una?\s+)?tarjetas?|falsificar\s+(billetes|facturas|documentos|firmas)|"
            r"evadir\s+(impuestos|al\s+sat)|lavar\s+dinero|comprar\s+(drogas|armas)\b|fabricar\s+(explosivos|drogas|armas)|"
            r"tarjetas?\s+(robadas?|clonadas?)|n[uú]meros?\s+de\s+tarjetas?\s+(v[aá]lid[oa]s?|que\s+funcionen))",
            _FLAGS,
        ),
    ),
    (
        "programacion",
        re.compile(
            r"\b(escribe|escr[ií]beme|haz|hazme|crea|cr[eé]ame|genera|gen[eé]rame|programa|prog[aá]mame|dame|arma|ay[uú]dame\s+(a\s+)?(escribir|programar|hacer))\s+"
            r"(me\s+)?(una?\s+|el\s+|la\s+)?(c[oó]digo|funci[oó]n|script|programa|algoritmo|clase|m[eé]todo|query|consulta\s+sql|regex|"
            r"expresi[oó]n\s+regular|api|endpoint|componente|p[aá]gina\s+web|app|aplicaci[oó]n|bot)\b|"
            r"\b(en|con|usando)\s+(python|javascript|typescript|java|c\+\+|c#|golang|rust|php|sql|react|node(\.js)?|kotlin|swift|flutter)\b|"
            r"```|\bdef\s+\w+\s*\(|\bfunction\s+\w+\s*\(|\bimport\s+\w+\s+from\b|\bSELECT\s+.+\s+FROM\b|\bconsole\.log\(|\bprint\(",
            _FLAGS,
        ),
    ),
    (
        "clima",
        re.compile(
            r"\b((qu[eé]|c[oó]mo)\s+(clima|tiempo)\s+(hace|hay|habr[aá]|va\s+a\s+hacer|est[aá])|"
            r"pron[oó]stico\s+(del\s+)?(clima|tiempo)|va\s+a\s+llover|est[aá]\s+lloviendo|"
            r"(cu[aá]ntos\s+grados|qu[eé]\s+temperatura)\s+(hace|hay|habr[aá])|"
            r"clima\s+(de|en|para)\s+(hoy|ma[ñn]ana|el\s+fin\s+de\s+semana)|"
            r"(hoy|ma[ñn]ana)\s+(va\s+a\s+)?(llover|hacer\s+(calor|fr[ií]o)))\b",
            _FLAGS,
        ),
    ),
    (
        "tarea_escolar",
        re.compile(
            r"\b(resuelve|resu[eé]lveme|ay[uú]dame\s+con|hazme|expl[ií]came|c[oó]mo\s+se\s+resuelve)\s+"
            r"(mi\s+|la\s+|esta\s+|este\s+|el\s+|una\s+)?(tarea|ecuaci[oó]n|integral|derivada|problema\s+de\s+(mate|f[ií]sica|qu[ií]mica)|examen)\b|"
            r"\b\d+\s*[xy]\s*[+\-]\s*\d+\s*=\s*\d+\b|\bra[ií]z\s+cuadrada\s+de\s+\d+",
            _FLAGS,
        ),
    ),
    (
        "traduccion",
        re.compile(
            r"\b(trad[uú]ce(me)?|traduc[ií]|c[oó]mo\s+se\s+dice|c[oó]mo\s+se\s+escribe)\b.{1,80}?\b(al|en)\s+"
            r"(ingl[eé]s|franc[eé]s|alem[aá]n|italiano|portugu[eé]s|japon[eé]s|chino|coreano|ruso)\b",
            _FLAGS,
        ),
    ),
    (
        "redaccion",
        re.compile(
            r"\b(escribe|escr[ií]beme|red[aá]cta(me)?|hazme|comp[oó]n(me)?|crea|gen[eé]rame)\s+"
            r"(me\s+)?(un|una)\s+(ensayo|poema|cuento|historia|discurso|canci[oó]n|carta\s+(de|para)|"
            r"biograf[ií]a|art[ií]culo|rese[ñn]a\s+de\s+(pel[ií]cula|libro)|chiste\s+largo|rap|soneto)\b",
            _FLAGS,
        ),
    ),
    (
        "consejo_medico_legal",
        re.compile(
            r"\b(qu[eé]\s+(medicina|medicamento|pastilla)\s+(tomo|me\s+tomo|puedo\s+tomar)|"
            r"dosis\s+de\s+(paracetamol|ibuprofeno|amoxicilina)|tengo\s+s[ií]ntomas\s+de|"
            r"c[oó]mo\s+demando|puedo\s+demandar\s+a|qu[eé]\s+dice\s+la\s+ley\s+sobre|"
            r"redacta(me)?\s+un\s+contrato\s+de\s+(arrendamiento|compraventa|trabajo))\b",
            _FLAGS,
        ),
    ),
)


@dataclass(frozen=True)
class InjectionVerdict:
    """Resultado de ``detect_injection``."""

    is_injection: bool
    categories: tuple[str, ...] = field(default_factory=tuple)

    @property
    def label(self) -> str:
        return ",".join(self.categories) or "ninguna"


def neutralize(text: str) -> str:
    """Texto listo para las heurísticas y para el modelo: sin Unicode
    invisible ni tokens de control de otros formatos de chat."""
    cleaned = strip_hidden_unicode(text or "")
    cleaned = _CONTROL_TOKENS_RE.sub(" ", cleaned)
    return cleaned.strip()


def detect_injection(text: str) -> InjectionVerdict:
    """Clasifica un mensaje como intento de inyección.

    Una categoría fuerte basta; dos débiles también. Devuelve todas las
    categorías que dispararon (para logs/métricas).
    """
    raw = strip_hidden_unicode(text or "")
    body = neutralize(raw)
    if not body:
        return InjectionVerdict(False)
    strong: list[str] = []
    weak: list[str] = []
    # Los tokens de control de otros formatos de chat se quitan en
    # `neutralize`, pero su sola presencia ya es un intento de inyección.
    if _CONTROL_TOKENS_RE.search(raw):
        strong.append("marcador_de_rol")
    for category, is_strong, pattern in _INJECTION_PATTERNS:
        if pattern.search(body):
            (strong if is_strong else weak).append(category)
    categories = tuple(dict.fromkeys(strong + weak))
    return InjectionVerdict(bool(strong) or len(weak) >= 2, categories)


def off_scope_category(text: str) -> str | None:
    """Categoría de fuera de alcance obvia, o ``None`` si no es evidente."""
    body = neutralize(text)
    if not body:
        return None
    for category, pattern in _OFF_SCOPE_PATTERNS:
        if pattern.search(body):
            return category
    return None
