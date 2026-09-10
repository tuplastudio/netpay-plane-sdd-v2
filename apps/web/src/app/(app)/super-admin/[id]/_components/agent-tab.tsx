"use client";

import { AgentSettingsForm } from "@/components/app/agent-settings-form";
import { Section } from "@/components/app/section";

/**
 * Pestaña "Agente" del detalle de empresa: misma forma que el panel del
 * propio tenant, pero apuntada al slug recibido en lugar de la sesión.
 *
 * Permite al super-admin editar el prompt, los modelos y, sobre todo, la
 * API key de OpenRouter y los flags de WhatsApp que esa empresa tiene
 * configurados — sin necesidad de iniciar sesión como ese tenant.
 */
export function AgentTab({ tenantId }: { tenantId: string }) {
  return (
    <Section
      title="Agente de la empresa"
      description="Identidad, estilo, modelos y credenciales. La API key de OpenRouter y los flags de WhatsApp se guardan cifrados por empresa."
      padded={false}
    >
      <div className="px-4 pb-4 sm:px-6 sm:pb-6">
        <AgentSettingsForm tenantIdOverride={tenantId} />
      </div>
    </Section>
  );
}
