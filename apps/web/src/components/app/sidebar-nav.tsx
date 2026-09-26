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
  KeyRound,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useConnections } from "@/app/(app)/channels/_components/use-channels";
import { useSession } from "./user-menu";
import { PLATFORM_NAME, useTenantBranding, useTenantDocumentTitle } from "./use-tenant-branding";

const AGENT_BASE = "/agent";

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
  /**
   * Scope necesario para ver este item en el sidebar. Si el usuario activo
   * no lo tiene, el item se oculta (no se muestra deshabilitado — pinchar un
   * item oculto es mejor UX que pinchar uno que devuelve 403).
   *
   * Sin scope, el item se muestra siempre (comportamiento legacy).
   */
  requiresScope?: string;
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
      { href: "/catalog", label: "Catálogo", icon: Package, description: "Productos y variantes", requiresScope: "catalog.read" },
      { href: "/quotes", label: "Cotizaciones", icon: FileText, description: "Borradores y emitidas", requiresScope: "quotes.read" },
      { href: "/quick-charge", label: "Cobro rápido", icon: Zap, description: "Cobra sin cotización", requiresScope: "orders.write" },
      { href: "/orders", label: "Pedidos", icon: ShoppingCart, description: "Checkout y pagos de prueba", requiresScope: "orders.read" },
      { href: "/payments", label: "Pagos", icon: Wallet, description: "Ledger y reembolsos", requiresScope: "payments.read" },
      { href: "/customers", label: "Clientes", icon: Users, description: "Contactos e identidad", requiresScope: "customers.read" },
    ],
  },
  {
    title: "Agente IA",
    items: [
      { href: "/chat", label: "Chat con el agente", icon: MessageSquare, description: "Probar el bot", requiresScope: "chat.read" },
      { href: "/agent", label: "Consola del agente", icon: Bot, description: "Conocimiento y herramientas", requiresScope: "chat.write" },
      { href: "/channels", label: "Canales", icon: Radio, description: "Conexiones de WhatsApp", requiresScope: "chat.write" },
      { href: "/conversations", label: "Conversaciones", icon: MessagesSquare, description: "Bandeja de WhatsApp y handoff", requiresScope: "chat.read" },
    ],
  },
  {
    title: "Sistema",
    items: [
      { href: "/admin", label: "Admin", icon: Settings, description: "Notificaciones y conexiones" },
      { href: "/ayuda", label: "Ayuda", icon: HelpCircle, description: "Guías de uso del panel" },
    ],
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
    {
      href: "/super-admin/api-keys",
      label: "API keys globales",
      icon: KeyRound,
      description: "Credenciales de plataforma, cross-tenant",
    },
  ],
};

/**
 * Compuerta de visibilidad del grupo "Agente IA": un tenant recién creado no
 * tiene key de OpenRouter propia (o una de la plataforma) ni canal de
 * WhatsApp, y mostrarle "Chat con el agente" o "Conversaciones" en ese estado
 * solo lleva a un error. Se ocultan (no solo se deshabilitan) hasta que haya
 * con qué trabajar.
 *
 * "Consola del agente" (`/agent`) y "Canales" (`/channels`) NUNCA se filtran
 * aquí: son la salida de ese estado (ahí se configura la key / se conecta el
 * canal) y ocultarlas dejaría al tenant sin forma de arreglarlo.
 */
function filterAgentGroup(
  groups: NavGroup[],
  opts: {
    chatVisible: boolean;
    conversationsVisible: boolean;
    scopes: readonly string[] | null;
  },
): NavGroup[] {
  return groups.map((group) => {
    if (group.title !== "Agente IA") return group;
    return {
      ...group,
      items: group.items.filter((item) => {
        if (item.href === "/chat") return opts.chatVisible;
        if (item.href === "/conversations") return opts.conversationsVisible;
        return true;
      }),
    };
  });
}

/**
 * Filtra items cuyo `requiresScope` no esté en los scopes del usuario.
 * Si los scopes no están hidratados todavía (login en curso, sesión vacía)
 * se muestran todos: evita parpadeo durante el render inicial y deja que
 * el backend haga la última palabra si alguien fuerza la URL.
 */
function filterByScope(
  groups: NavGroup[],
  scopes: readonly string[] | undefined,
): NavGroup[] {
  if (!scopes || scopes.length === 0) return groups;
  return groups.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.requiresScope || scopes.includes(item.requiresScope),
    ),
  }));
}

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
  /**
   * Riel de íconos: cada entrada queda reducida a su glifo y el rótulo se
   * mueve al tooltip (y a un `sr-only`, que es lo que sigue nombrando el
   * enlace). Solo lo enciende el sidebar de `lg+`; el drawer móvil nunca se
   * contrae, ahí el panel es dedicado y el espacio no compite con nada.
   */
  collapsed?: boolean;
}

export function SidebarNav({
  onNavigate,
  className,
  label = "Navegación principal",
  showDescriptions = false,
  collapsed = false,
}: SidebarNavProps) {
  const pathname = usePathname();
  const groupId = React.useId();
  const session = useSession();

  const isSuperAdmin = !!session?.isSuperAdmin;
  const impersonating = useImpersonation();

  // Solo se consulta el estado del agente/canales cuando el grupo "Agente IA"
  // va a existir en el nav: un super-admin sin impersonar no tiene tenant
  // activo, y pegarle a estos endpoints sin uno solo produce errores.
  const showTenantNav = !isSuperAdmin || impersonating;
  const tenantId = session?.tenantId ?? null;

  // Única señal de si el LLM realmente responde para este tenant. La fuente
  // "de verdad" sería `GET /agent/diagnostics`, pero hoy ese endpoint no
  // expone `llm.live` por tenant (devuelve engine/model/tools/budgets, ver
  // apps/agent-v2/app/main.py `diagnostics()`): se usa el indicador
  // conservador de `/agent/settings` en su lugar — si el tenant guardó su
  // propia key de OpenRouter. Un tenant que opera solo con la key global de
  // la plataforma (sin la suya) queda oculto de más; ver nota en el reporte.
  const agentSettingsQuery = useQuery({
    queryKey: ["agent-settings", tenantId],
    queryFn: async (): Promise<{ settings: { openrouter_api_key_set: boolean } }> => {
      const res = await fetch(`${AGENT_BASE}/settings?tenantId=${encodeURIComponent(tenantId!)}`);
      if (!res.ok) throw new Error("agente no disponible");
      return res.json();
    },
    enabled: showTenantNav && Boolean(tenantId),
    staleTime: 30_000,
  });
  const chatVisible = agentSettingsQuery.data?.settings.openrouter_api_key_set === true;

  // Cualquier conexión cuenta, sin importar su estado: una PENDING o en ERROR
  // todavía significa "a medio configurar", no "sin configurar".
  const connectionsQuery = useConnections({ enabled: showTenantNav });
  const conversationsVisible =
    connectionsQuery.isSuccess && (connectionsQuery.data?.length ?? 0) > 0;

  // Super-admin SIN impersonar: solo la consola de plataforma.
  // Super-admin IMPERSONANDO: muestra también la operación del tenant
  // (catálogo, pedidos, agente, admin) — ese es el punto entero del modo
  // empresa: que el super-admin pueda ver y tocar la app como la ve su
  // dueño.
  const nav = React.useMemo<NavGroup[]>(() => {
    const base: NavGroup[] = !isSuperAdmin
      ? NAV
      : impersonating
        ? // Plataforma primero, luego la operación del tenant impersonado.
          [PLATFORM_NAV, ...NAV]
        : [PLATFORM_NAV];
    return filterByScope(
      filterAgentGroup(base, {
        chatVisible,
        conversationsVisible,
        scopes: session?.scopes ?? null,
      }),
      session?.scopes,
    );
  }, [isSuperAdmin, impersonating, chatVisible, conversationsVisible, session?.scopes]);

  // Con Plataforma + operación son 16 entradas y 5 rótulos: a la densidad
  // normal (~36px por renglón, gap-6 entre grupos) la barra pasa de 800px y
  // "Admin" queda bajo el pliegue. Se aprieta renglón y separación solo en
  // ese caso; el resto de la app no cambia.
  const dense = isSuperAdmin && !!impersonating && !showDescriptions;

  return (
    <nav
      aria-label={label}
      className={cn(
        "flex flex-1 flex-col py-4",
        collapsed ? "px-2" : "px-3",
        dense ? "gap-4" : "gap-6",
        className,
      )}
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
                className={cn(
                  "text-xs font-semibold uppercase tracking-wider text-muted-foreground",
                  // Contraído el rótulo no cabe, pero sigue nombrando al <ul>
                  // por aria-labelledby: se oculta a la vista, no al lector.
                  collapsed ? "sr-only" : "px-2 pb-1",
                )}
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
                    collapsed={collapsed}
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
  collapsed = false,
}: {
  item: NavItem;
  active: boolean;
  onClick?: () => void;
  showDescription?: boolean;
  dense?: boolean;
  collapsed?: boolean;
}) {
  const Icon = item.icon;
  const withDescription = showDescription && !!item.description;

  // Riel de íconos: el rótulo sigue siendo el nombre accesible del enlace
  // (`sr-only`) y además se ve al pasar el puntero o al enfocar con el
  // teclado; sin eso el riel sería una fila de glifos sin nombre.
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={item.href}
            onClick={onClick}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex h-10 items-center justify-center rounded-lg transition-colors",
              "before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-pill before:content-['']",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "bg-muted text-foreground before:bg-primary"
                : "text-foreground/80 before:bg-transparent hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon
              aria-hidden
              className={cn(
                "h-4 w-4 shrink-0",
                active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
              )}
            />
            <span className="sr-only">{item.label}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }

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
 * pestaña sigue la misma regla: `<Empresa> · Atiende ya`.
 */
export function Brand({ className, collapsed = false }: { className?: string; collapsed?: boolean }) {
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
        "flex h-14 shrink-0 items-center gap-2",
        collapsed ? "justify-center px-2" : "px-3",
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
      {collapsed ? null : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold">{displayName}</span>
          <span className="truncate text-xs uppercase tracking-wider text-muted-foreground">
            {name ? PLATFORM_NAME : "Portal operativo"}
          </span>
        </span>
      )}
    </Link>
  );
}

/**
 * Contraer / expandir el riel. Vive al pie de la navegación (no en la Topbar)
 * porque es una preferencia de la barra, y quien la busca la busca ahí.
 *
 * `aria-expanded` describe el estado del riel y el `aria-label` cambia con él,
 * así que un lector de pantalla anuncia la acción, no solo el ícono.
 */
export function SidebarCollapseToggle({
  collapsed,
  onToggle,
  className,
}: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const label = collapsed ? "Expandir la barra lateral" : "Contraer la barra lateral";
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const button = (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-expanded={!collapsed}
      className={cn(
        "flex h-9 items-center gap-3 rounded-lg text-sm font-medium text-foreground/80 transition-colors",
        "hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        collapsed ? "w-full justify-center" : "w-full px-3",
        className,
      )}
    >
      <Icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
      {collapsed ? null : <span>Contraer</span>}
    </button>
  );

  if (!collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
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
export function EnvFooter({
  className,
  collapsed = false,
}: {
  className?: string;
  collapsed?: boolean;
}) {
  // En el riel no cabe ni el chip ni la versión, pero "estás en modo de
  // pruebas" no puede desaparecer: se reduce al glifo, con el mismo texto en
  // tooltip y en `sr-only`.
  if (collapsed) {
    return (
      <div className={cn("flex flex-col items-center p-2", className)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-warning-subtle text-warning-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <FlaskConical className="h-4 w-4" aria-hidden />
              <span className="sr-only">Pagos en modo de pruebas — livemode=false</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[16rem] text-pretty">
            {DUMMY_MODE_HELP}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-start gap-2 p-3", className)}>
      <EnvBadge />
      <p className="text-xs text-muted-foreground">
        <span className="font-mono">livemode=false</span> · v2
      </p>
    </div>
  );
}
