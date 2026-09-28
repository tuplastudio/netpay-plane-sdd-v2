"""Formato de salida por canal."""

import re

_UUID_RE = re.compile(r"\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)


def format_for_whatsapp(reply: str) -> str:
    """Markdown de chat web -> texto plano de WhatsApp.

    El modelo escribe **negritas**, viñetas y enlaces markdown aunque se le
    pida lo contrario; en WhatsApp eso se ve como asteriscos y corchetes
    sueltos. Se normaliza aquí en vez de confiar solo en el prompt.
    """
    text = reply
    text = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", r"\1: \2", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"*\1*", text)
    text = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", text)
    text = re.sub(r"(?m)^\s*[-*•]\s+", "• ", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = _UUID_RE.sub(lambda m: m.group(1), text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()
