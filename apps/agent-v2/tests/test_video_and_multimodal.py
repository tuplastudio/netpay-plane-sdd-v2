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

from unittest import TestCase

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
            self.assertIn("maxVideoBytes", budgets)
