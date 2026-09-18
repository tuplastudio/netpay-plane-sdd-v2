"""Configuración compartida de pruebas.

Las variables de entorno se fijan ANTES de importar ``app.*`` porque
``get_settings()`` cachea y ``main.py`` construye el runtime al importar.
Todo apunta a directorios temporales: ningún test toca ``.data/``,
``.settings/`` ni ``knowledge/`` reales. La key de OpenRouter es falsa: ningún
test hace llamadas de red (los modelos se sustituyen por dobles).
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="agent-v2-tests-"))
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("OPENROUTER_API_KEY", "test-key-not-real")
os.environ.setdefault("AGENT_INTERNAL_KEY", "")
os.environ.setdefault("AGENT_V2_DATA_DIR", str(_TMP / "data"))
os.environ.setdefault("KNOWLEDGE_DIR", str(_TMP / "knowledge"))
os.environ.setdefault("AGENT_SETTINGS_DIR", str(_TMP / "settings"))
os.environ.setdefault("AGENT_SCOPE_GUARD", "0")
# La ventana de ráfagas dormiría 1.5 s por cada POST /chat de WhatsApp en
# las pruebas de API; se apaga aquí y se prueba aparte con una ventana corta.
os.environ.setdefault("AGENT_COALESCE_WINDOW_MS", "0")
os.environ.setdefault("PUBLIC_BASE_URL", "https://app.example.test")

import pytest  # noqa: E402
from types import SimpleNamespace  # noqa: E402
from typing import Any  # noqa: E402

from langchain_core.messages import AIMessage, HumanMessage  # noqa: E402
from langgraph.graph.message import add_messages  # noqa: E402


class FakeAgent:
    """Doble del grafo compilado: estado en memoria con los mismos reducers
    que importan para las pruebas (``messages`` usa ``add_messages``)."""

    def __init__(self) -> None:
        self.threads: dict[str, dict[str, Any]] = {}
        self.next_reply: str = "Claro, ¿qué necesitas?"
        self.next_update: dict[str, Any] = {}
        self.raise_on_invoke: Exception | None = None
        # Cuántas invocaciones seguidas deben fallar con `raise_on_invoke`
        # antes de volver a contestar bien (None = fallar siempre). Sirve para
        # probar el reintento por reanudación del pipeline.
        self.raise_times: int | None = None
        self.invocations: list[dict[str, Any]] = []

    @staticmethod
    def _thread(config: dict[str, Any]) -> str:
        return config["configurable"]["thread_id"]

    def seed(self, thread_id: str, **values: Any) -> None:
        self.threads[thread_id] = dict(values)

    async def aget_state(self, config: dict[str, Any]) -> SimpleNamespace:
        return SimpleNamespace(values=dict(self.threads.get(self._thread(config), {})))

    async def aupdate_state(self, config: dict[str, Any], update: dict[str, Any]) -> None:
        values = self.threads.setdefault(self._thread(config), {})
        for key, value in update.items():
            if key == "messages":
                values["messages"] = add_messages(values.get("messages", []), value)
            else:
                values[key] = value

    async def ainvoke(self, payload: dict[str, Any] | None, *, config: dict[str, Any], context: Any = None) -> dict[str, Any]:
        """`payload=None` es "reanuda el checkpoint" (así reintenta el pipeline):
        no agrega el mensaje del cliente otra vez, solo termina el turno."""
        self.invocations.append({"payload": payload, "config": config, "context": context})
        # Como LangGraph: la entrada queda en el checkpoint ANTES de correr
        # el primer nodo, así que una reanudación no la vuelve a agregar.
        if payload is not None:
            await self.aupdate_state(config, {"messages": payload["messages"]})
        if self.raise_on_invoke is not None and (self.raise_times is None or self.raise_times > 0):
            if self.raise_times is not None:
                self.raise_times -= 1
            raise self.raise_on_invoke
        reply = AIMessage(content=self.next_reply)
        await self.aupdate_state(config, {"messages": [reply], **self.next_update})
        return dict(self.threads[self._thread(config)])


class FakeModel:
    """Doble de ``ChatOpenAI``: devuelve respuestas fijas o lanza."""

    def __init__(self, replies: list[str] | None = None, error: Exception | None = None) -> None:
        self.replies = list(replies or [])
        self.error = error
        self.calls: list[Any] = []

    async def ainvoke(self, messages: Any, **_: Any) -> AIMessage:
        self.calls.append(messages)
        if self.error is not None:
            raise self.error
        content = self.replies.pop(0) if self.replies else ""
        return AIMessage(content=content)


@pytest.fixture
def fake_agent() -> FakeAgent:
    return FakeAgent()


@pytest.fixture
def human() -> type[HumanMessage]:
    return HumanMessage


@pytest.fixture
def tmp_root() -> Path:
    return _TMP
