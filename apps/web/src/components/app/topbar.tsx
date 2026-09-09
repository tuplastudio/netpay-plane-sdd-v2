"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Brand, SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

interface TopbarProps {
  onMobileNav: () => void;
}

export function Topbar({ onMobileNav: _onMobileNav }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:px-4">
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Abrir navegación"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="flex w-72 flex-col p-0">
          <Brand className="border-b" />
          <SidebarNav />
          <div className="border-t p-3 text-[11px] text-muted-foreground">
            PAYMENT_PROVIDER=DUMMY · livemode=false
          </div>
        </SheetContent>
      </Sheet>

      <div className="hidden lg:block">
        <Breadcrumbs />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <GlobalSearch />
        <EnvBadge />
        <UserMenu />
      </div>
    </header>
  );
}

function EnvBadge() {
  return (
    <Badge variant="muted" className="hidden gap-1 sm:inline-flex">
      <Bot className="h-3 w-3" />
      DUMMY
    </Badge>
  );
}

function GlobalSearch() {
  const [q, setQ] = React.useState("");
  return (
    <form
      role="search"
      className="hidden items-center md:flex"
      onSubmit={(e) => {
        e.preventDefault();
        if (!q.trim()) return;
        window.location.assign(`/catalog?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar producto o SKU…"
          className="h-9 w-56 rounded-pill pl-8"
          aria-label="Buscar"
        />
      </div>
    </form>
  );
}

function Breadcrumbs() {
  const pathname = usePathname();
  const segments = (pathname || "/").split("/").filter(Boolean);

  if (segments.length === 0) {
    return <span className="text-sm font-medium">Inicio</span>;
  }

  const crumbs: { href: string; label: string }[] = [{ href: "/", label: "Inicio" }];
  let acc = "";
  for (const seg of segments) {
    acc += `/${seg}`;
    crumbs.push({ href: acc, label: humanize(seg) });
  }

  return (
    <nav aria-label="Migas de pan" className="flex items-center gap-1 text-sm">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <React.Fragment key={c.href}>
            {i > 0 ? (
              <span className="text-muted-foreground" aria-hidden>
                /
              </span>
            ) : null}
            {last ? (
              <span className="font-medium">{c.label}</span>
            ) : (
              <Link
                href={c.href}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {c.label}
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
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
    public: "Público",
    checkout: "Checkout",
  };
  return map[seg] ?? seg.replace(/-/g, " ");
}
