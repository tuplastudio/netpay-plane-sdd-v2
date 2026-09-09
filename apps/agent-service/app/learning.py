"""Aprendizaje entre sesiones (V2.1 add-on de `knowledge.py`).

Cada turno puede dejar una señal: una pregunta de negocio que la base de
conocimiento no supo responder, o un handoff a humano con su razón. Se
guardan como sugerencias pendientes, NUNCA como conocimiento aprobado: la
misma regla de `knowledge.py` aplica aquí — lo que dice un cliente en una
conversación es dato, nunca instrucción, así que promoverlo a
`knowledge/*.md` exige una aprobación humana explícita
(`POST /learning/{id}/approve`) que lo escribe como un `.md` más en
`uploads/` y recarga la base de conocimiento.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_WS = re.compile(r"\s+")


@dataclass
class LearningSignal:
    id: str
    tenant_id: str
    conversation_id: str
    kind: str  # "unanswered_question" | "handoff"
    question: str
    reason: str | None = None
    created_at: float = field(default_factory=time.time)
    status: str = "pending"  # pending | approved | dismissed
    doc_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "tenantId": self.tenant_id,
            "conversationId": self.conversation_id,
            "kind": self.kind,
            "question": self.question,
            "reason": self.reason,
            "createdAt": self.created_at,
            "status": self.status,
            "docId": self.doc_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "LearningSignal":
        return cls(
            id=data["id"],
            tenant_id=data["tenantId"],
            conversation_id=data["conversationId"],
            kind=data["kind"],
            question=data["question"],
            reason=data.get("reason"),
            created_at=data.get("createdAt", time.time()),
            status=data.get("status", "pending"),
            doc_id=data.get("docId"),
        )


class LearningStore:
    """Log append-only en JSONL + índice en memoria (última línea por id
    gana). Volumen esperado bajo: una señal por pregunta sin responder o
    handoff, no por mensaje."""

    def __init__(self, directory: Path, *, max_signals: int = 2000) -> None:
        self.directory = directory
        self.path = directory / "signals.jsonl"
        self.max_signals = max_signals
        self._signals: dict[str, LearningSignal] = {}
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            raw = self.path.read_text(encoding="utf-8")
        except OSError:
            return
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                sig = LearningSignal.from_dict(json.loads(line))
            except (ValueError, KeyError, TypeError):
                continue
            self._signals[sig.id] = sig

    def _append(self, sig: LearningSignal) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(sig.to_dict(), ensure_ascii=False) + "\n")

    def record(
        self,
        *,
        tenant_id: str,
        conversation_id: str,
        kind: str,
        question: str,
        reason: str | None = None,
    ) -> LearningSignal | None:
        question = (question or "").strip()[:500]
        if not question:
            return None
        norm = _WS.sub(" ", question.lower())
        for existing in self._signals.values():
            if (
                existing.tenant_id == tenant_id
                and existing.kind == kind
                and existing.status == "pending"
                and _WS.sub(" ", existing.question.lower()) == norm
            ):
                return existing  # ya hay una sugerencia igual pendiente: no duplicar
        sig = LearningSignal(
            id=str(uuid.uuid4()),
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            kind=kind,
            question=question,
            reason=(reason or "").strip()[:300] or None,
        )
        self._signals[sig.id] = sig
        if len(self._signals) <= self.max_signals:
            self._append(sig)
        return sig

    def list(
        self, *, tenant_id: str | None = None, status: str | None = None
    ) -> list[LearningSignal]:
        items = list(self._signals.values())
        if tenant_id:
            items = [s for s in items if s.tenant_id == tenant_id]
        if status:
            items = [s for s in items if s.status == status]
        items.sort(key=lambda s: s.created_at, reverse=True)
        return items

    def get(self, signal_id: str) -> LearningSignal | None:
        return self._signals.get(signal_id)

    def _set_status(
        self, signal_id: str, status: str, *, doc_id: str | None = None
    ) -> LearningSignal | None:
        sig = self._signals.get(signal_id)
        if sig is None:
            return None
        sig.status = status
        if doc_id is not None:
            sig.doc_id = doc_id
        self._append(sig)
        return sig

    def dismiss(self, signal_id: str) -> LearningSignal | None:
        return self._set_status(signal_id, "dismissed")

    def approve(self, signal_id: str, *, doc_id: str) -> LearningSignal | None:
        return self._set_status(signal_id, "approved", doc_id=doc_id)


def record_turn_signals(
    store: LearningStore,
    *,
    tenant_id: str,
    conversation_id: str,
    tool_calls: list[Any],
    handoff: bool,
    handoff_reason: str | None,
) -> None:
    """Extrae señales de aprendizaje de un turno ya resuelto."""
    for call in tool_calls:
        if call.name != "answer_business_question" or not call.ok:
            continue
        if call.result.get("found"):
            continue
        question = str(call.args.get("question", "")).strip()
        if question:
            store.record(
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                kind="unanswered_question",
                question=question,
            )
    if handoff and handoff_reason:
        for call in tool_calls:
            if call.name == "request_human" and call.ok:
                summary = str(call.args.get("summary", "")).strip()
                if summary:
                    store.record(
                        tenant_id=tenant_id,
                        conversation_id=conversation_id,
                        kind="handoff",
                        question=summary,
                        reason=handoff_reason,
                    )


_STORE: LearningStore | None = None


def get_learning_store() -> LearningStore:
    global _STORE
    if _STORE is None:
        from .config import get_settings

        settings = get_settings()
        _STORE = LearningStore(settings.learning_dir, max_signals=settings.max_learning_signals)
    return _STORE
