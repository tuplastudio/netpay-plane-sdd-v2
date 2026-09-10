from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from app.commerce import CommerceClient
from app.config import Settings
from app import knowledge


class MultitenancyTests(TestCase):
    def test_commerce_headers_bind_tenant_to_signed_request(self) -> None:
        settings = Settings(internal_key="shared-secret", commerce_api_key="legacy-key")
        with patch("app.commerce.time.time", return_value=1_700_000_000):
            headers = CommerceClient(settings, tenant_id="tenant-a")._auth_headers()

        self.assertEqual(
            headers,
            {
                "x-agent-tenant": "tenant-a",
                "x-agent-timestamp": "1700000000",
                "x-agent-signature": "05d55940838c5b502dfdddfa46bd72e418fae365d8cad3220fad53811fb653ac",
            },
        )
        self.assertNotIn("authorization", headers)

    def test_root_legacy_knowledge_is_not_shared_with_other_tenants(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "negocio.md").write_text(
                "---\nnegocio: Empresa A\n---\nSecreto comercial de A", encoding="utf-8"
            )
            tenant_b = root / "tenants" / "tenant-b"
            tenant_b.mkdir(parents=True)
            (tenant_b / "negocio.md").write_text(
                "---\nnegocio: Empresa B\n---\nPolítica exclusiva de B", encoding="utf-8"
            )

            knowledge._CACHE.clear()
            fake_settings = SimpleNamespace(knowledge_dir=root)
            with patch("app.knowledge.get_settings", return_value=fake_settings):
                text_b = knowledge.load_knowledge("tenant-b")
                profile_b = knowledge.load_profile("tenant-b")
                text_default = knowledge.load_knowledge("default")

            self.assertIn("Política exclusiva de B", text_b)
            self.assertNotIn("Secreto comercial de A", text_b)
            self.assertEqual(profile_b.name, "Empresa B")
            self.assertIn("Secreto comercial de A", text_default)
            knowledge._CACHE.clear()
