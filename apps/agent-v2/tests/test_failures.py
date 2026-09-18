"""Política de fallos del turno (`app/pipeline/failures.py`)."""

from __future__ import annotations

import asyncio

import httpx
import pytest
from langgraph.errors import GraphRecursionError

from app.pipeline.failures import (
    HANDOFF_FAILURE_REPLY,
    SOFT_FAILURE_REPLY,
    FailureKind,
    classify_failure,
    decide_failure,
)


class _StatusError(Exception):
    def __init__(self, status: int) -> None:
        super().__init__(f"status {status}")
        self.status_code = status


class RateLimitError(Exception):
    """Mismo nombre que la del SDK de OpenAI: se clasifica por nombre."""


@pytest.mark.parametrize(
    ("exc", "kind"),
    [
        (asyncio.TimeoutError(), FailureKind.TIMEOUT),
        (TimeoutError(), FailureKind.TIMEOUT),
        (GraphRecursionError("loop"), FailureKind.RECURSION_LIMIT),
        (httpx.ConnectError("refused"), FailureKind.TRANSIENT),
        (httpx.ReadTimeout("slow"), FailureKind.TRANSIENT),
        (_StatusError(502), FailureKind.TRANSIENT),
        (_StatusError(429), FailureKind.TRANSIENT),
        (_StatusError(401), FailureKind.FATAL),
        (RateLimitError("slow down"), FailureKind.TRANSIENT),
        (KeyError("variantId"), FailureKind.FATAL),
        (RuntimeError("bug"), FailureKind.FATAL),
    ],
)
def test_classify_failure(exc: BaseException, kind: FailureKind) -> None:
    assert classify_failure(exc) is kind


def test_classify_failure_looks_through_wrapping() -> None:
    try:
        try:
            raise httpx.ConnectError("refused")
        except httpx.ConnectError as inner:
            raise RuntimeError("model call failed") from inner
    except RuntimeError as wrapped:
        assert classify_failure(wrapped) is FailureKind.TRANSIENT


def test_only_transient_is_retryable_and_recursion_always_hands_off() -> None:
    assert FailureKind.TRANSIENT.retryable
    assert not FailureKind.TIMEOUT.retryable and not FailureKind.FATAL.retryable
    assert FailureKind.RECURSION_LIMIT.always_handoff
    assert not FailureKind.TRANSIENT.always_handoff


def test_decide_failure_soft_then_handoff() -> None:
    first = decide_failure(FailureKind.TRANSIENT, 0, handoff_after=2)
    assert first.streak == 1 and first.handoff is False
    assert first.reply == SOFT_FAILURE_REPLY and first.engine == "error-soft"
    assert first.intent == "PROVEEDOR_TRANSITORIO"

    second = decide_failure(FailureKind.TIMEOUT, first.streak, handoff_after=2)
    assert second.streak == 2 and second.handoff is True
    assert second.reply == HANDOFF_FAILURE_REPLY and second.engine == "error-fallback"
    assert second.intent == "TIMEOUT"


def test_decide_failure_threshold_one_restores_old_behaviour() -> None:
    assert decide_failure(FailureKind.FATAL, 0, handoff_after=1).handoff is True
    # Un valor inválido (0) se trata como 1: nunca se queda sin handoff.
    assert decide_failure(FailureKind.FATAL, 0, handoff_after=0).handoff is True


def test_decide_failure_recursion_hands_off_on_first_strike() -> None:
    decision = decide_failure(FailureKind.RECURSION_LIMIT, 0, handoff_after=5)
    assert decision.handoff is True and decision.streak == 1
