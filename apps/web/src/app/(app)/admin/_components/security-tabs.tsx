"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, KeyRound, ShieldCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PasswordSection } from "./password-section";
import { MfaSection } from "./mfa-section";
import { AuditSection } from "./audit-section";

/**
 * Sub-pestañas de la sección "Seguridad" (barra lateral de administración,
 * ver `admin-tabs.tsx`). El valor vive en `?sec=` para que soporte pueda
 * enlazar a un paso concreto: `/admin?tab=seguridad&sec=mfa`.
 *
 * Tres áreas: contraseña (la única que el usuario cambia a menudo),
 * MFA (lo activa una vez y se queda), y actividad (auditoría de
 * cambios — solo lectura). Es el único nivel de pestañas de la página: la
 * navegación entre "Seguridad" y el resto de la administración es la barra
 * lateral, no otra fila de pestañas encima de esta.
 */
const SEC_TABS = [
  { value: "password", label: "Contraseña", icon: KeyRound },
  { value: "mfa", label: "Verificación en dos pasos", icon: ShieldCheck },
  { value: "activity", label: "Actividad", icon: Activity },
] as const;

type SecTabValue = (typeof SEC_TABS)[number]["value"];

export const DEFAULT_SEC_TAB: SecTabValue = "password";
const SEC_PARAM = "sec";

function isSecTabValue(value: string | null): value is SecTabValue {
  return SEC_TABS.some((t) => t.value === value);
}

export function SecurityTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const requested = searchParams.get(SEC_PARAM);
  const sec: SecTabValue = isSecTabValue(requested) ? requested : DEFAULT_SEC_TAB;

  const setSec = useCallback(
    (next: string) => {
      if (!isSecTabValue(next) || next === sec) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set(SEC_PARAM, next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams, sec],
  );

  return (
    <Tabs value={sec} defaultValue={sec} onValueChange={setSec} className="space-y-4">
      <div className="overflow-x-auto pb-1">
        <TabsList className="bg-muted/60">
          {SEC_TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="whitespace-nowrap text-xs">
              <span className="inline-flex items-center gap-1.5">
                <Icon aria-hidden className="h-3.5 w-3.5" />
                {label}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value="password" className="space-y-4">
        <PasswordSection />
      </TabsContent>

      <TabsContent value="mfa" className="space-y-4">
        <MfaSection />
      </TabsContent>

      <TabsContent value="activity" className="space-y-4">
        <ActivityIntro />
        <AuditSection />
      </TabsContent>
    </Tabs>
  );
}

/** Resumen legible de las 3 sub-áreas, montado al principio para que un
 *  nuevo admin sepa qué hay en cada una sin abrir las pestañas. */
function ActivityIntro() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-card border bg-card p-4">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <KeyRound aria-hidden className="h-3.5 w-3.5" />
          Contraseña
        </p>
        <p className="mt-2 text-sm">
          Tu llave de acceso al portal. Se cambia escribiendo la actual.
        </p>
      </div>
      <div className="rounded-card border bg-card p-4">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
          Verificación en dos pasos
        </p>
        <p className="mt-2 text-sm">
          Segundo factor con una app autenticadora. <Badge variant="muted" size="sm">Recomendado</Badge>
        </p>
      </div>
      <div className="rounded-card border bg-card p-4">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Activity aria-hidden className="h-3.5 w-3.5" />
          Actividad
        </p>
        <p className="mt-2 text-sm">
          Cambios importantes de tu cuenta y de tu tenant. Solo lectura.
        </p>
      </div>
    </div>
  );
}
