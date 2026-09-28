"""Video + imagen en POST /chat, capabilities de modelos, defaults multimodales.

Cubre:
- `ChatRequest` acepta `videoUrl`, `videoBase64`, `videoMimeType` y los pasa
  al pipeline.
- `media_size_error` rechaza video/imagen demasiado pesados ANTES de invocar
  al modelo.
- `model_capabilities` clasifica Gemini (video), GPT-4o (solo imagen),
  Claude (solo imagen) y modelos desconocidos (solo texto).
- `Settings` valida el orden de los timeouts (texto < imagen < video).
"""

from __future__ import annotations

from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch

from app.agent import model_capabilities
from app.config import Settings, SettingsError
from app.contracts import ChatRequest
from app.security import (
    image_size_error,
    media_size_error,
    video_size_error,
)


class ModelCapabilitiesTests(TestCase):
    def test_gemini_supports_video(self):
        caps = model_capabilities("google/gemini-2.0-flash-001")
        self.assertEqual(caps, {"text": True, "multimodal": True, "video": True, "audio": True})

    def test_gpt4o_supports_image_not_video(self):
        caps = model_capabilities("openai/gpt-4o-mini")
        self.assertTrue(caps["multimodal"])
        self.assertFalse(caps["video"])
        self.assertFalse(caps["audio"])

    def test_claude_supports_image_not_video(self):
        caps = model_capabilities("anthropic/claude-3-5-sonnet")
        self.assertTrue(caps["multimodal"])
        self.assertFalse(caps["video"])

    def test_unknown_model_is_text_only(self):
        caps = model_capabilities("custom/local-model")
        self.assertEqual(caps, {"text": True, "multimodal": False, "video": False, "audio": False})

    def test_empty_or_none_safe(self):
        for model in ("", None):
            caps = model_capabilities(model)  # type: ignore[arg-type]
            self.assertTrue(caps["text"])
            self.assertFalse(caps["video"])


class VideoRequestTests(TestCase):
    def test_video_url_only(self):
        req = ChatRequest(
            tenantId="t1",
            text="qué es esto?",
            videoUrl="https://example.com/clip.mp4",
        )
        self.assertEqual(req.videoUrl, "https://example.com/clip.mp4")
        self.assertIsNone(req.videoBase64)
        self.assertEqual(req.videoMimeType, "video/mp4")  # default

    def test_video_base64_with_custom_mime(self):
        req = ChatRequest(
            tenantId="t1",
            text="mira este video",
            videoBase64="AAAA",
            videoMimeType="video/webm",
        )
        self.assertEqual(req.videoBase64, "AAAA")
        self.assertEqual(req.videoMimeType, "video/webm")

    def test_image_and_video_together(self):
        """Foto + video + texto en el mismo turno: ambos llegan al pipeline."""
        req = ChatRequest(
            tenantId="t1",
            text="qué son?",
            imageBase64="IMG",
            videoUrl="https://example.com/clip.mp4",
        )
        self.assertTrue(req.imageBase64)
        self.assertTrue(req.videoUrl)

    def test_backward_compat_without_video(self):
        """v1 mandaba solo `imageBase64` — sigue siendo válido sin video."""
        req = ChatRequest(tenantId="t1", text="hola", imageBase64="IMG")
        self.assertIsNone(req.videoBase64)
        self.assertIsNone(req.videoUrl)


class MediaSizeErrorTests(TestCase):
    def test_image_too_large(self):
        settings = Settings(max_image_bytes=100)
        big = "A" * 200  # ~150 bytes decoded
        err = image_size_error(big, settings)
        self.assertIsNotNone(err)
        self.assertIn("muy pesada", err)

    def test_image_within_limit(self):
        settings = Settings(max_image_bytes=10_000)
        self.assertIsNone(image_size_error("A" * 10, settings))

    def test_video_too_large(self):
        settings = Settings(max_video_bytes=100)
        big = "A" * 200
        err = video_size_error(big, settings)
        self.assertIsNotNone(err)
        self.assertIn("muy pesado", err)

    def test_video_within_limit(self):
        settings = Settings(max_video_bytes=10_000)
        self.assertIsNone(video_size_error("A" * 10, settings))

    def test_media_returns_first_failure(self):
        """`media_size_error` chequea imagen y video y devuelve el primer error."""
        settings = Settings(max_image_bytes=10, max_video_bytes=10)
        # Imagen excedida (pero video OK)
        self.assertIn("muy pesada", media_size_error("A" * 100, None, settings) or "")
        # Video excedido (pero imagen OK)
        self.assertIn("muy pesado", media_size_error(None, "A" * 100, settings) or "")
        # Ambos OK
        self.assertIsNone(media_size_error(None, None, settings))


class SettingsValidationTests(TestCase):
    def test_video_timeout_must_exceed_image_timeout(self):
        with self.assertRaises(SettingsError) as cm:
            # Video < image viola la regla. Texto < imagen OK.
            Settings(
                turn_timeout_seconds=10.0,
                turn_timeout_image_seconds=20.0,
                turn_timeout_video_seconds=15.0,
            )
        self.assertIn("VIDEO", str(cm.exception))

    def test_video_timeout_must_be_positive(self):
        with self.assertRaises(SettingsError):
            Settings(turn_timeout_video_seconds=0.0)

    def test_max_video_bytes_must_be_positive(self):
        with self.assertRaises(SettingsError):
            Settings(max_video_bytes=0)

    def test_default_video_timeout_is_above_image(self):
        s = Settings()
        self.assertGreater(s.turn_timeout_video_seconds, s.turn_timeout_image_seconds)
        self.assertGreater(s.turn_timeout_image_seconds, s.turn_timeout_seconds)

    def test_default_max_video_bytes_is_above_image(self):
        s = Settings()
        self.assertGreater(s.max_video_bytes, s.max_image_bytes)


class VideoBudgetSelectionTests(TestCase):
    """`_turn_budget` del pipeline elige el timeout correcto según el contenido."""

    def setUp(self):
        from app.config import get_settings
        from app.runtime import Runtime

        self.runtime = Runtime(get_settings())
        from app.pipeline.turn import TurnPipeline

        self.pipeline = TurnPipeline(self.runtime, get_settings())

    def test_text_only(self):
        req = ChatRequest(tenantId="t1", text="hola")
        self.assertEqual(
            self.pipeline._turn_budget(req),
            self.runtime.settings.turn_timeout_seconds,
        )

    def test_image_extends_budget(self):
        req = ChatRequest(tenantId="t1", text="hola", imageBase64="x")
        self.assertEqual(
            self.pipeline._turn_budget(req),
            self.runtime.settings.turn_timeout_image_seconds,
        )

    def test_video_extends_budget_further(self):
        req = ChatRequest(tenantId="t1", text="hola", videoUrl="https://x/y.mp4")
        self.assertEqual(
            self.pipeline._turn_budget(req),
            self.runtime.settings.turn_timeout_video_seconds,
        )

    def test_video_base64_also_uses_video_budget(self):
        req = ChatRequest(tenantId="t1", text="hola", videoBase64="AAAA")
        self.assertEqual(
            self.pipeline._turn_budget(req),
            self.runtime.settings.turn_timeout_video_seconds,
        )


class DiagnosticsIncludesCapabilitiesTests(TestCase):
    def test_diagnostics_reports_model_capabilities(self):
        from fastapi.testclient import TestClient

        from app import main

        with TestClient(main.app) as client:
            diag = client.get("/diagnostics").json()
            self.assertIn("modelCapabilities", diag)
            caps = diag["modelCapabilities"]
            self.assertIn("video", caps)
            self.assertIn("audio", caps)
            self.assertIn("multimodal", caps)

    def test_diagnostics_includes_video_budget(self):
        from fastapi.testclient import TestClient

        from app import main

        with TestClient(main.app) as client:
            diag = client.get("/diagnostics").json()
            budgets = diag["budgets"]
            self.assertIn("turnTimeoutVideoSeconds", budgets)


class DiagnosticsTenantAwareTests(TestCase):
    """`/diagnostics` y `/readyz` reflejan el estado EFECTIVO del tenant:
    con OPENROUTER_KEY_REF global vacía, un tenant con su propia key en
    `AgentSettings` debe seguir apareciendo como LLM vivo.

    El endpoint también expone `commerce` y `knowledge` en la forma
    v1 que el chat web espera (`{docs, chunks, business}` y
    `{configured, ok}`). Antes (cuando el chat leía `/healthz` de v2 que
    solo traía `{status, version}`) esas dos pantallas estaban rotas."""

    def test_diagnostics_exposes_commerce_and_knowledge(self):
        from fastapi.testclient import TestClient

        from app import main

        with TestClient(main.app) as client:
            diag = client.get("/diagnostics?tenantId=t-tenant").json()
            self.assertIn("commerce", diag)
            self.assertIn("configured", diag["commerce"])
            self.assertIn("ok", diag["commerce"])
            self.assertIn("knowledge", diag)
            self.assertIn("docs", diag["knowledge"])
            self.assertIn("chunks", diag["knowledge"])
            self.assertIn("business", diag["knowledge"])
            self.assertIsInstance(diag["knowledge"]["docs"], int)
            self.assertIsInstance(diag["knowledge"]["chunks"], int)
            self.assertIsInstance(diag["knowledge"]["business"], str)

    def test_tenant_key_makes_llm_live_even_without_global_key(self):
        from fastapi.testclient import TestClient

        from app import main
        from app.agent_settings import AgentSettings, get_settings_store

        # Sembramos un tenant con key propia. El global queda vacío (el
        # conftest setea OPENROUTER_API_KEY=test-key pero el diagnóstico
        # tenant-aware debe chequear la del tenant).
        store = get_settings_store()
        store.update(
            "t-tenant",
            {
                "openrouter_api_key_set": True,
                "openrouter_api_key": "sk-or-v1-tenant-test",
            },
        )

        with TestClient(main.app) as client:
            res = client.get("/diagnostics?tenantId=t-tenant")
            self.assertEqual(res.status_code, 200)
            diag = res.json()
            # La key del tenant cuenta aunque la global esté vacía.
            self.assertTrue(diag["llm"]["live"])
            self.assertEqual(diag["llm"]["keySource"], "tenant")
            self.assertTrue(diag["llm"]["tenantKeySet"])
            # El modelo efectivo está al top level (con override del tenant
            # si lo hay; aquí solo cambiamos la key).
            self.assertIn("model", diag)
            # Y el capabilities reporta text/multimodal/etc.
            self.assertIn("multimodal", diag["modelCapabilities"])

    def test_no_keys_anywhere_marks_llm_off(self):
        from fastapi.testclient import TestClient

        from app import main
        from app.agent_settings import AgentSettings, get_settings_store

        # Limpiamos la del tenant explícitamente.
        store = get_settings_store()
        store.update("t-nokey", {"openrouter_api_key": ""})

        with TestClient(main.app) as client:
            res = client.get("/diagnostics?tenantId=t-nokey")
            diag = res.json()
            # Si la global está vacía en este test y el tenant no tiene
            # key, llm.live debe ser false y keySource=none.
            if not diag["llm"].get("globalKeySet"):
                self.assertFalse(diag["llm"]["live"])
                self.assertEqual(diag["llm"]["keySource"], "none")
            else:
                # Con global seteada por el conftest, keySource = global y
                # live = True (el global cubre a todos los tenants que no
                # tengan propia).
                self.assertTrue(diag["llm"]["live"])
                self.assertEqual(diag["llm"]["keySource"], "global")
            # tenantKeySet refleja lo que el tenant configuró en su panel.
            self.assertFalse(diag["llm"]["tenantKeySet"])

    def test_global_key_only_covers_tenants_without_own(self):
        from fastapi.testclient import TestClient

        from app import main
        from app.agent_settings import get_settings_store

        store = get_settings_store()
        store.update("t-noglobal-tenant", {"openrouter_api_key": ""})

        with TestClient(main.app) as client:
            res = client.get("/diagnostics?tenantId=t-noglobal-tenant")
            diag = res.json()
            # Con global seteada por el conftest y tenant sin key propia:
            # live=True, source=global.
            if diag["llm"].get("globalKeySet"):
                self.assertTrue(diag["llm"]["live"])
                self.assertEqual(diag["llm"]["keySource"], "global")
                self.assertFalse(diag["llm"]["tenantKeySet"])
            # Sanity: el diagnostics sigue trayendo budgets aunque el LLM esté vivo.
            self.assertIn("maxVideoBytes", diag["budgets"])


class VideoDegradesForTextOnlyModelTests(IsolatedAsyncioTestCase):
    """Un tenant con `text_model` sin soporte de video no debe mandar el
    video al proveedor (gasta una llamada que el proveedor rechaza sin
    pista de la causa) — se degrada a texto con un aviso."""

    async def test_video_dropped_when_model_lacks_support(self) -> None:
        from fastapi.testclient import TestClient

        from app import main
        from app.agent_settings import get_settings_store
        from app.contracts import ChatRequest
        from app.pipeline.trace import TurnTrace
        from app.pipeline.turn import PipelineContext

        store = get_settings_store()
        store.update("t-video-degrade", {"text_model": "openai/gpt-4o-mini"})
        with TestClient(main.app):
            pipeline = main.runtime.pipeline
            assert pipeline is not None
            ctx = PipelineContext(
                req=ChatRequest(
                    tenantId="t-video-degrade",
                    conversationId="s1",
                    text="qué es esto?",
                    videoUrl="https://example.com/clip.mp4",
                    channel="web",
                ),
                rt=main.runtime,
                settings=pipeline.settings,
                trace=TurnTrace(),
            )
            await pipeline._prepare(ctx)
            self.assertEqual(ctx.content, ctx.text)
            self.assertIn("no puede verlo", ctx.text)

    async def test_video_kept_when_model_supports_it(self) -> None:
        from fastapi.testclient import TestClient

        from app import main
        from app.agent_settings import get_settings_store
        from app.contracts import ChatRequest
        from app.pipeline.trace import TurnTrace
        from app.pipeline.turn import PipelineContext

        store = get_settings_store()
        store.update("t-video-ok", {"text_model": "google/gemini-2.0-flash-001"})
        with TestClient(main.app):
            pipeline = main.runtime.pipeline
            assert pipeline is not None
            ctx = PipelineContext(
                req=ChatRequest(
                    tenantId="t-video-ok",
                    conversationId="s1",
                    text="qué es esto?",
                    videoUrl="https://example.com/clip.mp4",
                    channel="web",
                ),
                rt=main.runtime,
                settings=pipeline.settings,
                trace=TurnTrace(),
            )
            await pipeline._prepare(ctx)
            assert isinstance(ctx.content, list)
            self.assertTrue(any(b.get("image_url", {}).get("url") == "https://example.com/clip.mp4" for b in ctx.content))


class AudioTranscriptionFallbackTests(IsolatedAsyncioTestCase):
    """Defensa en profundidad: `audioBase64` sin `text` se transcribe en
    `_prepare` en vez de rebotar con 400 (ver `pipeline/turn.py`)."""

    def setUp(self) -> None:
        from fastapi.testclient import TestClient

        from app import main

        self._client_cm = TestClient(main.app)
        self._client_cm.__enter__()
        self._main = main

    def tearDown(self) -> None:
        self._client_cm.__exit__(None, None, None)

    async def _ctx(self, **req_kwargs):
        from app.contracts import ChatRequest
        from app.pipeline.trace import TurnTrace
        from app.pipeline.turn import PipelineContext

        main = self._main
        pipeline = main.runtime.pipeline
        assert pipeline is not None
        ctx = PipelineContext(
            req=ChatRequest(tenantId="t-audio", conversationId="s1", channel="web", **req_kwargs),
            rt=main.runtime,
            settings=pipeline.settings,
            trace=TurnTrace(),
        )
        return pipeline, ctx

    async def test_transcribes_when_no_text(self) -> None:
        import base64

        pipeline, ctx = await self._ctx(audioBase64=base64.b64encode(b"audio").decode())
        with patch("app.pipeline.turn.transcribe", new=AsyncMock(return_value={"text": "quiero pintura blanca"})):
            await pipeline._prepare(ctx)
        self.assertEqual(ctx.text, "quiero pintura blanca")

    async def test_rejects_when_transcription_empty(self) -> None:
        import base64

        from app.pipeline.turn import TurnRejected

        pipeline, ctx = await self._ctx(audioBase64=base64.b64encode(b"audio").decode())
        with patch("app.pipeline.turn.transcribe", new=AsyncMock(return_value={"text": ""})):
            with self.assertRaises(TurnRejected) as cm:
                await pipeline._prepare(ctx)
        self.assertEqual(cm.exception.status, 400)

    async def test_maps_audio_unavailable_to_503(self) -> None:
        from app.audio import AudioUnavailable
        from app.pipeline.turn import TurnRejected

        pipeline, ctx = await self._ctx(audioBase64="YQ==")
        with patch("app.pipeline.turn.transcribe", new=AsyncMock(side_effect=AudioUnavailable("caído"))):
            with self.assertRaises(TurnRejected) as cm:
                await pipeline._prepare(ctx)
        self.assertEqual(cm.exception.status, 503)

    async def test_text_wins_over_audio_when_both_present(self) -> None:
        pipeline, ctx = await self._ctx(text="hola", audioBase64="YQ==")
        with patch("app.pipeline.turn.transcribe", new=AsyncMock(side_effect=AssertionError("no debió llamarse"))):
            await pipeline._prepare(ctx)
        self.assertEqual(ctx.text, "hola")
