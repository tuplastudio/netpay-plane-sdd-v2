"""Ráfagas de mensajes: varios mensajes seguidos = un solo turno.

En WhatsApp casi nadie escribe un párrafo: escribe "hola", luego "quiero 2
playeras", luego "rojas", en tres mensajes con un segundo entre ellos. Sin
esto, el agente contestaba tres veces —la primera a un "hola" suelto— y la
conversación se sentía a bot que interrumpe. Con esto, cada mensaje espera
`window` desde el ÚLTIMO mensaje del mismo hilo y solo el último de la
ráfaga invoca al modelo, con todos los textos juntos.

Protocolo (`collect`):

- Cada request registra su texto en la ráfaga del hilo y duerme `window`.
- Al despertar, si llegó un mensaje más nuevo, la request **cede**: devuelve
  `None` y el caller responde vacío (`intent="COALESCED"`). Su texto ya
  quedó en la ráfaga; lo contestará el último.
- Si nadie llegó después, la request **cierra** la ráfaga: recibe todos los
  textos en orden de llegada y sigue con el turno normal.

Queda fuera de la ráfaga (se procesa directo) lo que no es texto encadenable:
imágenes, y cualquier canal que no esté en `AGENT_COALESCE_CHANNELS`. Una
`messageId` repetida (reintento de webhook) debe resolverse por idempotencia
ANTES de entrar aquí; si no, el reintento se pegaría al turno como texto
duplicado.

La ventana no toca el lock por hilo: quien cierra la ráfaga es quien lo
toma, así que una ráfaga nueva puede empezar mientras el turno anterior del
mismo cliente todavía corre.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Generic, TypeVar

T = TypeVar("T")


@dataclass
class _Burst(Generic[T]):
    items: list[T] = field(default_factory=list)
    seq: int = 0


class MessageCoalescer(Generic[T]):
    def __init__(self, window_ms: int) -> None:
        self.window_seconds = max(0, int(window_ms)) / 1000.0
        self._bursts: dict[str, _Burst[T]] = {}
        self._guard = asyncio.Lock()

    @property
    def enabled(self) -> bool:
        return self.window_seconds > 0

    def pending(self, thread_id: str) -> int:
        """Cuántos mensajes esperan en la ráfaga de ese hilo (diagnóstico)."""
        burst = self._bursts.get(thread_id)
        return len(burst.items) if burst else 0

    async def collect(self, thread_id: str, item: T) -> list[T] | None:
        """Registra `item` y espera la ventana.

        Devuelve la lista completa de la ráfaga (este item incluido, en orden
        de llegada) si esta request es la que debe contestar, o `None` si
        llegó algo más nuevo y esta request debe ceder.
        """
        if not self.enabled:
            return [item]
        async with self._guard:
            burst = self._bursts.setdefault(thread_id, _Burst())
            burst.items.append(item)
            burst.seq += 1
            my_seq = burst.seq
        await asyncio.sleep(self.window_seconds)
        async with self._guard:
            burst = self._bursts.get(thread_id)
            if burst is None or burst.seq != my_seq:
                return None
            del self._bursts[thread_id]
            return list(burst.items)
