"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Brand, EnvBadge, EnvFooter, SidebarNav } from "./sidebar-nav";
import { GlobalSearch } from "./global-search";
import { TenantSwitcher } from "./tenant-switcher";
import { UserMenu } from "./user-menu";

export function Topbar() {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Al navegar (o al volver atrás) el drawer móvil se cierra solo: Radix
  // devuelve el foco al disparador al desmontar el contenido.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    // h-14 (3.5rem): misma altura que el bloque `Brand` del sidebar. Junto con
    // el `py-6` de <main> forma el 6.5rem de chrome vertical documentado en
    // app-shell.tsx; cámbiala solo de la mano de ese archivo.
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:gap-3 sm:px-4">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Abrir navegación"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="flex w-[85vw] max-w-72 flex-col gap-0 p-0">
          {/* Radix exige título y descripción en el diálogo; aquí son para
              lectores de pantalla porque la marca ya identifica el panel. */}
          <SheetTitle className="sr-only">Navegación</SheetTitle>
          <SheetDescription className="sr-only">
            Secciones del portal operativo Easy Sell.
          </SheetDescription>
          <Brand className="border-b" />
          <div className="flex-1 overflow-y-auto">
            {/* Panel dedicado y de alto completo: aquí las descripciones sí
                caben y ayudan a quien está orientándose. */}
            <SidebarNav onNavigate={() => setOpen(false)} showDescriptions />
          </div>
          <EnvFooter className="border-t" />
        </SheetContent>
      </Sheet>

      <div className="min-w-0 flex-1">
        <CurrentPageLabel />
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        <GlobalSearch />
        <EnvBadge compact className="hidden sm:inline-flex" />
        <TenantSwitcher />
        <UserMenu />
      </div>
    </header>
  );
}

/**
 * Contexto de página del topbar: **una etiqueta, no un rastro de migas**.
 *
 * Antes había aquí un `<nav aria-label="Migas de pan">` con la ruta completa.
 * Eso duplicaba chrome por partida doble:
 *
 * - En un listado (`/orders`) el rastro "Inicio / Pedidos" no aporta nada que
 *   el sidebar no diga ya con `aria-current="page"` sobre "Pedidos".
 * - En un detalle (`/orders/{id}`) las cinco pantallas de detalle ya rinden su
 *   propio rastro con `PageHeader breadcrumbs`, así que había **dos landmarks
 *   de navegación de migas** en la misma página, con nombres distintos
 *   ("Migas de pan" y "Ruta"): un lector de pantalla listaba dos rutas para la
 *   misma jerarquía.
 *
 * Queda solo la etiqueta de sección —útil cuando el contenido está desplazado y
 * el encabezado ya no se ve—, sin rol de landmark y sin enlaces: el sidebar
 * navega, la marca vuelve al inicio y el `backHref` del `PageHeader` sube un
 * nivel. Por eso **ningún listado necesita `breadcrumbs`**.
 */
function CurrentPageLabel() {
  const pathname = usePathname();
  const segments = (pathname || "/").split("/").filter(Boolean);

  let label = "Inicio";
  if (segments.length > 0) {
    const last = humanize(segments[segments.length - 1]!);
    // "Detalle" solo no dice nada: se antepone la sección.
    label =
      last === "Detalle" && segments.length > 1
        ? `${humanize(segments[segments.length - 2]!)} · Detalle`
        : last;
  }

  return <span className="block truncate text-sm font-medium">{label}</span>;
}

function humanize(seg: string): string {
  if (/^[0-9a-f-]{8,}$/i.test(seg)) return "Detalle";
  const map: Record<string, string> = {
    catalog: "Catálogo",
    quotes: "Cotizaciones",
    "quick-charge": "Cobro rápido",
    orders: "Pedidos",
    payments: "Pagos",
    customers: "Clientes",
    chat: "Chat",
    agent: "Consola del agente",
    admin: "Admin",
    channels: "Canales",
    conversations: "Conversaciones",
    "super-admin": "Plataforma",
    tenants: "Empresas",
    users: "Usuarios",
    usage: "Uso y costos",
    public: "Público",
    checkout: "Checkout",
  };
  return map[seg] ?? seg.replace(/-/g, " ");
}
