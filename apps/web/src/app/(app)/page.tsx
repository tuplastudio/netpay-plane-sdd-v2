"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { fetchAuthMe } from "@/lib/api";
import {
  ArrowRight,
  Banknote,
  Bot,
  FileText,
  History,
  Hourglass,
  MessageSquare,
  MessagesSquare,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { Money, formatMoney } from "@/components/app/money";
import { StatTile } from "@/components/app/stat-tile";
import { useDashboardData, type AuditEvent } from "./_dashboard/use-dashboard-data";

/**
 * Panorama operativo.
 *
 * Los cinco mosaicos son los mismos de siempre, pero ahora cada cifra la
 * calcula el backend con agregados SQL sobre las tablas completas
 * (`GET /reports/summary`). Antes se sumaban aquí las filas de cinco listados
 * truncados a 50/100, así que ninguna cifra era el total del negocio y cada
 * mosaico tenía que avisarlo. Ya no hay ventana que revelar ni aritmética de
 * cliente: los importes llegan como string decimal y van tal cual a `<Money>`.
 */

/** Acciones de auditoría escritas hoy por el backend. Lo desconocido cae al token crudo. */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "order.cancelled": "Pedido cancelado",
  "quote.cancelled": "Cotización cancelada",
  "tenant.bootstrap": "Alta del comercio",
  "user.invited": "Usuario invitado",
};

/** `AuditLog.targetType` tal cual lo escribe el backend. */
const AUDIT_TARGET_LABELS: Record<string, string> = {
  Order: "Pedido",
  Quote: "Cotización",
  User: "Usuario",
  Tenant: "Comercio",
};

function auditHref(event: AuditEvent): string | undefined {
  if (!event.targetId) return undefined;
  if (event.targetType === "Order") return `/orders/${event.targetId}`;
  if (event.targetType === "Quote") return `/quotes/${event.targetId}`;
  return undefined;
}

const activityColumns: Array<DataTableColumn<AuditEvent>> = [
  {
    key: "createdAt",
    header: "Cuándo",
    width: "12rem",
    cell: (e) => <DateTime value={e.createdAt} className="text-muted-foreground" />,
  },
  {
    key: "action",
    header: "Acción",
    cell: (e) => {
      const label = AUDIT_ACTION_LABELS[e.action];
      return label ? (
        <span className="font-medium">{label}</span>
      ) : (
        <span className="font-mono text-xs">{e.action}</span>
      );
    },
  },
  {
    key: "target",
    header: "Objeto",
    width: "16rem",
    cell: (e) =>
      e.targetType ? (
        <span className="flex flex-wrap items-baseline gap-1.5">
          <span>{AUDIT_TARGET_LABELS[e.targetType] ?? e.targetType}</span>
          {e.targetId ? (
            <span className="font-mono text-xs text-muted-foreground" title={e.targetId}>
              {e.targetId.slice(0, 8)}…
            </span>
          ) : null}
        </span>
      ) : (
        <>
          <span aria-hidden className="text-muted-foreground">
            —
          </span>
          <span className="sr-only">Sin objeto</span>
        </>
      ),
  },
];

export default function HomePage() {
  const router = useRouter();
  const d = useDashboardData();
  const s = d.summary.data;

  // El super-admin trabaja en la consola de plataforma — tenga o no empresa
  // propia. El portal operativo (catálogo, pedidos, agente, admin) es para
  // sesiones de tenant; el super-admin no debe aterrizar ahí.
  const me = useQuery({ queryKey: ["auth-me"], queryFn: fetchAuthMe, retry: false });
  useEffect(() => {
    if (me.data?.isSuperAdmin) router.replace("/super-admin");
  }, [me.data, router]);

  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  // Los cinco mosaicos de dinero y conteos salen de la MISMA consulta, así que
  // comparten estado de carga, de error y el botón de reintentar.
  const tile = {
    isLoading: d.summary.isLoading,
    isError: d.summary.isError,
    onRetry: () => void d.summary.refetch(),
  };

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
        <Section title="Resumen operativo">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {/* 1 · Cobrado — capturedNet: bruto cobrado menos reembolsos */}
            <StatTile size="compact"
              {...tile}
              label="Cobrado"
              tone="success"
              icon={<Banknote className="h-4 w-4" />}
              value={<Money value={s?.capturedNet} />}
              hint={
                s === undefined
                  ? undefined
                  : s.capturedGross === "0.00"
                    ? "Todavía no hay cobros."
                    : s.refundedTotal === "0.00"
                      ? "Sin reembolsos registrados"
                      : `Bruto ${formatMoney(s.capturedGross)} · reembolsado ${formatMoney(
                          s.refundedTotal,
                        )}`
              }
            />

            {/* 2 · Por pagar — pedidos AWAITING_PAYMENT y CHECKOUT_OPEN */}
            <StatTile size="compact"
              {...tile}
              label="Por pagar"
              tone="warning"
              icon={<Hourglass className="h-4 w-4" />}
              value={<Money value={s?.outstandingTotal} />}
              hint={
                s === undefined
                  ? undefined
                  : s.outstandingCount === 0
                    ? "Ningún pedido espera cobro."
                    : `${s.outstandingCount} ${plural(
                        s.outstandingCount,
                        "pedido",
                        "pedidos",
                      )} esperando pago`
              }
            />

            {/* 3 · Cotizaciones emitidas y cuáles vencen pronto */}
            <StatTile size="compact"
              {...tile}
              label="Cotizaciones emitidas"
              tone={s && s.quotesExpiringWithin7Days > 0 ? "warning" : "info"}
              icon={<FileText className="h-4 w-4" />}
              value={s?.issuedQuotes ?? 0}
              hint={
                s === undefined
                  ? undefined
                  : s.issuedQuotes === 0
                    ? "Ninguna cotización emitida."
                    : s.quotesExpiringWithin7Days > 0
                      ? `${s.quotesExpiringWithin7Days} ${plural(
                          s.quotesExpiringWithin7Days,
                          "vence",
                          "vencen",
                        )} en ${d.NEAR_EXPIRY_DAYS} días`
                      : `Ninguna vence en ${d.NEAR_EXPIRY_DAYS} días`
              }
            />

            {/* 4 · Catálogo — productos por estado */}
            <StatTile size="compact"
              {...tile}
              label="Productos activos"
              tone="neutral"
              icon={<Package className="h-4 w-4" />}
              value={s?.activeProducts ?? 0}
              hint={
                s === undefined
                  ? undefined
                  : s.activeProducts === 0 && s.draftProducts === 0
                    ? "El catálogo está vacío."
                    : `${s.draftProducts} en borrador`
              }
            />

            {/* 5 · Conversaciones abiertas y escaladas a una persona */}
            <StatTile size="compact"
              {...tile}
              label="Conversaciones abiertas"
              tone={s && s.escalatedConversations > 0 ? "warning" : "neutral"}
              icon={<MessagesSquare className="h-4 w-4" />}
              value={s?.openConversations ?? 0}
              hint={
                s === undefined
                  ? undefined
                  : s.escalatedConversations > 0
                    ? `${s.escalatedConversations} ${plural(
                        s.escalatedConversations,
                        "escalada a una persona",
                        "escaladas a una persona",
                      )}`
                    : s.openConversations === 0
                      ? "Ningún hilo abierto."
                      : "Ninguna escalada a una persona"
              }
            />
          </div>
        </Section>

        <Section title="Accesos rápidos" description="Las pantallas de operación diaria.">
          <nav aria-label="Accesos rápidos">
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Shortcut
                href="/catalog"
                title="Catálogo"
                desc="Productos, variantes y claves SAT."
                icon={Package}
              />
              <Shortcut
                href="/quotes"
                title="Cotizaciones"
                desc="Borrador, revisión y links públicos."
                icon={FileText}
              />
              <Shortcut
                href="/orders"
                title="Pedidos"
                desc="Checkout y pasarela de pruebas."
                icon={ShoppingCart}
              />
              <Shortcut
                href="/customers"
                title="Clientes"
                desc="Contactos e identidad."
                icon={Users}
              />
              <Shortcut
                href="/chat"
                title="Chat con el agente"
                desc="Cotiza y resuelve por chat."
                icon={MessageSquare}
              />
              <Shortcut
                href="/agent"
                title="Consola del agente"
                desc="Conocimiento, modelo y herramientas."
                icon={Bot}
              />
            </ul>
          </nav>
        </Section>

        <Section
          title="Actividad reciente"
          description="Últimos eventos registrados en la bitácora del comercio."
          padded={false}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href="/admin">Ver toda la auditoría</Link>
            </Button>
          }
        >
          <DataTable
            columns={activityColumns}
            rows={d.activity.data}
            isLoading={d.activity.isLoading}
            isError={d.activity.isError}
            error={d.activity.error}
            onRetry={() => void d.activity.refetch()}
            getRowHref={auditHref}
            caption="Últimos eventos de auditoría del comercio"
            empty={{
              icon: <History className="h-6 w-6" />,
              title: "Sin actividad todavía",
              description:
                "Cuando alguien emita una cotización, cancele un pedido o invite a un usuario, la acción aparecerá aquí.",
              action: (
                <Button asChild variant="outline">
                  <Link href="/quotes">Crear una cotización</Link>
                </Button>
              ),
            }}
          />
        </Section>

        <div className="grid gap-6 lg:grid-cols-3">
          <Section
            className="lg:col-span-2"
            title="Cómo funciona"
            headerIcon={<Sparkles className="h-4 w-4 text-primary" />}
            description="El portal es la consola de tu tienda. El agente habla con tus clientes, cotiza contra el backend y manda el enlace de pago."
          >
            <ol className="grid gap-3 sm:grid-cols-3">
              <Step num="1" title="Carga tu catálogo" desc="Productos, variantes, stock y claves SAT." />
              <Step num="2" title="Conecta canales" desc="Web, WhatsApp Meta o Evolution/Baileys." />
              <Step
                num="3"
                title="Cobra en modo de pruebas"
                desc="El agente emite cotización y la pasarela de pruebas simula el pago."
              />
            </ol>
          </Section>

          <Section
            title="Estado del sistema"
            headerIcon={<ShieldCheck className="h-4 w-4 text-primary" />}
            description="Variables operativas del entorno actual."
          >
            <DescriptionList divided>
              <FieldRow label="Proveedor de pago">Modo de pruebas (simulado)</FieldRow>
              <FieldRow label="Modo producción">
                <Badge variant="neutral">Desactivado</Badge>
              </FieldRow>
              <FieldRow label="Multi-tenant">Aislado en SQL, caché y storage</FieldRow>
              <FieldRow label="MFA">Requerido para propietarios</FieldRow>
              <FieldRow label="Idempotencia">Obligatoria en mutaciones</FieldRow>
            </DescriptionList>
          </Section>
        </div>

        <Section
          title="¿Necesitas ajustar algo?"
          description={
            <>
              Toda la configuración vive en el panel admin. Las reglas de negocio se editan en los
              Markdown de{" "}
              <code className="font-mono text-xs">apps/agent-service/knowledge</code>.
            </>
          }
        >
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/admin">
                <Settings className="h-4 w-4" />
                Admin
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/agent">Consola del agente</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/catalog">Ver catálogo</Link>
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Shortcut({
  href,
  title,
  desc,
  icon: Icon,
}: {
  href: string;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <li>
      <Card asChild className="h-full">
        <Link
          href={href}
          className="group block h-full p-4 shadow-airbnb transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
        >
          <div className="flex items-center justify-between">
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary"
            >
              <Icon className="h-4 w-4" />
            </span>
            <ArrowRight
              aria-hidden
              className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            />
          </div>
          <h3 className="mt-3 text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
        </Link>
      </Card>
    </li>
  );
}

function Step({ num, title, desc }: { num: string; title: string; desc: string }) {
  return (
    <li className="rounded-card border bg-muted p-3">
      <span className="text-xs font-semibold tabular-nums text-primary-strong">Paso {num}</span>
      <p className="mt-1 text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
    </li>
  );
}
