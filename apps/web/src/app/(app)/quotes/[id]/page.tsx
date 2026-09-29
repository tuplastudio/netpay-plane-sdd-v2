"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle, Copy, Download, ExternalLink, Link2, Pencil, Share2 } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SkeletonText } from "@/components/ui/skeleton";
import { DateTime } from "@/components/app/date-time";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { Money } from "@/components/app/money";
import { EntityId } from "@/components/app/entity-id";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { StatusBadgeHelp } from "@/components/app/status-help";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QuoteLinesTable } from "./_components/quote-lines-table";
import { EditQuoteSheet } from "./_components/edit-quote-sheet";
import { usePermissions } from "@/components/app/use-permissions";

interface QuoteDetail {
  id: string;
  status: string;
  total: string;
  subtotal: string;
  discount: string;
  tax: string;
  shipping: string;
  expiresAt: string;
  notes: string | null;
  version: number;
  /** Calculado por el API: no cerrada y sin pedido pagado. */
  editable: boolean;
  customer: { fullName: string; email: string | null };
  order: { id: string; status: string } | null;
  lines: Array<{
    id: string;
    variantId: string;
    sku: string;
    title: string;
    quantity: string;
    unitPrice: string;
    discountPct: string;
    lineSubtotal: string;
  }>;
}

interface OrderPayment {
  id: string;
  status: string;
  amount: string;
  currency: string;
  refundedTotal: string;
  capturedAt: string | null;
}

interface OrderDetail {
  id: string;
  status: string;
  total: string;
  paidAt: string | null;
  fulfilledAt: string | null;
  payments: OrderPayment[];
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado al portapapeles`);
  } catch {
    toast.message(label, { description: text });
  }
}

export default function QuoteDetailPage() {
  const params = useParams<{ id: string }>();
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const q = useQuery({
    queryKey: ["quote", params.id],
    queryFn: async () => {
      const res = await api.get<{ data: QuoteDetail }>(`/quotes/${params.id}`);
      return res.data.data;
    },
  });

  const orderId = q.data?.order?.id ?? null;

  // Detalle de pago: cuando la cotización ya generó un pedido, se consulta
  // aparte para mostrar el desglose de intentos de pago (pasarela de pruebas).
  const order = useQuery({
    queryKey: ["order-for-quote", orderId],
    queryFn: async () => {
      const res = await api.get<{ data: OrderDetail }>(`/orders/${orderId}`);
      return res.data.data;
    },
    enabled: !!orderId,
  });

  // Link público de seguimiento del pedido (mismo que reciben los avisos).
  const trackingQ = useQuery({
    queryKey: ["order-tracking-link", orderId],
    queryFn: async () => {
      const res = await api.get<{ data: { link: string } }>(`/orders/${orderId}/tracking-link`);
      return res.data.data.link;
    },
    enabled: !!orderId,
  });

  const perms = usePermissions();
  const canWrite = perms.can("quotes.write");
  // Aprobar crea el pedido y su checkout: eso es `orders.write` (VENDOR cotiza
  // pero no cobra).
  const canApprove = perms.can("orders.write");
  const canReadPayments = perms.can("payments.read");

  const issue = useMutation({
    mutationFn: async () => {
      const res = await api.patch(`/quotes/${params.id}/issue`);
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success("Cotización emitida");
      await q.refetch();
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const res = await api.patch(`/quotes/${params.id}/cancel`);
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success("Cotización cancelada");
      setCancelConfirmOpen(false);
      await q.refetch();
    },
  });

  // Aprobar: crea el pedido desde la cotización y de una vez abre el
  // checkout con las mismas líneas, para no repetir la selección de
  // variantes que ya están en la cotización.
  const approve = useMutation({
    mutationFn: async () => {
      const orderRes = await api.post(`/orders/from-quote/${params.id}`);
      const createdOrder = orderRes.data.data as { id: string };
      const checkoutRes = await api.post(`/orders/${createdOrder.id}/checkout`, {
        lines: q.data!.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          discountPct: Number(l.discountPct),
        })),
        deliveryMode: "PICKUP",
      });
      const checkoutToken = checkoutRes.data.data.checkoutToken as string;
      return { checkoutToken };
    },
    onSuccess: ({ checkoutToken }) => {
      const url = `${window.location.origin}/checkout/${checkoutToken}`;
      setPaymentLink(url);
      setApproveConfirmOpen(false);
      toast.success("Cotización aprobada: pedido creado y link de pago listo");
      void copyToClipboard(url, "Link de pago");
      void q.refetch();
    },
    onError: () => toast.error("No se pudo aprobar la cotización"),
  });

  const share = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/quotes/${params.id}/share`);
      return res.data.data;
    },
    onSuccess: (data) => {
      setShareToken(data.token);
      toast.success("Link público generado");
    },
  });

  const breadcrumbs = [
    { label: "Cotizaciones", href: "/quotes" },
    { label: `#${params.id.slice(0, 8)}` },
  ];

  if (q.isLoading) {
    return (
      <div>
        <PageHeader title="Cotización" backHref="/quotes" breadcrumbs={breadcrumbs} />
        <Section title="Cargando cotización">
          <SkeletonText lines={4} label="Cargando cotización…" />
        </Section>
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div>
        <PageHeader title="Cotización" backHref="/quotes" breadcrumbs={breadcrumbs} />
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>No se pudo cargar la cotización</AlertTitle>
          <AlertDescription>
            <p>Revisa el identificador o inténtalo de nuevo.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
                Reintentar
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/quotes">Volver a cotizaciones</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const quote = q.data;
  const shortId = quote.id.slice(0, 8);
  const shareUrl =
    shareToken && typeof window !== "undefined"
      ? `${window.location.origin}/quotes/public/${shareToken}`
      : null;

  return (
    <div>
      <PageHeader
        title={`Cotización ${shortId}…`}
        backHref="/quotes"
        breadcrumbs={[{ label: "Cotizaciones", href: "/quotes" }, { label: `#${shortId}` }]}
        meta={
          <>
            <StatusBadgeHelp status={quote.status} domain="quote" />
            <span className="text-foreground">{quote.customer.fullName}</span>
            <span aria-hidden>·</span>
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
        }
        actions={
          <>
            {canWrite && quote.editable && (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                Editar
              </Button>
            )}
            {canWrite && quote.status === "DRAFT" && (
              <Button variant="accent" loading={issue.isPending} onClick={() => issue.mutate()}>
                Emitir
              </Button>
            )}
            {canApprove && quote.status === "ISSUED" && (
              <Button variant="accent" loading={approve.isPending} onClick={() => setApproveConfirmOpen(true)}>
                Aprobar cotización
              </Button>
            )}
            {canWrite && (quote.status === "DRAFT" || quote.status === "ISSUED") && (
              <>
                <Button
                  variant="outline"
                  loading={share.isPending}
                  onClick={() => share.mutate()}
                >
                  <Share2 className="h-4 w-4" />
                  Compartir
                </Button>
                <Button variant="outline" onClick={() => setCancelConfirmOpen(true)}>
                  Cancelar
                </Button>
              </>
            )}
            <Button asChild variant="outline">
              <a href={`/api/v1/quotes/${quote.id}/pdf`} target="_blank" rel="noreferrer">
                <Download className="h-4 w-4" />
                Descargar PDF
              </a>
            </Button>
          </>
        }
      />

      <EditQuoteSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        quoteId={quote.id}
        lines={quote.lines}
        notes={quote.notes}
        status={quote.status}
        hasOrder={!!orderId}
        onSaved={async () => {
          await q.refetch();
          if (orderId) await order.refetch();
        }}
      />

      <ConfirmDialog
        open={cancelConfirmOpen}
        onOpenChange={setCancelConfirmOpen}
        title="¿Cancelar cotización?"
        description="La cotización deja de poder emitirse o aceptarse. No se puede deshacer."
        confirmLabel="Cancelar cotización"
        pending={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />

      <ConfirmDialog
        open={approveConfirmOpen}
        onOpenChange={setApproveConfirmOpen}
        title="¿Aprobar la cotización?"
        description="Se crea el pedido con estas mismas líneas y se abre el checkout con su link de pago. La cotización queda aceptada y no se puede deshacer."
        confirmLabel="Aprobar y cobrar"
        variant="default"
        pending={approve.isPending}
        onConfirm={() => approve.mutate()}
      />

      <div className="space-y-6">
        {paymentLink && (
          <Alert variant="success">
            <Link2 />
            <AlertTitle>Link de pago listo</AlertTitle>
            <AlertDescription>
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={paymentLink}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all underline underline-offset-4"
                >
                  {paymentLink}
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copyToClipboard(paymentLink, "Link de pago")}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copiar
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {shareToken && (
          <Alert variant="info">
            <Share2 />
            <AlertTitle>Link público de la cotización</AlertTitle>
            <AlertDescription>
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={`/quotes/public/${shareToken}`}
                  className="break-all underline underline-offset-4"
                >
                  {shareUrl ?? `/quotes/public/${shareToken}`}
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void copyToClipboard(
                      `${window.location.origin}/quotes/public/${shareToken}`,
                      "Link de la cotización",
                    )
                  }
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copiar
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="space-y-6 md:col-span-2">
            <Section title="Líneas" padded={false}>
              <QuoteLinesTable lines={quote.lines} total={quote.total} />
            </Section>

            <Section
              title="Relacionados"
              description="Pedido generado por esta cotización, sus cobros y el link de seguimiento del cliente."
              actions={
                orderId ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/orders/${orderId}`}>Ver pedido completo</Link>
                  </Button>
                ) : undefined
              }
            >
              {!orderId ? (
                <p className="text-sm text-muted-foreground">
                  Todavía no genera pedido.{" "}
                  {quote.status === "ISSUED"
                    ? "Se crea al aprobarla desde aquí o cuando el cliente la acepta y paga desde su link."
                    : quote.status === "DRAFT"
                      ? "Emítela y compártela para que el cliente pueda aceptarla."
                      : ""}
                </p>
              ) : order.isLoading || !order.data ? (
                <SkeletonText lines={3} label="Cargando pedido…" />
              ) : (
                <DescriptionList divided>
                  <FieldRow label="Pedido">
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadgeHelp status={order.data.status} domain="order" size="sm" />
                      <Link
                        href={`/orders/${orderId}`}
                        className="inline-flex items-center gap-1 font-mono text-xs text-primary-strong underline-offset-4 hover:underline"
                        title={orderId}
                      >
                        {orderId.slice(0, 8)}…
                        <ExternalLink aria-hidden className="h-3 w-3" />
                      </Link>
                      <Money value={order.data.total} className="text-muted-foreground" />
                    </span>
                  </FieldRow>
                  {order.data.paidAt ? (
                    <FieldRow label="Pagado el">
                      <DateTime value={order.data.paidAt} />
                    </FieldRow>
                  ) : null}
                  {order.data.fulfilledAt ? (
                    <FieldRow label="Entregado el">
                      <DateTime value={order.data.fulfilledAt} />
                    </FieldRow>
                  ) : null}
                  <FieldRow label={order.data.payments.length === 1 ? "Pago" : "Pagos"}>
                    {order.data.payments.length === 0 ? (
                      <span className="text-muted-foreground">
                        {order.data.status === "DRAFT"
                          ? "Sin checkout abierto. Inícialo desde el pedido para generar el link de pago."
                          : "Sin sesiones de pago todavía."}
                      </span>
                    ) : (
                      <ul className="space-y-1.5">
                        {order.data.payments.map((p) => (
                          <li key={p.id} className="flex flex-wrap items-center gap-2">
                            <StatusBadgeHelp status={p.status} domain="payment" size="sm" />
                            <Money value={p.amount} currency={p.currency} />
                            {Number(p.refundedTotal) > 0 ? (
                              <span className="text-xs text-warning-foreground">
                                (reembolsado <Money value={p.refundedTotal} currency={p.currency} />)
                              </span>
                            ) : null}
                            {canReadPayments ? (
                              <Link
                                href={`/payments/${p.id}`}
                                className="inline-flex items-center gap-1 font-mono text-xs text-primary-strong underline-offset-4 hover:underline"
                                title={p.id}
                              >
                                {p.id.slice(0, 8)}…
                                <ExternalLink aria-hidden className="h-3 w-3" />
                              </Link>
                            ) : (
                              <span className="font-mono text-xs text-muted-foreground">{p.id.slice(0, 8)}…</span>
                            )}
                            <DateTime value={p.capturedAt} className="text-xs text-muted-foreground" />
                          </li>
                        ))}
                      </ul>
                    )}
                  </FieldRow>
                  <FieldRow label="Seguimiento" hint="Link público que el cliente usa para ver su pedido.">
                    {trackingQ.data ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <a
                          href={trackingQ.data}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all text-sm underline underline-offset-4"
                        >
                          {trackingQ.data}
                        </a>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void copyToClipboard(trackingQ.data!, "Link de seguimiento")}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copiar
                        </Button>
                      </span>
                    ) : trackingQ.isLoading ? (
                      <SkeletonText lines={1} label="Generando link…" />
                    ) : null}
                  </FieldRow>
                </DescriptionList>
              )}
            </Section>
          </div>

          <div className="space-y-6">
            <Section title="Totales">
              <DescriptionList divided>
                <FieldRow label="Subtotal" numeric>
                  <Money value={quote.subtotal} />
                </FieldRow>
                <FieldRow label="Descuento" numeric>
                  <Money value={quote.discount} />
                </FieldRow>
                <FieldRow label="IVA" numeric>
                  <Money value={quote.tax} />
                </FieldRow>
                <FieldRow label="Envío" numeric>
                  <Money value={quote.shipping} />
                </FieldRow>
                <FieldRow label="Total" numeric emphasis>
                  <Money value={quote.total} emphasis showCurrency />
                </FieldRow>
                <FieldRow label="Vence">
                  <DateTime value={quote.expiresAt} />
                </FieldRow>
              </DescriptionList>
            </Section>

            <Section title="Cliente">
              <DescriptionList divided>
                <FieldRow label="Nombre">{quote.customer.fullName}</FieldRow>
                <FieldRow label="Correo">{quote.customer.email}</FieldRow>
                <FieldRow label="Notas">{quote.notes}</FieldRow>
                <FieldRow label="ID de cotización">
                  <EntityId
                    value={quote.id}
                    length={12}
                    copyLabel="Copiar ID de la cotización"
                    toastLabel="ID de la cotización"
                  />
                </FieldRow>
              </DescriptionList>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
