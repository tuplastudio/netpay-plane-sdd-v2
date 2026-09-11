"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  CreditCard,
  FileText,
  History,
  Receipt,
  StickyNote,
  UserPlus,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateTime } from "@/components/app/date-time";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { Money, formatMoney } from "@/components/app/money";
import { Section } from "@/components/app/section";
import { type Conversation } from "./use-conversations";
import {
  useConversationContext,
  useCreateAndLinkCustomer,
  type ConversationContext,
  type TimelineEvent,
} from "./use-conversation-context";
import {
  EntityDetailSheet,
  EntityRowButton,
  targetForTimelineEvent,
  type EntityTarget,
} from "./entity-detail-sheet";
import { QuickQuoteSheet } from "./quick-quote-sheet";

/**
 * Panel de contexto de la conversación (columna derecha en lg+, `Sheet` en
 * móvil). El objetivo es que un agente conteste CUALQUIER pregunta del cliente
 * sin salir de la bandeja: quién es, cuánto ha gastado, qué le cotizamos, qué
 * pidió, si ya cayó su pago y qué ha pasado con él.
 *
 * **Cómo se mantiene escaneable.** Lo que siempre está a la vista es lo que se
 * pregunta primero (identidad, KPIs y lo que está abierto ahora mismo) más las
 * notas internas — "ojo: cliente molesto por el envío pasado" no puede vivir
 * escondido detrás de una pestaña. El detalle largo (compras, pagos,
 * actividad) va en pestañas, no apilado: en una columna de 22rem un scroll
 * infinito es lo mismo que no tener la información.
 *
 * **De dónde salen los datos.** De UNA lectura
 * (`GET /whatsapp/conversations/:id/context`). Antes eran `/customers/:id` y
 * `/customers/:id/history` cosidos en el navegador, y no había manera de ver
 * pagos ni actividad.
 *
 * **Nada de aquí navega fuera.** Los renglones de Compras / Pagos / Actividad
 * abren su detalle completo en una hoja lateral (`EntityDetailSheet`) que se
 * pide al API en ese momento; el resumen que se ve en la lista es solo el
 * anzuelo. Antes eran `<Link>` a `/orders/:id` y compañía: contestar "¿qué
 * traía mi pedido?" costaba salir del hilo, perder el borrador y volver.
 */

// ---------------------------------------------------------------------------
// Identidad y alta rápida
// ---------------------------------------------------------------------------

/** Alta rápida cuando el hilo llega de un número sin ficha de cliente.
 *
 * El copy refuerza la regla de negocio ("el agente no puede cotizar sin
 * nombre") para que la persona que está atendiendo pida el dato al cliente
 * en su primer mensaje, en vez de descubrirlo al fallar `emitir_cotizacion`.
 */
function CreateCustomerCard({ conversation }: { conversation: Conversation }) {
  const createAndLink = useCreateAndLinkCustomer(conversation.id);
  const [creating, setCreating] = useState(false);
  const [fullName, setFullName] = useState("");

  return (
    <Section title="Cliente" headerIcon={<UserRound className="h-4 w-4" />} density="compact">
      {creating ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!fullName.trim()) return;
            createAndLink.mutate(
              { fullName: fullName.trim(), phone: conversation.externalPhone },
              { onSuccess: () => setCreating(false) },
            );
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="new-customer-name" className="text-xs">
              Nombre
            </Label>
            <Input
              id="new-customer-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nombre del cliente"
              autoFocus
            />
          </div>
          <p className="font-mono text-xs text-muted-foreground">{conversation.externalPhone}</p>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={!fullName.trim()}
              loading={createAndLink.isPending}
            >
              Crear y vincular
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Este número (<span className="font-mono">{conversation.externalPhone}</span>) no tiene
            ficha de cliente. Sin nombre no hay historial, pagos ni cotizador: el agente de IA no
            puede emitir la cotización.
          </p>
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <UserPlus aria-hidden className="h-3.5 w-3.5" />
            Crear cliente con su nombre
          </Button>
        </div>
      )}
    </Section>
  );
}

/** "4 pedidos", "1 cotización": español, sin `(s)` entre paréntesis. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Quién es, desde cuándo y cuánto vale: lo primero que se mira del panel. */
function IdentityCard({ context }: { context: ConversationContext }) {
  const customer = context.customer!;
  const { metrics } = context;
  return (
    <Section
      title="Cliente"
      headerIcon={<UserRound className="h-4 w-4" />}
      density="compact"
      actions={
        <Button size="sm" variant="outline" asChild>
          <Link href={`/customers/${customer.id}`}>Ver ficha</Link>
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="space-y-0.5">
          <Link
            href={`/customers/${customer.id}`}
            className="text-sm font-semibold underline-offset-2 hover:underline"
          >
            {customer.fullName}
          </Link>
          {customer.status !== "ACTIVE" ? (
            <Badge variant="warning" size="sm">
              Archivado
            </Badge>
          ) : null}
          {/* Los KPIs vivían en tres `StatTile` (≈96px de alto) que empujaban
              notas, "En curso" y las pestañas bajo el pliegue de una columna de
              24rem. Son tres números que se leen de un vistazo: caben en una
              línea, y el detalle real está a un clic en las pestañas. */}
          <p className="text-xs text-muted-foreground" title={`${metrics.paidOrders} pagado(s)`}>
            {plural(metrics.orderCount, "pedido", "pedidos")}
            {" · "}
            {plural(metrics.quoteCount, "cotización", "cotizaciones")}
            {" · "}
            <Money value={metrics.totalSpend} className="font-medium text-foreground" /> gastado
          </p>
        </div>

        <DescriptionList>
          <FieldRow label="Teléfono" mono>
            {customer.phone ?? context.conversation.externalPhone}
          </FieldRow>
          <FieldRow label="Correo">{customer.email}</FieldRow>
          <FieldRow label="RFC" mono>
            {customer.taxId}
          </FieldRow>
          <FieldRow label="Cliente desde">
            <DateTime value={metrics.firstContactAt} />
          </FieldRow>
        </DescriptionList>
      </div>
    </Section>
  );
}

/**
 * Lo que está vivo ahora mismo. Un hilo de WhatsApp casi siempre trata de la
 * última cotización o del último pedido sin pagar, así que eso va arriba y
 * enlazado, no enterrado en una lista de seis.
 */
function OpenWorkCard({
  context,
  onOpen,
}: {
  context: ConversationContext;
  onOpen: (target: EntityTarget) => void;
}) {
  const openQuote = context.quotes.find((q) => q.id === context.openQuoteId);
  const openOrder = context.orders.find((o) => o.id === context.openOrderId);
  if (!openQuote && !openOrder) return null;

  return (
    <Section title="En curso" headerIcon={<Receipt className="h-4 w-4" />} density="compact">
      <ul className="space-y-1.5">
        {openOrder ? (
          <li>
            <EntityRowButton
              className="border-border"
              label={`Ver el pedido en curso ${openOrder.id.slice(0, 8)}`}
              onClick={() => onOpen({ kind: "order", id: openOrder.id })}
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-1.5">
                  <Badge variant="info" size="sm">
                    Pedido
                  </Badge>
                  <StatusBadge status={openOrder.status} domain="order" size="sm" />
                </span>
                <DateTime value={openOrder.createdAt} className="text-muted-foreground" />
              </span>
              <Money value={openOrder.total} className="shrink-0 font-medium" />
            </EntityRowButton>
          </li>
        ) : null}
        {openQuote ? (
          <li>
            <EntityRowButton
              className="border-border"
              label={`Ver la cotización en curso ${openQuote.id.slice(0, 8)}`}
              onClick={() => onOpen({ kind: "quote", id: openQuote.id })}
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-1.5">
                  <Badge variant="neutral" size="sm">
                    Cotización
                  </Badge>
                  <StatusBadge status={openQuote.status} domain="quote" size="sm" />
                </span>
                <span className="text-muted-foreground">
                  Vence <DateTime value={openQuote.expiresAt} />
                </span>
              </span>
              <Money value={openQuote.total} className="shrink-0 font-medium" />
            </EntityRowButton>
          </li>
        ) : null}
      </ul>
    </Section>
  );
}

/**
 * Notas internas del hilo, siempre visibles. Antes solo existían detrás de la
 * pestaña "Notas del hilo": un aviso como "cliente molesto por el envío
 * pasado" no sirve de nada si hay que ir a buscarlo.
 */
function NotesCard({ notes }: { notes: ConversationContext["notes"] }) {
  if (notes.length === 0) return null;
  return (
    <Section
      title="Notas internas"
      headerIcon={<StickyNote className="h-4 w-4" />}
      description="El cliente nunca las ve."
      density="compact"
    >
      <ul className="space-y-1.5">
        {notes.slice(0, 3).map((n) => (
          <li
            key={n.id}
            className="rounded-lg border border-warning-subtle bg-warning-subtle/40 px-2 py-1.5 text-xs"
          >
            <p className="whitespace-pre-wrap break-words text-foreground">{n.body}</p>
            <p className="mt-0.5 text-muted-foreground">
              {n.author?.fullName ?? "Sin autor"} · <DateTime value={n.createdAt} />
            </p>
          </li>
        ))}
        {notes.length > 3 ? (
          <li className="text-[11px] text-muted-foreground">
            +{notes.length - 3} más en la pestaña «Notas del hilo».
          </li>
        ) : null}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Pestañas de detalle
// ---------------------------------------------------------------------------

type PurchaseRow = {
  kind: "order" | "quote";
  id: string;
  status: string;
  total: string;
  at: string;
};

/** Compras: pedidos y cotizaciones fusionados, del más reciente al más viejo. */
function PurchasesPane({
  context,
  onOpen,
}: {
  context: ConversationContext;
  onOpen: (target: EntityTarget) => void;
}) {
  const rows = useMemo<PurchaseRow[]>(() => {
    const merged: PurchaseRow[] = [
      ...context.orders.map<PurchaseRow>((o) => ({
        kind: "order",
        id: o.id,
        status: o.status,
        total: o.total,
        at: o.createdAt,
      })),
      ...context.quotes.map<PurchaseRow>((q) => ({
        kind: "quote",
        id: q.id,
        status: q.status,
        total: q.total,
        at: q.createdAt,
      })),
    ];
    return merged.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [context.orders, context.quotes]);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<History className="h-5 w-5" />}
        title="Sin movimientos"
        description="Cuando este cliente reciba una cotización o levante un pedido, aparecerá aquí."
      />
    );
  }

  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={`${r.kind}-${r.id}`}>
          <EntityRowButton
            label={`Ver ${r.kind === "order" ? "el pedido" : "la cotización"} ${r.id.slice(0, 8)}`}
            onClick={() => onOpen({ kind: r.kind, id: r.id })}
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge variant={r.kind === "order" ? "info" : "neutral"} size="sm">
                  {r.kind === "order" ? "Pedido" : "Cotización"}
                </Badge>
                <StatusBadge status={r.status} domain={r.kind} size="sm" />
              </span>
              <DateTime value={r.at} className="text-muted-foreground" />
            </span>
            <Money value={r.total} className="shrink-0 font-medium" />
          </EntityRowButton>
        </li>
      ))}
    </ul>
  );
}

/** Pagos: "¿ya me llegó el pago?" es la pregunta más repetida de la bandeja. */
function PaymentsPane({
  context,
  onOpen,
}: {
  context: ConversationContext;
  onOpen: (target: EntityTarget) => void;
}) {
  if (context.payments.length === 0) {
    return (
      <EmptyState
        icon={<CreditCard className="h-5 w-5" />}
        title="Sin cobros"
        description="No se ha abierto ninguna sesión de pago para este cliente."
      />
    );
  }
  return (
    <ul className="space-y-1">
      {context.payments.map((p) => {
        const refunded = Number(p.refundedTotal) > 0;
        return (
          <li key={p.id}>
            <EntityRowButton
              label={`Ver el pago ${p.id.slice(0, 8)}`}
              onClick={() => onOpen({ kind: "payment", id: p.id })}
            >
              <span className="flex min-w-0 flex-col gap-1">
                <StatusBadge status={p.status} domain="payment" size="sm" withDot />
                <DateTime
                  value={p.capturedAt ?? p.createdAt}
                  className="text-muted-foreground"
                />
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <Money value={p.amount} currency={p.currency} className="font-medium" />
                {refunded ? (
                  <span className="text-[10px] text-warning-foreground">
                    −{formatMoney(p.refundedTotal, p.currency)} reembolsado
                  </span>
                ) : null}
              </span>
            </EntityRowButton>
          </li>
        );
      })}
    </ul>
  );
}

/** Punto de color de la línea de tiempo, por tipo de evento. */
const TIMELINE_DOT: Record<TimelineEvent["kind"], string> = {
  conversation: "bg-muted-foreground",
  note: "bg-warning-foreground",
  quote: "bg-info-foreground",
  order: "bg-primary-strong",
  payment: "bg-success-foreground",
  system: "bg-border",
};

/**
 * Qué pasó con este cliente, en orden: hilo, notas, cotizaciones, pedidos,
 * pagos y acciones del equipo.
 *
 * Cada renglón abre algo: si el evento apunta a un pedido/cotización/pago, su
 * hoja de detalle; si es un evento puro (nota, handoff, cierre, etiquetas),
 * una hoja chica con el texto completo — en la lista va recortado a una línea
 * y una nota recortada es una nota que no se leyó.
 */
function TimelinePane({
  events,
  onOpen,
}: {
  events: TimelineEvent[];
  onOpen: (target: EntityTarget) => void;
}) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="h-5 w-5" />}
        title="Sin actividad"
        description="Todavía no hay nada registrado en este hilo."
      />
    );
  }
  return (
    <ol aria-label="Actividad del cliente" className="space-y-0">
      {events.map((e, i) => {
        const body = (
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="font-medium text-foreground">{e.title}</span>
              {e.status && e.statusDomain ? (
                <StatusBadge status={e.status} domain={e.statusDomain} size="sm" />
              ) : null}
              {e.amount ? <Money value={e.amount} className="font-medium" /> : null}
            </span>
            {e.detail ? (
              <span className="line-clamp-1 break-words text-muted-foreground">{e.detail}</span>
            ) : null}
            <span className="text-muted-foreground">
              <DateTime value={e.at} />
              {e.actor ? ` · ${e.actor}` : ""}
            </span>
          </span>
        );
        return (
          <li key={e.id} className="flex gap-2 text-xs">
            {/* Rieles: el punto marca el evento, la línea lo une con el siguiente. */}
            <span aria-hidden className="flex w-2 shrink-0 flex-col items-center pt-1.5">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", TIMELINE_DOT[e.kind])} />
              {i < events.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
            </span>
            <EntityRowButton
              className="flex-1 items-start px-1 py-1"
              label={`Ver el detalle de «${e.title}»`}
              onClick={() => onOpen(targetForTimelineEvent(e))}
            >
              {body}
            </EntityRowButton>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function ConversationContextPanel({ conversation }: { conversation: Conversation | null }) {
  const context = useConversationContext(conversation?.id);
  // Una sola hoja de detalle para todo el panel: el objetivo es estado, no el
  // componente. Así solo se pide al API lo que alguien abrió, y nunca hay dos
  // hojas compitiendo por el foco.
  const [target, setTarget] = useState<EntityTarget | null>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);

  if (!conversation) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Selecciona una conversación para ver el contexto del cliente.
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      {context.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <SkeletonText lines={4} announce label="Cargando el contexto del cliente…" />
        </div>
      ) : context.isError ? (
        <Section title="Cliente" headerIcon={<UserRound className="h-4 w-4" />} density="compact">
          <p className="text-sm text-muted-foreground">No se pudo cargar el contexto.</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => void context.refetch()}
          >
            Reintentar
          </Button>
        </Section>
      ) : context.data ? (
        <>
          {context.data.customer ? (
            <IdentityCard context={context.data} />
          ) : (
            <CreateCustomerCard conversation={conversation} />
          )}

          {/* El cotizador es una hoja, no un bloque: desplegado aquí dentro
              empujaba notas y pestañas fuera de la columna. */}
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={!conversation.customerId}
            title={
              conversation.customerId
                ? undefined
                : "Vincula una ficha de cliente para poder cotizarle."
            }
            onClick={() => setQuoteOpen(true)}
          >
            <FileText aria-hidden className="h-3.5 w-3.5" />
            Cotizar rápido
          </Button>

          <NotesCard notes={context.data.notes} />
          <OpenWorkCard context={context.data} onOpen={setTarget} />

          {/* El detalle largo va en pestañas: en 22rem un scroll infinito es
              lo mismo que no tener la información. */}
          <Section density="compact" padded={false} contentClassName="p-3">
            <Tabs defaultValue="purchases">
              <TabsList aria-label="Detalle del cliente" className="w-full">
                <TabsTrigger value="purchases" className="flex-1">
                  Compras
                </TabsTrigger>
                <TabsTrigger value="payments" className="flex-1">
                  Pagos
                </TabsTrigger>
                <TabsTrigger value="activity" className="flex-1">
                  Actividad
                </TabsTrigger>
              </TabsList>
              <TabsContent value="purchases" className="mt-2">
                <PurchasesPane context={context.data} onOpen={setTarget} />
              </TabsContent>
              <TabsContent value="payments" className="mt-2">
                <PaymentsPane context={context.data} onOpen={setTarget} />
              </TabsContent>
              <TabsContent value="activity" className="mt-2">
                <TimelinePane events={context.data.timeline} onOpen={setTarget} />
              </TabsContent>
            </Tabs>
          </Section>
        </>
      ) : null}

      <EntityDetailSheet
        target={target}
        conversation={conversation}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      />
      <QuickQuoteSheet
        conversation={conversation}
        open={quoteOpen}
        onOpenChange={setQuoteOpen}
      />
    </div>
  );
}
