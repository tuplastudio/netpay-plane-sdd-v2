"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Copy,
  Download,
  ExternalLink,
  Link2,
  ReceiptText,
  Send,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SkeletonText } from "@/components/ui/skeleton";
import {
  DELIVERY_MODE_LABELS,
  SOURCE_LABELS,
  StatusBadge,
} from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DateTime } from "@/components/app/date-time";
import { DetailLinesTable } from "@/components/app/detail-lines-table";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { Money } from "@/components/app/money";
import { useReply, useSendQuoteMessage, type Conversation } from "./use-conversations";
import { useShareQuote, type TimelineEvent } from "./use-conversation-context";
import {
  useOrderDetail,
  usePaymentSessionDetail,
  useQuoteDetail,
  useResumeCheckout,
  type OrderDetail,
  type PaymentSessionDetail,
  type QuoteDetail,
} from "./use-entity-details";

/**
 * Detalle de un pedido / cotización / pago / evento SOBRE la conversación, en
 * una hoja lateral. El agente que está contestando "¿ya llegó mi pago?" no
 * debería tener que abandonar el hilo (perdiendo el borrador, el scroll y el
 * contexto del cliente) para responder algo que el API ya sabe.
 *
 * Es una hoja derecha y no un modal centrado porque tres de los cuatro
 * contenidos son tablas (líneas, ledger, sesiones de cobro): un modal centrado
 * las estrangula, y mezclar formas por tipo haría que cada fila del panel se
 * comporte distinto.
 *
 * "Abrir en su página" sigue ahí, discreto: quien quiera la pantalla completa
 * (editar la cotización, reembolsar, cancelar el pedido) la tiene a un clic —
 * simplemente ya no es el ÚNICO camino.
 */

// ---------------------------------------------------------------------------
// Qué se puede abrir
// ---------------------------------------------------------------------------

export type EntityTarget =
  | { kind: "order"; id: string }
  | { kind: "quote"; id: string }
  | { kind: "payment"; id: string }
  /** Evento sin entidad detrás (nota, handoff, cierre, etiquetas). */
  | { kind: "event"; event: TimelineEvent };

/**
 * Traduce el `href` de la línea de tiempo (que el API arma como ruta del
 * portal) al objetivo de la hoja. Un evento sin `href` —o con uno que no
 * reconocemos— se abre como evento, no como enlace roto.
 */
export function targetForTimelineEvent(event: TimelineEvent): EntityTarget {
  const href = event.href ?? "";
  const order = /^\/orders\/([^/?#]+)/.exec(href)?.[1];
  if (order) return { kind: "order", id: order };
  const quote = /^\/quotes\/([^/?#]+)/.exec(href)?.[1];
  if (quote) return { kind: "quote", id: quote };
  const payment = /^\/payments\/([^/?#]+)/.exec(href)?.[1];
  if (payment) return { kind: "payment", id: payment };
  return { kind: "event", event };
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado al portapapeles`);
  } catch {
    toast.message(label, { description: text });
  }
}

function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

// ---------------------------------------------------------------------------
// Andamio común de las cuatro hojas
// ---------------------------------------------------------------------------

function DetailShell({
  title,
  meta,
  actions,
  onBack,
  children,
}: {
  title: string;
  meta?: ReactNode;
  /** Botones de la hoja, incluido "Abrir en su página". */
  actions?: ReactNode;
  /** Presente solo cuando se llegó aquí desde otra hoja (pedido → pago). */
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <SheetHeader className="pr-8">
        <div className="flex items-center gap-2">
          {onBack ? (
            <Button
              variant="ghost"
              size="icon"
              className="-ml-2 h-7 w-7 shrink-0"
              onClick={onBack}
              aria-label="Volver al detalle anterior"
            >
              <ArrowLeft aria-hidden className="h-4 w-4" />
            </Button>
          ) : null}
          <SheetTitle className="text-base">{title}</SheetTitle>
        </div>
        {/* La descripción se rinde SIEMPRE, también mientras carga: Radix exige
            que el `aria-describedby` del diálogo apunte a algo que exista, y si
            apareciera solo al llegar el dato el diálogo nacería mal descrito. */}
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {meta ?? "Cargando el detalle…"}
          </div>
        </SheetDescription>
      </SheetHeader>
      {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
      <div className="mt-4 space-y-5 pb-6">{children}</div>
    </>
  );
}

/** Enlace discreto a la pantalla completa: no se pierde, pero deja de ser el único camino. */
function OpenInPageLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
      <Link href={href}>
        <ExternalLink aria-hidden className="h-3.5 w-3.5" />
        {children}
      </Link>
    </Button>
  );
}

/** Bloque interno de la hoja: título pequeño + contenido, sin la tarjeta de `Section`. */
function Block({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * Carga / error / dato de una hoja. Las tres consultas se disparan al ABRIR,
 * así que el estado de carga no es un detalle cosmético: es lo que se ve
 * siempre durante el primer viaje al API.
 */
function AsyncBody<T>({
  query,
  label,
  errorTitle,
  children,
}: {
  query: UseQueryResult<T>;
  label: string;
  errorTitle: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) {
    return <SkeletonText lines={6} announce label={label} />;
  }
  if (query.isError || !query.data) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>{errorTitle}</AlertTitle>
        <AlertDescription>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return <>{children(query.data)}</>;
}

// ---------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------

const OPEN_CHECKOUT_STATUSES = new Set(["CHECKOUT_OPEN", "AWAITING_PAYMENT"]);

function OrderBody({
  id,
  onBack,
  onOpen,
}: {
  id: string;
  onBack?: () => void;
  onOpen: (target: EntityTarget) => void;
}) {
  const query = useOrderDetail(id);
  const resume = useResumeCheckout(id);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);

  // Cambiar de pedido (pedido → pago → otro pedido) no debe arrastrar el link
  // del anterior: es un cobro distinto.
  useEffect(() => setPaymentLink(null), [id]);

  const order = query.data;
  const canPay = !!order && OPEN_CHECKOUT_STATUSES.has(order.status);
  const currentRevision = order?.revisions.find((r) => r.id === order.currentRevisionId);

  return (
    <DetailShell
      title={`Pedido ${shortId(id)}`}
      onBack={onBack}
      meta={
        order ? (
          <>
            <StatusBadge status={order.status} domain="order" withDot />
            <span>{SOURCE_LABELS[order.source] ?? order.source}</span>
            <span aria-hidden>·</span>
            <DateTime value={order.createdAt} />
          </>
        ) : null
      }
      actions={
        <>
          {canPay ? (
            <Button
              size="sm"
              loading={resume.isPending}
              onClick={() =>
                resume.mutate(undefined, {
                  onSuccess: (url) => {
                    setPaymentLink(url);
                    void copyToClipboard(url, "Link de pago");
                  },
                })
              }
            >
              <Link2 aria-hidden className="h-3.5 w-3.5" />
              Link de pago
            </Button>
          ) : null}
          <OpenInPageLink href={`/orders/${id}`}>Abrir en su página</OpenInPageLink>
        </>
      }
    >
      <AsyncBody
        query={query}
        label="Cargando el pedido…"
        errorTitle="No se pudo cargar el pedido"
      >
        {(o: OrderDetail) => (
          <>
            {paymentLink ? (
              <Alert variant="success">
                <Link2 />
                <AlertTitle>Link de pago listo</AlertTitle>
                <AlertDescription>
                  <a
                    href={paymentLink}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all underline underline-offset-4"
                  >
                    {paymentLink}
                  </a>
                </AlertDescription>
              </Alert>
            ) : null}

            <Block title="Fechas y entrega">
              <DescriptionList divided>
                <FieldRow label="Creado">
                  <DateTime value={o.createdAt} />
                </FieldRow>
                <FieldRow label="Confirmado">
                  <DateTime value={o.placedAt} />
                </FieldRow>
                <FieldRow label="Pagado">
                  <DateTime value={o.paidAt} />
                </FieldRow>
                <FieldRow label="Entrega">
                  {currentRevision
                    ? DELIVERY_MODE_LABELS[currentRevision.deliveryMode] ??
                      currentRevision.deliveryMode
                    : null}
                </FieldRow>
                <FieldRow label="Descripción">{o.description}</FieldRow>
              </DescriptionList>
            </Block>

            <Block title="Líneas del pedido">
              {o.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Todavía sin líneas: se registran al iniciar el checkout.
                </p>
              ) : (
                <div className="overflow-hidden rounded-card border">
                  <DetailLinesTable
                    lines={o.lines.map((l) => ({
                      key: l.variantId,
                      variantId: l.variantId,
                      sku: l.sku ?? "—",
                      title: l.productTitle
                        ? `${l.productTitle} — ${l.title ?? shortId(l.variantId)}`
                        : l.title ?? shortId(l.variantId),
                      quantity: l.quantity,
                      unitPrice: l.unitPrice ?? "0",
                      lineSubtotal: l.lineTotal ?? "0",
                    }))}
                    total={o.total}
                    footerLabel="Total del pedido"
                    showDiscount={false}
                  />
                </div>
              )}
            </Block>

            <Block title="Totales">
              <DescriptionList divided>
                <FieldRow label="Subtotal" numeric>
                  <Money value={o.subtotal} />
                </FieldRow>
                <FieldRow label="Descuento" numeric>
                  <Money value={o.discount} />
                </FieldRow>
                <FieldRow label="IVA" numeric>
                  <Money value={o.tax} />
                </FieldRow>
                <FieldRow label="Envío" numeric>
                  <Money value={o.shipping} />
                </FieldRow>
                <FieldRow label="Total" numeric emphasis>
                  <Money value={o.total} emphasis showCurrency />
                </FieldRow>
              </DescriptionList>
            </Block>

            {o.requiresInvoice ? (
              <Block title="Facturación (CFDI)">
                <DescriptionList divided>
                  <FieldRow label="Estado">
                    <StatusBadge status={o.invoiceStatus} domain="generic" withDot />
                  </FieldRow>
                  <FieldRow label="RFC" mono>
                    {o.invoiceRfc}
                  </FieldRow>
                  <FieldRow label="Razón social">{o.invoiceLegalName}</FieldRow>
                  <FieldRow label="CP fiscal" mono>
                    {o.invoicePostalCode}
                  </FieldRow>
                  <FieldRow label="Uso de CFDI" mono>
                    {o.invoiceCfdiUse}
                  </FieldRow>
                  <FieldRow label="Pedida el">
                    <DateTime value={o.invoiceRequestedAt} />
                  </FieldRow>
                </DescriptionList>
              </Block>
            ) : null}

            <Block title={`Sesiones de pago (${o.payments.length})`}>
              {o.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sin cobros abiertos para este pedido.
                </p>
              ) : (
                <ul className="space-y-1">
                  {o.payments.map((p) => (
                    <li key={p.id}>
                      <EntityRowButton
                        label={`Ver la sesión de pago ${shortId(p.id)}`}
                        onClick={() => onOpen({ kind: "payment", id: p.id })}
                      >
                        <span className="flex min-w-0 flex-col gap-1">
                          <StatusBadge status={p.status} domain="payment" size="sm" withDot />
                          <DateTime
                            value={p.capturedAt ?? p.failedAt ?? p.createdAt}
                            className="text-muted-foreground"
                          />
                        </span>
                        <Money
                          value={p.amount}
                          currency={p.currency}
                          className="shrink-0 font-medium"
                        />
                      </EntityRowButton>
                    </li>
                  ))}
                </ul>
              )}
            </Block>

            {o.quoteId ? (
              <Block title="Origen">
                <EntityRowButton
                  label={`Ver la cotización ${shortId(o.quoteId)}`}
                  onClick={() => onOpen({ kind: "quote", id: o.quoteId! })}
                >
                  <span className="flex items-center gap-1.5">
                    <Badge variant="neutral" size="sm">
                      Cotización
                    </Badge>
                    <span className="font-mono text-muted-foreground">{shortId(o.quoteId)}</span>
                  </span>
                </EntityRowButton>
              </Block>
            ) : null}
          </>
        )}
      </AsyncBody>
    </DetailShell>
  );
}

// ---------------------------------------------------------------------------
// Cotización
// ---------------------------------------------------------------------------

function QuoteBody({
  id,
  conversation,
  onBack,
  onOpen,
}: {
  id: string;
  conversation: Conversation;
  onBack?: () => void;
  onOpen: (target: EntityTarget) => void;
}) {
  const query = useQuoteDetail(id);
  const share = useShareQuote();
  const reply = useReply(conversation.id);
  const sendQuote = useSendQuoteMessage(conversation.id);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);

  useEffect(() => setPublicUrl(null), [id]);

  const quote = query.data;

  /** Mismo camino que el cotizador rápido: link público + mensaje por el canal vivo. */
  const sendOverWhatsApp = useCallback(async () => {
    const token = await share.mutateAsync(id);
    const url = `${window.location.origin}/quotes/public/${token}`;
    setPublicUrl(url);
    const text = `Aquí tienes tu cotización: ${url}`;
    if (conversation.handoffToHuman) reply.mutate(text);
    else sendQuote.mutate(text);
  }, [conversation.handoffToHuman, id, reply, sendQuote, share]);

  const sending = share.isPending || reply.isPending || sendQuote.isPending;

  return (
    <DetailShell
      title={`Cotización ${shortId(id)}`}
      onBack={onBack}
      meta={
        quote ? (
          <>
            <StatusBadge status={quote.status} domain="quote" withDot />
            <span>
              Vence <DateTime value={quote.expiresAt} />
            </span>
            {quote.version > 1 ? (
              <>
                <span aria-hidden>·</span>
                <span>Versión {quote.version}</span>
              </>
            ) : null}
          </>
        ) : null
      }
      actions={
        <>
          <Button size="sm" loading={sending} onClick={() => void sendOverWhatsApp()}>
            <Send aria-hidden className="h-3.5 w-3.5" />
            Enviar por WhatsApp
          </Button>
          <Button
            variant="outline"
            size="sm"
            loading={share.isPending}
            onClick={() =>
              share.mutate(id, {
                onSuccess: (token) => {
                  const url = `${window.location.origin}/quotes/public/${token}`;
                  setPublicUrl(url);
                  void copyToClipboard(url, "Link de la cotización");
                },
              })
            }
          >
            <Share2 aria-hidden className="h-3.5 w-3.5" />
            Link público
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/v1/quotes/${id}/pdf`} target="_blank" rel="noreferrer">
              <Download aria-hidden className="h-3.5 w-3.5" />
              Recibo
            </a>
          </Button>
          <OpenInPageLink href={`/quotes/${id}`}>Abrir en su página</OpenInPageLink>
        </>
      }
    >
      <AsyncBody
        query={query}
        label="Cargando la cotización…"
        errorTitle="No se pudo cargar la cotización"
      >
        {(q: QuoteDetail) => (
          <>
            {publicUrl ? (
              <Alert variant="info">
                <Share2 />
                <AlertTitle>Link público</AlertTitle>
                <AlertDescription>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all underline underline-offset-4"
                    >
                      {publicUrl}
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copyToClipboard(publicUrl, "Link de la cotización")}
                    >
                      <Copy aria-hidden className="h-3.5 w-3.5" />
                      Copiar
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            <Block title="Líneas">
              <div className="overflow-hidden rounded-card border">
                <DetailLinesTable
                  lines={q.lines.map((l) => ({
                    key: l.id,
                    variantId: l.variantId,
                    sku: l.sku,
                    title: l.title,
                    quantity: l.quantity,
                    unitPrice: l.unitPrice,
                    discountPct: l.discountPct,
                    lineSubtotal: l.lineSubtotal,
                  }))}
                  total={q.total}
                  footerLabel="Total de la cotización"
                />
              </div>
            </Block>

            <Block title="Totales y vigencia">
              <DescriptionList divided>
                <FieldRow label="Subtotal" numeric>
                  <Money value={q.subtotal} />
                </FieldRow>
                <FieldRow label="Descuento" numeric>
                  <Money value={q.discount} />
                </FieldRow>
                <FieldRow label="IVA" numeric>
                  <Money value={q.tax} />
                </FieldRow>
                <FieldRow label="Envío" numeric>
                  <Money value={q.shipping} />
                </FieldRow>
                <FieldRow label="Total" numeric emphasis>
                  <Money value={q.total} emphasis showCurrency />
                </FieldRow>
                <FieldRow label="Vence">
                  <DateTime value={q.expiresAt} />
                </FieldRow>
                <FieldRow label="Notas">{q.notes}</FieldRow>
              </DescriptionList>
            </Block>

            {q.order ? (
              <Block title="Pedido generado">
                <EntityRowButton
                  label={`Ver el pedido ${shortId(q.order.id)}`}
                  onClick={() => onOpen({ kind: "order", id: q.order!.id })}
                >
                  <span className="flex items-center gap-1.5">
                    <Badge variant="info" size="sm">
                      Pedido
                    </Badge>
                    <StatusBadge status={q.order.status} domain="order" size="sm" />
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {shortId(q.order.id)}
                  </span>
                </EntityRowButton>
              </Block>
            ) : null}
          </>
        )}
      </AsyncBody>
    </DetailShell>
  );
}

// ---------------------------------------------------------------------------
// Pago
// ---------------------------------------------------------------------------

function PaymentBody({
  id,
  onBack,
  onOpen,
}: {
  id: string;
  onBack?: () => void;
  onOpen: (target: EntityTarget) => void;
}) {
  const query = usePaymentSessionDetail(id);
  const session = query.data;

  return (
    <DetailShell
      title={`Pago ${shortId(id)}`}
      onBack={onBack}
      meta={
        session ? (
          <>
            <StatusBadge status={session.status} domain="payment" withDot />
            <Badge variant={session.livemode ? "info" : "neutral"} size="sm">
              {session.livemode ? "Livemode" : "Modo de pruebas"}
            </Badge>
          </>
        ) : null
      }
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => void copyToClipboard(id, "ID de sesión")}>
            <Copy aria-hidden className="h-3.5 w-3.5" />
            Copiar ID
          </Button>
          <OpenInPageLink href={`/payments/${id}`}>Abrir en su página</OpenInPageLink>
        </>
      }
    >
      <AsyncBody
        query={query}
        label="Cargando el pago…"
        errorTitle="No se pudo cargar la sesión de pago"
      >
        {(s: PaymentSessionDetail) => (
          <>
            <Block title="Importes">
              <DescriptionList divided>
                <FieldRow label="Monto" numeric>
                  <Money value={s.amount} currency={s.currency} />
                </FieldRow>
                <FieldRow label="Reembolsado" numeric>
                  <Money value={s.refundedTotal} currency={s.currency} />
                </FieldRow>
                <FieldRow label="Neto" numeric emphasis>
                  <Money value={s.netTotal} currency={s.currency} emphasis showCurrency />
                </FieldRow>
              </DescriptionList>
            </Block>

            <Block title="Fechas">
              <DescriptionList divided>
                <FieldRow label="Sesión creada">
                  <DateTime value={s.createdAt} />
                </FieldRow>
                <FieldRow label="Cobrado">
                  <DateTime value={s.capturedAt} />
                </FieldRow>
                <FieldRow label="Fallido">
                  <DateTime value={s.failedAt} />
                </FieldRow>
                <FieldRow label="Vence">
                  <DateTime value={s.expiresAt} />
                </FieldRow>
              </DescriptionList>
            </Block>

            <Block title={`Ledger (${s.ledger.length})`}>
              {s.ledger.length === 0 ? (
                <EmptyState
                  icon={<ReceiptText className="h-5 w-5" />}
                  title="Sin movimientos"
                  description="El cargo se asienta cuando el gateway confirma la captura."
                />
              ) : (
                <div className="overflow-hidden rounded-card border">
                  <Table>
                    <TableHeader>
                      <TableRow interactive={false}>
                        <TableHead>Tipo</TableHead>
                        <TableHead numeric>Monto</TableHead>
                        <TableHead numeric>Saldo</TableHead>
                        <TableHead>Fecha</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {s.ledger.map((l) => (
                        <TableRow key={l.id} interactive={false}>
                          <TableCell>
                            <StatusBadge status={l.entryType} domain="ledger" size="sm" />
                            <span className="block text-xs text-muted-foreground">
                              {l.description}
                            </span>
                          </TableCell>
                          <TableCell numeric>
                            <Money value={l.amount} currency={s.currency} />
                          </TableCell>
                          <TableCell numeric>
                            <Money
                              value={l.balanceAfter}
                              currency={s.currency}
                              className="text-muted-foreground"
                            />
                          </TableCell>
                          <TableCell>
                            <DateTime
                              value={l.recordedAt}
                              className="text-xs text-muted-foreground"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Block>

            <Block title="Pedido cobrado">
              <EntityRowButton
                label={`Ver el pedido ${shortId(s.orderId)}`}
                onClick={() => onOpen({ kind: "order", id: s.orderId })}
              >
                <span className="flex items-center gap-1.5">
                  <StatusBadge status={s.order.status} domain="order" size="sm" />
                  <span className="text-muted-foreground">
                    {SOURCE_LABELS[s.order.source] ?? s.order.source}
                  </span>
                </span>
                <Money value={s.order.total} className="shrink-0 font-medium" />
              </EntityRowButton>
            </Block>
          </>
        )}
      </AsyncBody>
    </DetailShell>
  );
}

// ---------------------------------------------------------------------------
// Evento sin entidad (nota, handoff, cierre, etiquetas)
// ---------------------------------------------------------------------------

const EVENT_KIND_LABELS: Record<TimelineEvent["kind"], string> = {
  conversation: "Conversación",
  note: "Nota interna",
  quote: "Cotización",
  order: "Pedido",
  payment: "Pago",
  system: "Actividad del equipo",
};

function EventBody({ event, onBack }: { event: TimelineEvent; onBack?: () => void }) {
  return (
    <DetailShell
      title={event.title}
      onBack={onBack}
      meta={
        <>
          <Badge variant="neutral" size="sm">
            {EVENT_KIND_LABELS[event.kind]}
          </Badge>
          <DateTime value={event.at} />
        </>
      }
    >
      {/* Sin truncar: el panel recorta a una línea, aquí se lee completo. */}
      {event.detail ? (
        <p className="whitespace-pre-wrap break-words rounded-card border border-border bg-muted/40 p-3 text-sm">
          {event.detail}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Este evento no registró más detalle.</p>
      )}
      <DescriptionList divided>
        <FieldRow label="Cuándo">
          <DateTime value={event.at} />
        </FieldRow>
        <FieldRow label="Quién">{event.actor}</FieldRow>
        {event.status && event.statusDomain ? (
          <FieldRow label="Estado">
            <StatusBadge status={event.status} domain={event.statusDomain} withDot />
          </FieldRow>
        ) : null}
        {event.amount ? (
          <FieldRow label="Importe" numeric>
            <Money value={event.amount} />
          </FieldRow>
        ) : null}
      </DescriptionList>
    </DetailShell>
  );
}

// ---------------------------------------------------------------------------
// Fila abrible (compartida con el panel de contexto)
// ---------------------------------------------------------------------------

/**
 * Renglón que abre una hoja. Es un `<button>` y no un `<Link>` a propósito:
 * navegar fuera de la bandeja era justo lo que se quería dejar de hacer. El
 * estado de hover es explícito (fondo + borde) para que se lea como
 * "esto se abre", no como texto suelto.
 */
export function EntityRowButton({
  label,
  onClick,
  children,
  className,
}: {
  /** Nombre accesible de la fila ("Ver el pedido 1a2b3c4d"). */
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={[
        "flex w-full items-center justify-between gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-xs",
        "transition-colors hover:border-border hover:bg-muted",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        className ?? "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Hoja
// ---------------------------------------------------------------------------

export function EntityDetailSheet({
  target,
  conversation,
  onOpenChange,
}: {
  target: EntityTarget | null;
  conversation: Conversation;
  onOpenChange: (open: boolean) => void;
}) {
  // Pila interna: desde un pedido se puede saltar a su pago (y volver) sin
  // perder de vista de dónde se venía. El objetivo que llega por props es
  // siempre el fondo de la pila.
  const [stack, setStack] = useState<EntityTarget[]>([]);
  useEffect(() => setStack(target ? [target] : []), [target]);

  const top = stack[stack.length - 1] ?? target;
  const push = useCallback((next: EntityTarget) => setStack((prev) => [...prev, next]), []);
  const pop = useCallback(() => setStack((prev) => prev.slice(0, -1)), []);
  const onBack = stack.length > 1 ? pop : undefined;

  // Los eventos sueltos son cuatro renglones; los otros tres traen tablas.
  const narrow = top?.kind === "event";

  return (
    <Sheet open={!!target} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        title="Detalle"
        className={
          narrow
            ? "w-full overflow-y-auto sm:max-w-md"
            : "w-full overflow-y-auto sm:max-w-xl lg:max-w-2xl"
        }
      >
        {!top ? null : top.kind === "order" ? (
          <OrderBody key={top.id} id={top.id} onBack={onBack} onOpen={push} />
        ) : top.kind === "quote" ? (
          <QuoteBody
            key={top.id}
            id={top.id}
            conversation={conversation}
            onBack={onBack}
            onOpen={push}
          />
        ) : top.kind === "payment" ? (
          <PaymentBody key={top.id} id={top.id} onBack={onBack} onOpen={push} />
        ) : (
          <EventBody key={top.event.id} event={top.event} onBack={onBack} />
        )}
      </SheetContent>
    </Sheet>
  );
}
