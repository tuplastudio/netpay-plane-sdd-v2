"use client";

import { PageHeader } from "@/components/app/page-header";
import { ApiKeysSection } from "../../admin/_components/api-keys-section";

/**
 * Keys globales de super-admin (T-IAM-09b): sin tenant, con TODOS los scopes.
 * Cada llamada que las usa decide sobre qué empresa actuar con el header
 * `X-Tenant-Id` (ver `PrincipalGuard` en commerce-api) — sin ese header solo
 * alcanzan rutas sin tenant como `/super-admin/*`.
 */
export default function SuperAdminApiKeysPage() {
  return (
    <div>
      <PageHeader
        title="API keys globales"
        description="Credenciales de plataforma: operan sobre cualquier empresa, no una en particular. Emitirlas o revocarlas exige tu sesión de super-admin."
      />
      <ApiKeysSection
        basePath="/super-admin/api-keys"
        scopesMode="all"
        title="API keys globales"
        description="Pensadas para integraciones de plataforma (soporte, automatización cross-tenant) — no para un negocio en particular."
      />
    </div>
  );
}
