"""Pruebas HTTP: autenticación de servicio, subida de conocimiento y
aprendizaje entre sesiones (hardening de seguridad de agent-service).
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import knowledge as knowledge_module
from app import learning as learning_module
from app import main as main_module
from app.knowledge import KnowledgeBase
from app.learning import LearningStore


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(
        main_module, "settings", replace(main_module.settings, internal_key="test-secret")
    )
    monkeypatch.setattr(knowledge_module, "_KB", KnowledgeBase(tmp_path / "knowledge"))
    monkeypatch.setattr(learning_module, "_STORE", LearningStore(tmp_path / "learning"))
    return TestClient(main_module.app)


AUTH = {"X-Internal-Key": "test-secret"}


def test_healthz_is_public(client: TestClient) -> None:
    assert client.get("/healthz").status_code == 200


def test_protected_route_without_key_is_rejected(client: TestClient) -> None:
    resp = client.get("/knowledge")
    assert resp.status_code == 401


def test_protected_route_with_wrong_key_is_rejected(client: TestClient) -> None:
    resp = client.get("/knowledge", headers={"X-Internal-Key": "wrong"})
    assert resp.status_code == 401


def test_protected_route_with_correct_key_succeeds(client: TestClient) -> None:
    resp = client.get("/knowledge", headers=AUTH)
    assert resp.status_code == 200


def test_open_service_without_configured_key_allows_requests(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Sin AGENT_INTERNAL_KEY_REF el servicio degrada a abierto (igual que
    sin AGENT_API_KEY_REF), documentado como advertencia en /readyz."""
    monkeypatch.setattr(main_module, "settings", replace(main_module.settings, internal_key=""))
    monkeypatch.setattr(knowledge_module, "_KB", KnowledgeBase(tmp_path / "knowledge"))
    monkeypatch.setattr(learning_module, "_STORE", LearningStore(tmp_path / "learning"))
    resp = TestClient(main_module.app).get("/readyz")
    assert resp.status_code == 200
    assert any("AGENT_INTERNAL_KEY_REF" in w for w in resp.json()["warnings"])


def test_upload_md_is_indexed_and_searchable(client: TestClient) -> None:
    resp = client.post(
        "/knowledge/upload",
        headers=AUTH,
        files={"file": ("garantias.md", b"# Garantias\n\nCubrimos 90 dias.\n", "text/markdown")},
    )
    assert resp.status_code == 200
    assert resp.json()["docId"] == "uploads/garantias.md"

    hits = client.get("/knowledge/search", params={"q": "garantia"}, headers=AUTH).json()["hits"]
    assert any("garantias.md" in h["doc"] for h in hits)


def test_upload_rejects_non_md_extension(client: TestClient) -> None:
    resp = client.post(
        "/knowledge/upload",
        headers=AUTH,
        files={"file": ("script.exe", b"MZ", "application/octet-stream")},
    )
    assert resp.status_code == 400


def test_upload_sanitizes_path_traversal(client: TestClient) -> None:
    resp = client.post(
        "/knowledge/upload",
        headers=AUTH,
        files={"file": ("../../../etc/passwd.md", b"contenido", "text/markdown")},
    )
    assert resp.status_code == 200
    doc_id = resp.json()["docId"]
    assert doc_id == "uploads/passwd.md"  # nunca sale de uploads/


def test_upload_rejects_readme_override(client: TestClient) -> None:
    resp = client.post(
        "/knowledge/upload",
        headers=AUTH,
        files={"file": ("README.md", b"hola", "text/markdown")},
    )
    assert resp.status_code == 400


def test_delete_only_reaches_uploads(client: TestClient) -> None:
    client.post(
        "/knowledge/upload",
        headers=AUTH,
        files={"file": ("temporal.md", b"# T\n\nx\n", "text/markdown")},
    )
    ok = client.delete("/knowledge/uploads/temporal.md", headers=AUTH)
    assert ok.status_code == 200

    curated = client.delete("/knowledge/negocio.md", headers=AUTH)
    assert curated.status_code == 400


def test_learning_signal_recorded_on_unanswered_question(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.tools import ToolCallRecord
    from app.learning import record_turn_signals

    calls = [
        ToolCallRecord(
            name="answer_business_question",
            args={"question": "¿Hacen envíos a Guatemala?"},
            ok=True,
            result={"found": False, "sections": []},
            latency_ms=5,
        )
    ]
    record_turn_signals(
        learning_module.get_learning_store(),
        tenant_id="t1",
        conversation_id="c1",
        tool_calls=calls,
        handoff=False,
        handoff_reason=None,
    )
    resp = client.get("/learning/signals", headers=AUTH, params={"tenantId": "t1"})
    signals = resp.json()["signals"]
    assert len(signals) == 1
    assert signals[0]["question"] == "¿Hacen envíos a Guatemala?"
    assert signals[0]["status"] == "pending"


def test_learning_signal_approve_writes_knowledge_doc(client: TestClient) -> None:
    sig = learning_module.get_learning_store().record(
        tenant_id="t1",
        conversation_id="c1",
        kind="unanswered_question",
        question="¿Aceptan pagos en USD?",
    )
    resp = client.post(
        f"/learning/signals/{sig.id}/approve",
        headers=AUTH,
        json={"answer": "Sí, aceptamos USD en sucursales fronterizas."},
    )
    assert resp.status_code == 200
    doc_id = resp.json()["docId"]
    assert doc_id.startswith("uploads/")

    hits = client.get("/knowledge/search", params={"q": "USD pagos"}, headers=AUTH).json()["hits"]
    assert any(h["doc"] == doc_id for h in hits)

    listed = client.get("/learning/signals", headers=AUTH, params={"tenantId": "t1"}).json()
    assert listed["signals"][0]["status"] == "approved"


def test_learning_signal_dismiss(client: TestClient) -> None:
    sig = learning_module.get_learning_store().record(
        tenant_id="t1", conversation_id="c1", kind="unanswered_question", question="¿Tienen tienda en CDMX?"
    )
    resp = client.post(f"/learning/signals/{sig.id}/dismiss", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()["status"] == "dismissed"
