"""Capa de seguridad del agente v2: autorización y saneo de datos no confiables.

Todo lo que puede llegar aquí influido por alguien fuera del equipo —el texto
del cliente de WhatsApp, títulos y notas que vienen del catálogo/backend— se
trata como dato, nunca como instrucción. El prompt (`prompts.py`) ya se lo
dice al modelo; esto es la segunda capa, la que no depende de que el modelo
obedezca: acota tamaños, quita Unicode invisible usado para camuflar texto, y
evita que errores de infraestructura salgan con detalles internos.

El tenant y los scopes de una tool SIEMPRE vienen de `runtime.context`
(armado en `main.py` a partir de la request HTTP), nunca de argumentos que
decide el modelo ni del texto del cliente.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from .config import Settings, get_settings

# ---------------------------------------------------------------- scopes


TOOL_SCOPES: dict[str, str] = {
    "buscar_productos": "catalog.read",
    "agregar_al_carrito": "catalog.read",
    "quitar_del_carrito": "catalog.read",
    "calcular_total": "quotes.read",
    "calcular_unidades_para_cubrir": "catalog.read",
    "emitir_cotizacion": "quotes.write",
    "convertir_en_pedido": "orders.write",
    "generar_enlace_pago": "orders.write",
    "estado_del_pedido": "orders.read",
    "recordar_cliente": "chat.write",
    "historial_del_cliente": "customers.read",
    "detalle_de_cotizacion": "quotes.read",
    "solicitar_factura": "orders.write",
    "escalar_a_humano": "chat.write",
}


def require_scope(scopes: Any, tool_name: str) -> str | None:
    """Devuelve un mensaje de rechazo si `tool_name` necesita un scope que no
    está en `scopes`, o None si puede seguir.

    Toda tool con efecto debe llamar esto con los scopes que vienen de
    `runtime.context["scopes"]` — jamás con algo que el modelo pueda decidir.
    """
    needed = TOOL_SCOPES.get(tool_name)
    if not needed:
        return None
    if needed in set(scopes or []):
        return None
    return f"Sin permiso: esta operación requiere el scope {needed}."


# ---------------------------------------------------------------- saneo de texto

# Caracteres de formato Unicode que no aportan nada a un mensaje comercial
# legítimo pero sí sirven para esconder instrucciones de la vista humana
# (zero-width, overrides de dirección bidi, BOM) sin ocultarlas del modelo.
# Se listan por código de escape (no como glifo literal) para que el rango
# quede legible y no dependa de caracteres invisibles en el propio archivo.
_HIDDEN_UNICODE_RANGES = (
    (0x00AD, 0x00AD),  # soft hyphen
    (0x200B, 0x200F),  # zero-width space/joiners, marcas de dirección
    (0x202A, 0x202E),  # embeddings/overrides de dirección (bidi)
    (0x2060, 0x206F),  # separadores y formato invisibles
    (0xFEFF, 0xFEFF),  # BOM
)
_HIDDEN_UNICODE_RE = re.compile(
    "[" + "".join(f"\\U{lo:08x}-\\U{hi:08x}" for lo, hi in _HIDDEN_UNICODE_RANGES) + "]"
)
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
_UUID_RE = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.IGNORECASE
)


def strip_hidden_unicode(value: str) -> str:
    if not value:
        return value
    value = unicodedata.normalize("NFKC", value)
    value = _HIDDEN_UNICODE_RE.sub("", value)
    return _CONTROL_RE.sub("", value)


def clamp_text(value: str | None, max_len: int, *, collapse_newlines: bool = False) -> str:
    """Recorta y limpia texto libre antes de guardarlo en el estado o de
    mandarlo al modelo como resultado de una tool.

    `collapse_newlines=True` para campos que deben ser una sola línea
    (nombre, correo, motivo de escalamiento): sin esto, alguien podría meter
    saltos de línea para simular dentro de un solo argumento un mensaje de
    "sistema" o un turno de conversación que nunca ocurrió.
    """
    text = strip_hidden_unicode((value or "").strip())
    if collapse_newlines:
        text = " ".join(text.split())
    return text[:max_len]


def sanitize_error_message(message: str, settings: Settings | None = None) -> str:
    """Limpia errores de commerce-api/red antes de que lleguen al modelo (y de
    ahí, potencialmente, a la respuesta del cliente): sin URLs internas, sin
    ids que sirvan para pescar otros registros, sin credenciales."""
    settings = settings or get_settings()
    text = clamp_text(message, 240, collapse_newlines=True)
    text = _URL_RE.sub("[url]", text)
    text = _UUID_RE.sub("[id]", text)
    for secret in (settings.commerce_api_key, settings.openrouter_key, settings.internal_key):
        if secret:
            text = text.replace(secret, "[secreto]")
    return text or "error interno"


# ---------------------------------------------------------------- entrada multimedia


def image_size_error(image_b64: str | None, settings: Settings | None = None) -> str | None:
    """Valida el tamaño de una imagen en base64 antes de mandarla al modelo.

    v1 limitaba audio con `max_audio_bytes`; v2 no tenía tope para
    `imageBase64`, así que un cliente podía mandar una imagen arbitrariamente
    grande y encarecer (o tumbar) cada turno. Se expone aquí porque la
    request HTTP se arma en `main.py`: falta cablear la llamada ahí, antes de
    construir el mensaje multimodal.
    """
    if not image_b64:
        return None
    settings = settings or get_settings()
    # Tamaño real ≈ 3/4 del base64 (sin decodificar, que ya sería tarde para
    # rechazar algo demasiado grande).
    approx_bytes = (len(image_b64) * 3) // 4
    if approx_bytes > settings.max_image_bytes:
        limit_mb = settings.max_image_bytes / (1024 * 1024)
        return f"La imagen es muy pesada (máximo {limit_mb:.1f} MB)."
    return None


def video_size_error(video_b64: str | None, settings: Settings | None = None) -> str | None:
    """Valida el tamaño de un video en base64 antes de mandarlo al modelo.

    Mismo razonamiento que `image_size_error`: si el video entra al modelo
    sin tope, un cliente puede mandar varios minutos y encarecer o tumbar
    el turno. Los videos pesan mucho más que las imágenes (tope por
    defecto 50 MB vs 5 MB). Para videos por URL no se valida acá — el
    proveedor (Gemini) los descarga y rechaza si son demasiado largos;
    ese error vuelve como CommerceUnavailable y el pipeline lo degrada.
    """
    if not video_b64:
        return None
    settings = settings or get_settings()
    approx_bytes = (len(video_b64) * 3) // 4
    if approx_bytes > settings.max_video_bytes:
        limit_mb = settings.max_video_bytes / (1024 * 1024)
        return f"El video es muy pesado (máximo {limit_mb:.1f} MB)."
    return None


def media_size_error(
    image_b64: str | None,
    video_b64: str | None,
    settings: Settings | None = None,
) -> str | None:
    """Tope único para ambos — el pipeline llama uno solo en lugar de dos."""
    return image_size_error(image_b64, settings) or video_size_error(video_b64, settings)
