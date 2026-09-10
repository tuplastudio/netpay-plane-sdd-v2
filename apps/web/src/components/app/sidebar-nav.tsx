"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Package,
  FileText,
  ShoppingCart,
  Users,
  MessageSquare,
  MessagesSquare,
  Bot,
  Settings,
  Sparkles,
  Zap,
  Wallet,
  Radio,
  FlaskConical,
  Building2,
  Gauge,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSession } from "./user-menu";
import { PLATFORM_NAME, useTenantBranding, useTenantDocumentTitle } from "./use-tenant-branding";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  /**
   * Solo se enciende con la ruta exacta. Para entradas "raíz" de una sección
   * (`/super-admin`) cuyas hermanas viven debajo (`/super-admin/tenants`): sin
   * esto ambas se encenderían a la vez.
   */
  exact?: boolean;
  /**
   * Rutas adicionales que encienden esta entrada, además del prefijo `href`.
   * P. ej. el detalle `/super-admin/{id}` pertenece a "Empresas".
   */
  activePattern?: RegExp;
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
      { href: "/orders", label: "Pedidos", icon: ShoppingCart, description: "Checkout y pagos de prueba" },
      { href: "/payments", label: "Pagos", icon: Wallet, description: "Ledger y reembolsos" },
      { href: "/customers", label: "Clientes", icon: Users, description: "Contactos e identidad" },
    ],
  },
  {
    title: "Agente IA",
    items: [
      { href: "/chat", label: "Chat con el agente", icon: MessageSquare, description: "Probar el bot" },
      { href: "/agent", label: "Consola del agente", icon: Bot, description: "Conocimiento y herramientas" },
      { href: "/channels", label: "Canales", icon: Radio, description: "Conexiones de WhatsApp" },
      { href: "/conversations", label: "Conversaciones", icon: MessagesSquare, description: "Bandeja de WhatsApp y handoff" },
    ],
  },
  {
    title: "Sistema",
    items: [{ href: "/admin", label: "Admin", icon: Settings, description: "Notificaciones y conexiones" }],
  },
];

/**
 * Consola de plataforma: solo para `isSuperAdmin`. Va SIEMPRE arriba — es el
 * trabajo del super-admin; la operación de su propio tenant, si lo tiene, es
 * contexto secundario y se rinde debajo.
 */
const PLATFORM_NAV: NavGroup = {
  title: "Plataforma",
  items: [
    {
      href: "/super-admin",
      label: "Resumen",
      icon: LayoutDashboard,
      description: "Empresas, usuarios y gasto",
      exact: true,
    },
    {
      href: "/super-admin/tenants",
      label: "Empresas",
      icon: Building2,
      description: "Alta, gestión y usuarios por tenant",
      // El detalle vive en /super-admin/{id}; usage tiene su propia entrada.
      activePattern: /^\/super-admin\/(?!usage(?:\/|$))[^/]+/,
    },
    {
      href: "/super-admin/usage",
      label: "Uso y costos",
      icon: Gauge,
      description: "Consumo de tokens por empresa",
    },
  ],
};

interface SidebarNavProps {
  onNavigate?: () => void;
  className?: string;
  /**
   * Nombre del landmark. Solo hay una navegación visible a la vez (el aside se
   * oculta con `display:none` bajo `lg`), así que el default sirve a las dos.
   */
  label?: string;
  /**
   * Segunda línea con la `description` de cada entrada.
   *
   * **Apagada por defecto, y a propósito.** Con las once descripciones a la
   * vista cada renglón mide dos líneas (~48px en vez de ~36px) y la navegación
   * completa pasa de ~760px a ~890px: en un portátil de 800px de alto el
   * `overflow-y-auto` del `<aside>` se activa y "Admin" queda bajo el pliegue.
   * Una barra de navegación que hay que desplazar para ver entera es peor
   * navegabilidad que unas glosas siempre presentes que se leen una vez y
   * después son ruido para quien usa el portal a diario.
   *
   * En el drawer móvil sí se encienden: ahí el panel es dedicado y de alto
   * completo, se abre justo cuando alguien está orientándose, y el espacio no
   * compite con el contenido.
   */
  showDescriptions?: boolean;
}

export function SidebarNav({
  onNavigate,
  className,
  label = "Navegación principal",
  showDescriptions = false,
}: SidebarNavProps) {
  const pathname = usePathname();
  const groupId = React.useId();
  const session = useSession();

  const isSuperAdmin = !!session?.isSuperAdmin;
  const impersonating = useImpersonation();

  // Super-admin SIN impersonar: solo la consola de plataforma.
  // Super-admin IMPERSONANDO: muestra también la operación del tenant
  // (catálogo, pedidos, agente, admin) — ese es el punto entero del modo
  // empresa: que el super-admin pueda ver y tocar la app como la ve su
  // dueño.
  const nav = React.useMemo<NavGroup[]>(() => {
    if (!isSuperAdmin) return NAV;
    if (impersonating) {
      // Plataforma primero, luego la operación del tenant impersonado.
      // El rótulo del grupo "Inicio" lleva el slug para que se lea como
      // "esta empresa" y no como "mi propia empresa".
      return [
        PLATFORM_NAV,
        ...NAV,
      ];
    }
    return [PLATFORM_NAV];
  }, [isSuperAdmin, impersonating]);

  // Con Plataforma + operación son 16 entradas y 5 rótulos: a la densidad
  // normal (~36px por renglón, gap-6 entre grupos) la barra pasa de 800px y
  // "Admin" queda bajo el pliegue. Se aprieta renglón y separación solo en
  // ese caso; el resto de la app no cambia.
  const dense = isSuperAdmin && !!impersonating && !showDescriptions;

  return (
    <nav
      aria-label={label}
      className={cn("flex flex-1 flex-col px-3 py-4", dense ? "gap-4" : "gap-6", className)}
    >
      {nav.map((group, gi) => {
        const titleId = group.title ? `${groupId}-g${gi}` : undefined;
        return (
          <div key={gi} className="flex flex-col gap-1">
            {group.title ? (
              // Rótulo del grupo, no encabezado: nombra al <ul> vía
              // aria-labelledby sin ensuciar el esquema de encabezados de la
              // página (que ya tiene su h1 y los h2 de cada Section).
              <p
                id={titleId}
                className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {group.title}
              </p>
            ) : null}
            <ul aria-labelledby={titleId} className="flex flex-col gap-1">
              {group.items.map((item) => (
                <li key={item.href}>
                  <SidebarLink
                    item={item}
                    active={isActive(pathname, item)}
                    onClick={onNavigate}
                    showDescription={showDescriptions}
                    dense={dense}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function SidebarLink({
  item,
  active,
  onClick,
  showDescription = false,
  dense = false,
}: {
  item: NavItem;
  active: boolean;
  onClick?: () => void;
  showDescription?: boolean;
  dense?: boolean;
}) {
  const Icon = item.icon;
  const withDescription = showDescription && !!item.description;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        // Tres señales de "activo", ninguna dependiente del color por sí sola:
        // la barra de la izquierda (forma), `font-semibold` (peso), el fondo
        // `bg-muted` (superficie) y `aria-current="page"` para lectores. Aunque
        // el acento cambie de tono, la ruta activa se sigue distinguiendo.
        "group relative flex gap-3 rounded-lg pl-4 pr-2.5 text-sm transition-colors",
        dense ? "py-1.5" : "py-2",
        withDescription ? "items-start" : "items-center",
        "before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-pill before:content-['']",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active
          ? "bg-muted font-semibold text-foreground before:bg-primary"
          : "font-medium text-foreground/80 before:bg-transparent hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "h-4 w-4 shrink-0",
          withDescription && "mt-0.5",
          // El ícono activo hereda la tinta, no el acento: si `--primary` se
          // vuelve un tono decorativo, un glifo de 16px en ese color sobre
          // `bg-muted` puede quedarse sin contraste. El color de marca lo lleva
          // la barra, que es forma y no información.
          active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate">{item.label}</span>
        {withDescription ? (
          <span className="text-xs font-normal text-muted-foreground">{item.description}</span>
        ) : null}
      </span>
    </Link>
  );
}

function isActive(pathname: string | null, item: NavItem): boolean {
  if (!pathname) return false;
  const { href } = item;
  if (href === "/" || item.exact) return pathname === href;
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  return item.activePattern ? item.activePattern.test(pathname) : false;
}

/**
 * Lee la cookie de impersonación preguntando al backend (la cookie es
 * `httpOnly` y no se puede leer desde JS). `enabled: false` cuando no
 * hay sesión de super-admin; así no se gasta la consulta.
 */
function useImpersonation(): boolean {
  const session = useSession();
  const enabled = !!session?.isSuperAdmin;
  const q = useQuery({
    queryKey: ["super-admin", "impersonation"],
    queryFn: async () => {
      const res = await fetch("/api/v1/super-admin/impersonate", { credentials: "include" });
      if (!res.ok) return null;
      const json = (await res.json()) as { data: unknown };
      return json.data ?? null;
    },
    enabled,
    staleTime: 30_000,
  });
  return enabled && !!q.data;
}

/**
 * Marca del portal: el nombre y logo de la empresa activa (de `/auth/me`);
 * sin empresa —o mientras carga— el nombre del producto. El título de la
 * pestaña sigue la misma regla: `<Empresa> · Easy Sell`.
 */
export function Brand({ className }: { className?: string }) {
  const { name, logoUrl, displayName } = useTenantBranding();
  useTenantDocumentTitle(name);
  const [logoBroken, setLogoBroken] = React.useState(false);
  React.useEffect(() => setLogoBroken(false), [logoUrl]);
  const showLogo = !!logoUrl && !logoBroken;
  return (
    <Link
      href="/"
      className={cn(
        // h-14: misma altura que la Topbar, para que la línea del header no se
        // rompa al cruzar del sidebar al contenido.
        "flex h-14 shrink-0 items-center gap-2 px-3",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground",
        className,
      )}
      aria-label={`${displayName} — ir al inicio`}
    >
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- logo del tenant servido por el API, sin optimizador
        <img
          src={logoUrl ?? undefined}
          alt=""
          className="h-8 w-8 shrink-0 rounded-md object-contain"
          onError={() => setLogoBroken(true)}
        />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
      )}
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-semibold">{displayName}</span>
        <span className="truncate text-xs uppercase tracking-wider text-muted-foreground">
          {name ? PLATFORM_NAME : "Portal operativo"}
        </span>
      </span>
    </Link>
  );
}

const DUMMY_MODE_HELP =
  "Modo de pruebas: los cobros no llegan a un procesador real. Los pagos se simulan y ningún dinero se mueve.";

/**
 * Señal operativa de entorno: el portal corre con `PAYMENT_PROVIDER=DUMMY` y
 * `livemode=false`. Es un estado, no un log de depuración, así que va como chip
 * con tono `warning` y explicación en tooltip.
 *
 * `compact` es la versión de la Topbar; sin él se rinde el bloque del pie del
 * sidebar.
 */
export function EnvBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="warning"
          tabIndex={0}
          className={cn(
            "gap-1.5 focus-visible:ring-foreground focus-visible:ring-offset-background",
            className,
          )}
        >
          <FlaskConical className="h-3 w-3" aria-hidden />
          {compact ? "Pruebas" : "Pagos en modo de pruebas"}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-[16rem] text-pretty">{DUMMY_MODE_HELP}</TooltipContent>
    </Tooltip>
  );
}

/** Pie del sidebar / del drawer: el chip de entorno más la versión. */
export function EnvFooter({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-2 p-3", className)}>
      <EnvBadge />
      <p className="text-xs text-muted-foreground">
        <span className="font-mono">livemode=false</span> · v2
      </p>
    </div>
  );
}
