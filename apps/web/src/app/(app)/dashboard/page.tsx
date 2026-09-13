"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { fetchAuthMe } from "@/lib/api";
import {
  Activity,
  ArrowRight,
  Banknote,
  Bot,
  CircleDollarSign,
  FileText,
  Hourglass,
  MessageSquare,
  MessagesSquare,
  Package,
  Plus,
  Receipt,
  ShoppingCart,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { StatTile } from "@/components/app/stat-tile";
import { Money, formatMoney } from "@/components/app/money";
import { DateTime } from "@/components/app/date-time";
import { useDashboardData } from "../_dashboard/use-dashboard-data";

/**
 * Panorama operativo del portal.
 *
 * Datos en una sola consulta a `/reports/dashboard`. Cifras vienen agregadas
 * en SQL (no se muestrean listados truncados) y el dinero viaja como string
 * decimal directo a `<Money>`.
 *
 * Estructura visual, misma que el dashboard de super-admin para que ambos
 * paneles se lean igual: KPIs en dos filas, tendencia de ventas a 7 días,
 * acciones rápidas y actividad reciente.
 */
export default function HomePage() {
  const router = useRouter();
  const { summary, unified } = useDashboardData();

  const me = useQuery({ queryKey: ["auth-me"], queryFn: fetchAuthMe, retry: false });
  useEffect(() => {
    if (me.data?.isSuperAdmin) router.replace("/super-admin");
  }, [me.data, router]);

  const tile = {
    isLoading: unified.isLoading,
    isError: unified.isError,
    onRetry: () => void unified.refetch(),
  };

  const salesTrend = unified.data?.salesTrend ?? [];
  const recentOrders = unified.data?.recentOrders ?? [];
  const recentConversations = unified.data?.recentConversations ?? [];
  const recentActivity = unified.data?.recentActivity ?? [];

  return (
    <div>
      <PageHeader
        title="Panorama"
        description="Cobros, pedidos por cobrar, cotizaciones y canales — de un vistazo."
        actions={
          <Button asChild>
            <Link href="/chat">
              <MessageSquare className="h-4 w-4" />
              Probar el agente
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <div className="space-y-6">
        {/* Fila 1: KPIs financieros clásicos. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <StatTile size="compact"
            {...tile}
            label="Cobrado (neto)"
            tone="success"
            icon={<Banknote className="h-4 w-4" />}
            value={<Money value={unified.data?.kpis.captured.net} />}
            hint={
              unified.data === undefined
                ? undefined
                : unified.data.kpis.captured.gross === "0.00"
                  ? "Todavía no hay cobros."
                  : `Bruto ${formatMoney(unified.data.kpis.captured.gross)} · reembolsado ${formatMoney(
                      unified.data.kpis.captured.refunded,
                    )}`
            }
          />
          <StatTile size="compact"
            {...tile}
            label="Por pagar"
            tone={unified.data && unified.data.kpis.outstanding.count > 0 ? "warning" : "neutral"}
            icon={<Hourglass className="h-4 w-4" />}
            value={<Money value={unified.data?.kpis.outstanding.total} />}
            hint={
              unified.data === undefined
                ? undefined
                : unified.data.kpis.outstanding.count === 0
                  ? "Ningún pedido espera cobro."
                  : `${unified.data.kpis.outstanding.count} esperando pago`
            }
          />
          <StatTile size="compact"
            {...tile}
            label="Cotizaciones emitidas"
            tone="info"
            icon={<FileText className="h-4 w-4" />}
            value={unified.data?.kpis.issuedQuotes ?? 0}
            hint={
              summary.data === undefined
                ? undefined
                : summary.data.quotesExpiringWithin7Days > 0
                  ? `${summary.data.quotesExpiringWithin7Days} vence(n) en 7 días`
                  : "Ninguna vence pronto"
            }
          />
          <StatTile size="compact"
            {...tile}
            label="Productos activos"
            icon={<Package className="h-4 w-4" />}
            value={unified.data?.kpis.products.active ?? 0}
            hint={
              unified.data === undefined
                ? undefined
                : `${unified.data.kpis.products.draft} en borrador`
            }
          />
          <StatTile size="compact"
            {...tile}
            label="Conversaciones abiertas"
            tone={unified.data && unified.data.kpis.conversations.escalated > 0 ? "warning" : "neutral"}
            icon={<MessagesSquare className="h-4 w-4" />}
            value={unified.data?.kpis.conversations.open ?? 0}
            hint={
              unified.data === undefined
                ? undefined
                : unified.data.kpis.conversations.escalated > 0
                  ? `${unified.data.kpis.conversations.escalated} escalada(s) a una persona`
                  : "Ninguna escalada"
            }
          />
        </div>

        {/* Fila 2: KPIs del día/mes (operativos). */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile size="compact"
            {...tile}
            label="Ventas cobradas hoy"
            tone="success"
            icon={<CircleDollarSign className="h-4 w-4" />}
            value={<Money value={unified.data?.kpis.revenue.today} />}
            hint={unified.data ? <Money value={unified.data.kpis.revenue.mtd} /> : undefined}
          />
          <StatTile size="compact"
            {...tile}
            label="Pedidos hoy"
            icon={<Receipt className="h-4 w-4" />}
            value={unified.data?.kpis.orders.today ?? 0}
            hint={unified.data ? `${unified.data.kpis.orders.mtd} en el mes` : undefined}
          />
          <StatTile size="compact"
            {...tile}
            label="Clientes totales"
            icon={<Users className="h-4 w-4" />}
            value={unified.data?.kpis.customers.total ?? 0}
            hint={unified.data ? `${unified.data.kpis.customers.newToday} nuevo(s) hoy` : undefined}
          />
          <StatTile size="compact"
            {...tile}
            label="Ventas cobradas (mes)"
            tone="success"
            icon={<CircleDollarSign className="h-4 w-4" />}
            value={<Money value={unified.data?.kpis.revenue.mtd} />}
            hint={unified.data ? `${unified.data.kpis.orders.mtd} pedidos del mes` : undefined}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Tendencia de ventas 7 días. */}
          <Section
            title="Ventas cobradas · últimos 7 días"
            description="Total diario de pedidos PAID/FULFILLED."
            headerIcon={<TrendingUp className="h-4 w-4" />}
            density="compact"
            className="lg:col-span-2"
          >
            <SalesTrendMini data={salesTrend} isLoading={unified.isLoading} />
          </Section>

          {/* Acciones rápidas. */}
          <Section
            title="Acciones rápidas"
            description="Lo que más usa un operador al entrar al portal."
            headerIcon={<Plus className="h-4 w-4" />}
            density="compact"
          >
            <ul className="space-y-1.5 text-sm">
              <li>
                <Link
                  href="/chat"
                  className="group flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
                >
                  <span className="flex items-center gap-2">
                    <MessageSquare aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                    Hablar con el agente
                  </span>
                  <ArrowRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
              <li>
                <Link
                  href="/quotes"
                  className="group flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
                >
                  <span className="flex items-center gap-2">
                    <FileText aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                    Crear cotización
                  </span>
                  <ArrowRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
              <li>
                <Link
                  href="/orders"
                  className="group flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
                >
                  <span className="flex items-center gap-2">
                    <ShoppingCart aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                    Ver pedidos
                  </span>
                  <ArrowRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
              <li>
                <Link
                  href="/customers"
                  className="group flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
                >
                  <span className="flex items-center gap-2">
                    <UserPlus aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                    Dar de alta un cliente
                  </span>
                  <ArrowRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
              <li>
                <Link
                  href="/agent"
                  className="group flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
                >
                  <span className="flex items-center gap-2">
                    <Bot aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                    Consola del agente
                  </span>
                  <ArrowRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            </ul>
          </Section>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Pedidos recientes. */}
          <Section
            title="Pedidos recientes"
            description="Últimos 5 pedidos del comercio."
            headerIcon={<ShoppingCart className="h-4 w-4" />}
            density="compact"
            padded={false}
            actions={
              <Button asChild variant="outline" size="sm">
                <Link href="/orders">Ver todos</Link>
              </Button>
            }
          >
            <RecentOrders
              rows={recentOrders}
              isLoading={unified.isLoading}
            />
          </Section>

          {/* Conversaciones recientes. */}
          <Section
            title="Conversaciones recientes"
            description="Últimos hilos con actividad."
            headerIcon={<MessagesSquare className="h-4 w-4" />}
            density="compact"
            padded={false}
            actions={
              <Button asChild variant="outline" size="sm">
                <Link href="/conversations">Ver bandeja</Link>
              </Button>
            }
          >
            <RecentConversations
              rows={recentConversations}
              isLoading={unified.isLoading}
            />
          </Section>

          {/* Auditoría reciente. */}
          <Section
            title="Actividad reciente"
            description="Últimos eventos de la bitácora."
            headerIcon={<Activity className="h-4 w-4" />}
            density="compact"
          >
            <RecentActivity
              rows={recentActivity}
              isLoading={unified.isLoading}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}

/**
 * Gráfico compacto de 7 días. Mismo lenguaje visual que la versión del
 * super-admin, pero con el dato de "ventas cobradas" (no gasto del agente).
 * Construido en SVG inline para que sea server-renderizable.
 */
function SalesTrendMini({
  data,
  isLoading,
}: {
  data: Array<{ day: string; orders: number; revenueUsd: string }>;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-7 items-end gap-2 px-1 pt-2" aria-label="Cargando tendencia de ventas…">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-24 w-full animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Sin ventas cobradas en los últimos 7 días.
      </div>
    );
  }
  const maxRevenue = data.reduce((acc, p) => Math.max(acc, Number(p.revenueUsd)), 0);
  const totalOrders = data.reduce((acc, p) => acc + p.orders, 0);
  const totalRevenue = data.reduce((acc, p) => acc + Number(p.revenueUsd), 0);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        7 días: <Money value={totalRevenue.toFixed(2)} /> · {totalOrders.toLocaleString("es-MX")} pedidos
      </p>
      <div className="grid grid-cols-7 items-end gap-2 pt-1" aria-label="Tendencia de ventas">
        {data.map((p, idx) => {
          const revenue = Number(p.revenueUsd);
          const ratio = maxRevenue > 0 ? revenue / maxRevenue : 0;
          const isPeak = revenue > 0 && revenue === maxRevenue;
          const heightPx = Math.max(8, Math.round(ratio * 96));
          return (
            <div key={p.day} className="flex flex-col items-center gap-1">
              <div className="relative flex h-24 w-full items-end justify-center">
                <div
                  className={cn(
                    "w-full rounded-t-md",
                    revenue > 0 ? "bg-primary/20" : "bg-muted",
                    isPeak && "bg-primary",
                  )}
                  style={{ height: `${heightPx}px` }}
                  aria-hidden
                />
                <span
                  className={cn(
                    "absolute -top-4 text-[10px] font-medium tabular-nums",
                    isPeak ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {revenue > 0 ? compactMoney(p.revenueUsd) : "—"}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground">{formatDayLabel(p.day)}</span>
              <span className="text-[9px] tabular-nums text-muted-foreground">{p.orders}</span>
              {idx === data.length - 1 ? <span className="sr-only">Hoy</span> : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-primary" aria-hidden />
          Pico del periodo
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-primary/20" aria-hidden />
          Día con venta
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-muted" aria-hidden />
          Sin venta
        </span>
      </div>
    </div>
  );
}

function RecentOrders({
  rows,
  isLoading,
}: {
  rows: Array<{
    id: string;
    status: string;
    total: string;
    createdAt: string;
    customer: { id: string; fullName: string | null } | null;
  }>;
  isLoading: boolean;
}) {
  if (isLoading) return <div className="p-4 text-xs text-muted-foreground">Cargando…</div>;
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
        <ShoppingCart aria-hidden className="h-6 w-6" />
        <p>Sin pedidos todavía.</p>
      </div>
    );
  }
  return (
    <ul aria-label="Pedidos recientes" className="divide-y">
      {rows.map((o) => (
        <li key={o.id} className="px-4 py-3">
          <Link
            href={`/orders/${o.id}`}
            className="flex items-center justify-between gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {o.customer?.fullName ?? "Cliente"}
              </span>
              <span className="block text-xs text-muted-foreground">
                <span className="font-mono">{o.id.slice(0, 8)}</span> ·{" "}
                <DateTime value={o.createdAt} />
              </span>
            </span>
            <span className="shrink-0 text-sm">
              <Money value={o.total} className="tabular-nums" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RecentConversations({
  rows,
  isLoading,
}: {
  rows: Array<{
    id: string;
    externalPhone: string;
    status: string;
    handoffToHuman: boolean;
    lastMessageAt: string | null;
    customerId: string | null;
  }>;
  isLoading: boolean;
}) {
  if (isLoading) return <div className="p-4 text-xs text-muted-foreground">Cargando…</div>;
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
        <MessagesSquare aria-hidden className="h-6 w-6" />
        <p>Sin conversaciones todavía.</p>
      </div>
    );
  }
  return (
    <ul aria-label="Conversaciones recientes" className="divide-y">
      {rows.map((c) => (
        <li key={c.id} className="px-4 py-3">
          <Link
            href={`/conversations?id=${c.id}`}
            className="flex items-center justify-between gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {c.customerId ?? c.externalPhone}
              </span>
              <span className="block font-mono text-xs text-muted-foreground">
                {c.externalPhone}
              </span>
            </span>
            <span className="shrink-0 text-xs">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[10px] font-medium",
                  c.handoffToHuman
                    ? "border-warning bg-warning-subtle text-warning-foreground"
                    : "border-info bg-info-subtle text-info-foreground",
                )}
              >
                {c.handoffToHuman ? "Con persona" : "Bot"}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RecentActivity({
  rows,
  isLoading,
}: {
  rows: Array<{
    id: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    metadata: unknown;
    createdAt: string;
    actor: { id: string; email: string; fullName: string | null } | null;
  }>;
  isLoading: boolean;
}) {
  if (isLoading) return <div className="p-4 text-xs text-muted-foreground">Cargando…</div>;
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
        <Activity aria-hidden className="h-6 w-6" />
        <p>Sin actividad reciente.</p>
      </div>
    );
  }
  return (
    <ol aria-label="Actividad reciente" className="space-y-0">
      {rows.map((row, i) => (
        <li
          key={row.id}
          className={cn(
            "py-2 text-xs",
            i < rows.length - 1 && "border-b border-border",
          )}
        >
          <p className="font-medium leading-snug">{humanize(row.action)}</p>
          <p className="text-muted-foreground">
            {row.actor?.fullName ?? row.actor?.email ?? "Sin actor"} ·{" "}
            <DateTime value={row.createdAt} />
          </p>
        </li>
      ))}
    </ol>
  );
}

// Helpers compartidos ---------------------------------------------------------

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const SHORT_DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function formatDayLabel(day: string): string {
  const parts = day.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return day;
  const dow = SHORT_DAYS[date.getDay()] ?? "";
  return `${dow} ${d}`;
}

function compactMoney(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "—";
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 1000) return `$${n.toFixed(0)}`;
  if (n < 100_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${(n / 1000).toFixed(0)}k`;
}

const ACTION_LABELS: Record<string, string> = {
  "order.created": "Pedido creado",
  "order.cancelled": "Pedido cancelado",
  "order.paid": "Pedido pagado",
  "order.refunded": "Pedido reembolsado",
  "order.fulfilled": "Pedido entregado",
  "quote.created": "Cotización creada",
  "quote.sent": "Cotización enviada",
  "quote.cancelled": "Cotización cancelada",
  "quote.expired": "Cotización vencida",
  "customer.created": "Cliente creado",
  "customer.archived": "Cliente archivado",
  "user.invited": "Usuario invitado",
  "user.invitation_sent": "Invitación enviada",
  "user.role_changed": "Rol de usuario cambiado",
  "password.reset.requested": "Restablecimiento de contraseña solicitado",
  "password_reset_requested": "Restablecimiento de contraseña solicitado",
  "tenant.bootstrap": "Comercio dado de alta",
  "whatsapp.conversation.returned": "Conversación devuelta al agente",
  "whatsapp_conversation_returned": "Conversación devuelta al agente",
  "whatsapp.conversation.handoff": "Conversación transferida a una persona",
  "whatsapp.conversation.assigned": "Conversación tomada por un asesor",
  "superadmin.impersonation_started": "Impersonación iniciada",
  "superadmin.impersonation_ended": "Impersonación terminada",
  "apikey.created": "API key creada",
  "apikey.revoked": "API key revocada",
  "apikey.created_via_super_admin": "API key creada (vía super-admin)",
};

function humanize(action: string): string {
  return (
    ACTION_LABELS[action] ??
    action.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
