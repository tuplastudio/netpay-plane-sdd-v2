"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BellRing, Building2, KeyRound, Palette, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { BusinessSettingsSection } from "./business-settings-section";
import { UsageSection } from "./usage-section";
import { BrandingSection } from "./branding-section";
import { MembersSection } from "./members-section";
import { ApiKeysSection } from "./api-keys-section";
import { NotificationsSection } from "./notifications-section";
import { SecurityTabs } from "./security-tabs";

/**
 * Secciones de la administración, en una barra lateral (no en pestañas): con
 * seis áreas y una de ellas (Seguridad) con sus propias sub-pestañas, dos
 * niveles de `<Tabs>` anidados quedaban confusos y el segundo nivel perdía
 * jerarquía visual. La barra lateral es navegación entre páginas de
 * administración; las sub-pestañas de Seguridad siguen siendo pestañas
 * (alternan paneles dentro de UNA sección), que es lo que sí les corresponde.
 *
 * El valor vive en `?tab=` para que cada área tenga enlace propio (soporte
 * puede mandar `/admin?tab=api-keys`) y el botón "atrás" no acumule
 * entradas: se usa `router.replace`.
 */
const SECTIONS = [
  { value: "empresa", label: "Empresa", icon: Building2 },
  { value: "marca", label: "Marca", icon: Palette },
  { value: "usuarios", label: "Usuarios", icon: Users },
  { value: "api-keys", label: "API keys", icon: KeyRound },
  { value: "notificaciones", label: "Notificaciones", icon: BellRing },
  { value: "seguridad", label: "Seguridad", icon: ShieldCheck },
] as const;

type SectionValue = (typeof SECTIONS)[number]["value"];

export const DEFAULT_ADMIN_TAB: SectionValue = "empresa";
const SECTION_PARAM = "tab";

function isSectionValue(value: string | null): value is SectionValue {
  return SECTIONS.some((t) => t.value === value);
}

export function AdminTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const requested = searchParams.get(SECTION_PARAM);
  const section: SectionValue = isSectionValue(requested) ? requested : DEFAULT_ADMIN_TAB;

  const setSection = useCallback(
    (next: SectionValue) => {
      if (next === section) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set(SECTION_PARAM, next);
      // `sec` es la sub-pestaña de Seguridad: al salir de esa sección no debe
      // quedar pegada, o volver a "Seguridad" desde otra parte abriría
      // siempre la última sub-pestaña visitada en vez de "Contraseña".
      params.delete("sec");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams, section],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start">
      <nav aria-label="Secciones de administración" className="lg:sticky lg:top-6">
        {/* Riel horizontal hasta `lg`: seis secciones no caben verticalmente
            sin empujar el contenido fuera de la primera pantalla en tablet.
            De `lg` en adelante es la barra lateral vertical. */}
        <div className="-mx-4 overflow-x-auto px-4 pb-1 lg:mx-0 lg:overflow-visible lg:px-0 lg:pb-0">
          <ul className="flex gap-1 lg:flex-col lg:gap-0.5">
            {SECTIONS.map(({ value, label, icon: Icon }) => {
              const isActive = value === section;
              return (
                <li key={value} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setSection(value)}
                    className={cn(
                      "flex w-full items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2",
                      isActive
                        ? "bg-primary-subtle text-primary-strong"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon aria-hidden className="h-4 w-4 shrink-0" />
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      <div className="min-w-0 space-y-6">
        {section === "empresa" ? (
          <>
            <BusinessSettingsSection />
            <UsageSection />
          </>
        ) : null}
        {section === "marca" ? <BrandingSection /> : null}
        {section === "usuarios" ? <MembersSection /> : null}
        {section === "api-keys" ? <ApiKeysSection /> : null}
        {section === "notificaciones" ? <NotificationsSection /> : null}
        {section === "seguridad" ? <SecurityTabs /> : null}
      </div>
    </div>
  );
}
