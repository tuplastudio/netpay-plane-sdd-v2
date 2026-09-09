"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  FileText,
  ShoppingCart,
  Users,
  MessageSquare,
  Bot,
  Settings,
  Sparkles,
  Zap,
  Wallet,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
}

export interface NavGroup {
  title?: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    items: [
      { href: "/", label: "Inicio", icon: LayoutDashboard, description: "Resumen y atajos" },
    ],
  },
  {
    title: "Operación",
    items: [
      { href: "/catalog", label: "Catálogo", icon: Package, description: "Productos y variantes" },
      { href: "/quotes", label: "Cotizaciones", icon: FileText, description: "Borradores y emitidas" },
      { href: "/quick-charge", label: "Cobro rápido", icon: Zap, description: "Cobra sin cotización" },
      { href: "/orders", label: "Pedidos", icon: ShoppingCart, description: "Checkout y pagos dummy" },
      { href: "/payments", label: "Pagos", icon: Wallet, description: "Ledger y reembolsos" },
      { href: "/customers", label: "Clientes", icon: Users, description: "Contactos e identidad" },
    ],
  },
  {
    title: "Agente IA",
    items: [
      { href: "/chat", label: "Chat con el agente", icon: MessageSquare, description: "Probar el bot" },
      { href: "/agent", label: "Consola del agente", icon: Bot, description: "Conocimiento y herramientas" },
      { href: "/channels", label: "Canales", icon: Radio, description: "WhatsApp y handoff" },
    ],
  },
  {
    title: "Sistema",
    items: [{ href: "/admin", label: "Admin", icon: Settings, description: "Notificaciones y conexiones" }],
  },
];

interface SidebarNavProps {
  onNavigate?: () => void;
  className?: string;
}

export function SidebarNav({ onNavigate, className }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav className={cn("flex flex-1 flex-col gap-6 px-3 py-4", className)}>
      {NAV.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-1">
          {group.title ? (
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </p>
          ) : null}
          {group.items.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              onClick={onNavigate}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

function SidebarLink({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-start gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-muted text-primary"
          : "text-foreground/80 hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      <span className="flex flex-col leading-tight">
        <span>{item.label}</span>
        {item.description ? (
          <span className="text-xs font-normal text-muted-foreground">{item.description}</span>
        ) : null}
      </span>
    </Link>
  );
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Brand({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2 px-3 py-3", className)}
      aria-label="NetPay Plane"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Sparkles className="h-4 w-4" />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold">NetPay Plane</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          v2 · dummy
        </span>
      </span>
    </Link>
  );
}
