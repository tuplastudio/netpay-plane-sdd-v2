"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Copy, ExternalLink, Link2, PackageOpen, PackageSearch } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonText } from "@/components/ui/skeleton";
import { SOURCE_LABELS, StatusBadge } from "@/components/ui/status-badge";
import { DateTime } from "@/components/app/date-time";
import { EntityId } from "@/components/app/entity-id";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { InfoTip } from "@/components/app/info-tip";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { StatusBadgeHelp } from "@/components/app/status-help";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DetailLinesTable } from "@/components/app/detail-lines-table";
import {
  ManualCheckoutCard,
  type DeliveryMode,
} from "../_components/manual-checkout-card";
import { RevisionsTable, type OrderRevision } from "./_components/revisions-table";
import { PaymentsTable, type OrderPayment } from "./_components/payments-table";
import { usePermissions } from "@/components/app/use-permissions";

interface Variant { id: string; sku: string; title: string; price: string; stock: string | null; }
interface Product { id: string; title: string; sku: string; variants: Variant[]; }

interface OrderLine {
  variantId: string;
  quantity: string;
  sku: string | null;
  title: string | null;
  productTitle: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
}

interface Order {
  id: string;
  status: string;
  source: string;
  quoteId: string | null;
  currentRevisionId: string | null;
  description: string | null;
  total: string;
  subtotal: string;
  discount: string;
  tax: string;
  shipping: string;
  createdAt: string;
  updatedAt: string;
  placedAt: string | null;
  paidAt: string | null;
  fulfilledAt: string | null;
  cancelledAt: string | null;
  requiresInvoice: boolean;
  invoiceStatus: "NONE" | "REQUESTED" | "DATA_COMPLETE";
  invoiceRfc: string | null;
  invoiceLegalName: string | null;
  invoicePostalCode: string | null;
  invoiceCfdiUse: string | null;
  invoiceConstanciaUrl: string | null;
  invoiceRequestedAt: string | null;
  customer: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    taxId: string | null;
  };
  quote: { id: string; status: string; issuedAt: string | null; acceptedAt: string | null } | null;
  lines: OrderLine[];
  revisions: OrderRevision[];
  payments: OrderPayment[];
}

interface QuoteLine {
  variantId: string;
  quantity: string;
  discountPct: string;
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado al portapapeles`);
  } catch {
    toast.message(label, { description: text });
  }
}

/**
 * Mensaje legible de un error de axios. El backend manda
 * `{ error: { code, message } }` (ver HttpExceptionFilter); sin esto los
 * mutations mostraban un toast genérico y el motivo real (p. ej. "Stock
 * insuficiente") solo se veía en la pestaña de red.
 */
function errorMessage(error: unknown, fallback: string): string {
  const detail = (
    error as { response?: { data?: { message?: string; error?: { message?: string } } } } | null
  )?.response?.data;
  return detail?.error?.message ?? detail?.message ?? fallback;
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const orderQ = useQuery({
    queryKey: ["order", params.id],
    queryFn: async () => {
      const res = await api.get<{ data: Order }>(`/orders/${params.id}`);
      return res.data.data;
    },
  });

  const order = orderQ.data;
  const perms = usePermissions();
  // Cobrar, entregar y abrir checkout: `orders.write`. Cancelar: VENDOR también
  // (`orders.cancel_own`). FINANCE, SUPPORT y VIEWER solo consultan.
  const canWrite = perms.can("orders.write");
  const canCancelScope = perms.can("orders.cancel_own") || perms.can("orders.cancel_any");
  const isDraftFromQuote = order?.status === "DRAFT" && order.source === "QUOTE" && !!order.quoteId;

  const productsQ = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const res = await api.get<{ data: Product[] }>("/catalog/products", {
        params: { limit: 100 },
      });
      return res.data.data;
    },
    enabled: canWrite && order?.status === "DRAFT" && order.source !== "QUOTE",
  });

  // Un pedido creado desde cotización ya trae sus líneas definidas ahí:
  // se reutilizan tal cual para no perder descuentos ni forzar a
  // reseleccionar productos a mano.
  const quoteLinesQ = useQuery({
    queryKey: ["quote-lines", order?.quoteId],
    queryFn: async () => {
      const res = await api.get<{ data: { lines: QuoteLine[] } }>(`/quotes/${order!.quoteId}`);
      return res.data.data.lines;
    },
    enabled: canWrite && !!isDraftFromQuote,
  });

  const startCheckoutFromQuote = useMutation({
    mutationFn: async () => {
      const lines = quoteLinesQ.data!.map((l) => ({
        variantId: l.variantId,
        quantity: l.quantity,
        discountPct: Number(l.discountPct),
      }));
      const res = await api.post(`/orders/${params.id}/checkout`, {
        lines,
        deliveryMode: "PICKUP",
      });
      return res.data.data as { checkoutToken: string | null };
    },
    onSuccess: async (data) => {
      toast.success("Checkout abierto");
      if (data.checkoutToken) {
        const url = `${window.location.origin}/checkout/${data.checkoutToken}`;
        setPaymentLink(url);
        void copyToClipboard(url, "Link de pago");
      }
      await orderQ.refetch();
    },
    onError: (error) => toast.error(errorMessage(error, "No se pudo iniciar checkout")),
  });

  const startCheckoutManual = useMutation({
    mutationFn: async (input: {
      variantId: string;
      quantity: string;
      deliveryMode: DeliveryMode;
    }) => {
      const res = await api.post(`/orders/${params.id}/checkout`, {
        lines: [{ variantId: input.variantId, quantity: input.quantity }],
        deliveryMode: input.deliveryMode,
      });
      return res.data.data as { checkoutToken: string | null };
    },
    onSuccess: async (data) => {
      toast.success("Checkout abierto");
      if (data.checkoutToken) {
        const url = `${window.location.origin}/checkout/${data.checkoutToken}`;
        setPaymentLink(url);
        void copyToClipboard(url, "Link de pago");
      }
      await orderQ.refetch();
    },
    onError: (error) => toast.error(errorMessage(error, "No se pudo iniciar checkout")),
  });

  const resumeCheckout = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/orders/${params.id}/checkout/resume`);
      return res.data.data as { checkoutToken: string };
    },
    onSuccess: (data) => {
      const url = `${window.location.origin}/checkout/${data.checkoutToken}`;
      setPaymentLink(url);
      void copyToClipboard(url, "Link de pago");
    },
    onError: (error) => toast.error(errorMessage(error, "No se pudo generar el link de pago")),
  });

  const cancelOrder = useMutation({
    mutationFn: async () => {
      await api.patch(`/orders/${params.id}/cancel`, { reason: "manual" });
    },
    onSuccess: async () => {
      toast.success("Pedido cancelado");
      setCancelConfirmOpen(false);
      await orderQ.refetch();
    },
    onError: (error) => toast.error(errorMessage(error, "No se pudo cancelar")),
  });

  // Link público y duradero de seguimiento. Existe para cualquier estado: en
  // uno pendiente de pago la página pública trae "Pagar ahora", y es el mismo
  // link que van recibiendo los avisos de WhatsApp (recibido, pagado, entregado).
  const trackingQ = useQuery({
    queryKey: ["order-tracking-link", params.id],
    queryFn: async () => {
      const res = await api.get<{ data: { link: string } }>(`/orders/${params.id}/tracking-link`);
      return res.data.data.link;
    },
    enabled: !!order,
  });

  const fulfillOrder = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/orders/${params.id}/fulfill`);
      return res.data.data as { trackingLink: string | null };
    },
    onSuccess: async () => {
      toast.success("Pedido marcado como entregado. Se avisó al cliente.");
      await orderQ.refetch();
      await trackingQ.refetch();
    },
    onError: (error) => toast.error(errorMessage(error, "No se pudo marcar como entregado")),
  });

  if (orderQ.isLoading) {
    return (
      <div>
        <PageHeader title="Venta" backHref="/orders" breadcrumbs={[{ label: "Pedidos", href: "/orders" }, { label: "Detalle" }]} />
        <div className="space-y-6">
          <Section title="Cargando pedido">
            <SkeletonText lines={4} label="Cargando pedido…" />
          </Section>
        </div>
      </div>
    );
  }

  if (orderQ.isError || !order) {
    return (
      <div>
        <PageHeader
          title="Venta"
          backHref="/orders"
          breadcrumbs={[{ label: "Pedidos", href: "/orders" }, { label: "Detalle" }]}
        />
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>No se pudo cargar el pedido</AlertTitle>
          <AlertDescription>
            <p>Revisa el identificador o inténtalo de nuevo.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void orderQ.refetch()}>
                Reintentar
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/orders">Volver a pedidos</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const shortId = order.id.slice(0, 8);
  const canCancel =
    canCancelScope &&
    (order.status === "DRAFT" ||
    order.status === "CHECKOUT_OPEN" ||
    order.status === "AWAITING_PAYMENT");

  return (
    <div>
      <PageHeader
        title={`Venta ${shortId}…`}
        backHref="/orders"
        breadcrumbs={[{ label: "Pedidos", href: "/orders" }, { label: `#${shortId}` }]}
        meta={
          <>
            <StatusBadgeHelp status={order.status} domain="order" />
            <span className="text-foreground">{order.customer.fullName}</span>
            <span aria-hidden>·</span>
            <span>Origen: {SOURCE_LABELS[order.source] ?? order.source}</span>
            <span aria-hidden>·</span>
            <DateTime value={order.createdAt} />
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              disabled={!trackingQ.data}
              loading={trackingQ.isLoading}
              onClick={() => trackingQ.data && void copyToClipboard(trackingQ.data, "Link de seguimiento")}
            >
              <PackageSearch className="h-4 w-4" />
              Copiar link de seguimiento
            </Button>
            {canWrite && order.status === "PAID" && (
              <Button
                variant="outline"
                loading={fulfillOrder.isPending}
                onClick={() => fulfillOrder.mutate()}
              >
                <CheckCircle2 className="h-4 w-4" />
                Marcar como entregado
              </Button>
            )}
            {canCancel ? (
              <Button variant="outline" onClick={() => setCancelConfirmOpen(true)}>
                Cancelar pedido
              </Button>
            ) : null}
          </>
        }
      />

      <ConfirmDialog
        open={cancelConfirmOpen}
        onOpenChange={setCancelConfirmOpen}
        title="¿Cancelar pedido?"
        description="Se libera cualquier reserva de stock y el pedido deja de poder pagarse. No se puede deshacer."
        confirmLabel="Cancelar pedido"
        pending={cancelOrder.isPending}
        onConfirm={() => cancelOrder.mutate()}
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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {canWrite && (order.status === "CHECKOUT_OPEN" || order.status === "AWAITING_PAYMENT") && (
              <Section
                title="Esperando pago"
                description="El pedido tiene un checkout abierto. Genera (o reenvía) el link de pago para cobrarlo en línea."
              >
                <Button
                  loading={resumeCheckout.isPending}
                  onClick={() => resumeCheckout.mutate()}
                >
                  Pagar pedido
                </Button>
              </Section>
            )}

            {canWrite && isDraftFromQuote && (
              <Section
                title="Iniciar checkout"
                description="Este pedido viene de una cotización aceptada. Se cobra con las mismas líneas y descuentos."
              >
                <Button
                  loading={startCheckoutFromQuote.isPending}
                  disabled={quoteLinesQ.isLoading || !quoteLinesQ.data}
                  onClick={() => startCheckoutFromQuote.mutate()}
                >
                  Iniciar checkout
                </Button>
              </Section>
            )}

            {canWrite && order.status === "DRAFT" && order.source !== "QUOTE" && (
              <ManualCheckoutCard
                products={productsQ.data}
                pending={startCheckoutManual.isPending}
                onStart={(input) => {
                  if (!input.variantId) {
                    toast.error("Selecciona una variante");
                    return;
                  }
                  startCheckoutManual.mutate(input);
                }}
              />
            )}

            <Section title="Productos vendidos" padded={false}>
              {order.lines.length === 0 ? (
                <EmptyState
                  icon={<PackageOpen className="h-6 w-6" />}
                  title="Sin líneas todavía"
                  description="Las líneas de este pedido se registran al iniciar el checkout."
                />
              ) : (
                <DetailLinesTable
                  lines={order.lines.map((l) => ({
                    key: l.variantId,
                    variantId: l.variantId,
                    sku: l.sku ?? "—",
                    title: l.productTitle
                      ? `${l.productTitle} — ${l.title ?? l.variantId.slice(0, 8)}`
                      : l.title ?? l.variantId.slice(0, 8),
                    quantity: l.quantity,
                    unitPrice: l.unitPrice ?? "0",
                    lineSubtotal: l.lineTotal ?? "0",
                  }))}
                  total={order.total}
                  footerLabel="Total del pedido"
                  showDiscount={false}
                />
              )}
            </Section>

            <Section
              title="Revisiones"
              description="Cada propuesta de checkout con sus líneas reservadas. Toca una fila para ver el detalle."
              padded={false}
            >
              <RevisionsTable
                revisions={order.revisions}
                currentRevisionId={order.currentRevisionId}
              />
            </Section>

            <Section
              title="Pagos"
              description="Sesiones de cobro y sus movimientos en el ledger."
              padded={false}
            >
              <PaymentsTable payments={order.payments} />
            </Section>
          </div>

          <div className="space-y-6">
            <Section title="Totales">
              <DescriptionList divided>
                <FieldRow label="Subtotal" numeric>
                  <Money value={order.subtotal} />
                </FieldRow>
                <FieldRow label="Descuento" numeric>
                  <Money value={order.discount} />
                </FieldRow>
                <FieldRow label="IVA" numeric>
                  <Money value={order.tax} />
                </FieldRow>
                <FieldRow
                  label={
                    <span className="inline-flex items-center gap-1">
                      Envío
                      <InfoTip label="Envío" text="Costo de entrega según la zona del cliente. Cero en recolección en tienda." />
                    </span>
                  }
                  numeric
                >
                  <Money value={order.shipping} />
                </FieldRow>
                <FieldRow label="Total" numeric emphasis>
                  <Money value={order.total} emphasis showCurrency />
                </FieldRow>
              </DescriptionList>
            </Section>

            <Section
              title="Cliente"
              footer={
                <Button asChild variant="outline" size="sm">
                  <Link href={`/customers/${order.customer.id}`}>Ver cliente</Link>
                </Button>
              }
            >
              <DescriptionList divided>
                <FieldRow label="Nombre">{order.customer.fullName}</FieldRow>
                <FieldRow label="Correo">{order.customer.email}</FieldRow>
                <FieldRow label="Teléfono">{order.customer.phone}</FieldRow>
                <FieldRow label="RFC" mono>
                  {order.customer.taxId}
                </FieldRow>
              </DescriptionList>
            </Section>

            {order.requiresInvoice ? (
              <Section title="Facturación (CFDI)">
                <DescriptionList divided>
                  <FieldRow label="Estado">
                    <StatusBadge status={order.invoiceStatus} domain="generic" withDot />
                  </FieldRow>
                  <FieldRow label="RFC" mono>
                    {order.invoiceRfc}
                  </FieldRow>
                  <FieldRow label="Razón social">{order.invoiceLegalName}</FieldRow>
                  <FieldRow label="Código postal fiscal" mono>
                    {order.invoicePostalCode}
                  </FieldRow>
                  <FieldRow
                    label={
                      <span className="inline-flex items-center gap-1">
                        Uso de CFDI
                        <InfoTip label="Uso de CFDI" text="Clave del SAT que indica para qué usará la factura el cliente (p. ej. G03 gastos en general)." />
                      </span>
                    }
                    mono
                  >
                    {order.invoiceCfdiUse}
                  </FieldRow>
                  <FieldRow label="Constancia de situación fiscal">
                    {order.invoiceConstanciaUrl ? (
                      <a
                        href={order.invoiceConstanciaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary-strong underline underline-offset-4"
                      >
                        Ver documento
                      </a>
                    ) : (
                      <span className="text-muted-foreground">Pendiente de recibir</span>
                    )}
                  </FieldRow>
                  <FieldRow label="Pedida el">
                    <DateTime value={order.invoiceRequestedAt} />
                  </FieldRow>
                </DescriptionList>
              </Section>
            ) : null}

            <RelatedSection
              order={order}
              trackingLink={trackingQ.data ?? null}
              trackingLoading={trackingQ.isLoading}
              canReadPayments={perms.can("payments.read")}
            />

            <Section title="Referencias">
              <DescriptionList divided>
                <FieldRow label="ID del pedido">
                  <EntityId
                    value={order.id}
                    length={order.id.length}
                    copyLabel="Copiar ID del pedido"
                    toastLabel="ID del pedido"
                    className="break-all"
                  />
                </FieldRow>
                <FieldRow label="Descripción">{order.description}</FieldRow>
              </DescriptionList>
            </Section>

            <Section title="Línea de tiempo">
              <DescriptionList divided>
                <FieldRow label="Creado">
                  <DateTime value={order.createdAt} />
                </FieldRow>
                {order.quote?.issuedAt ? (
                  <FieldRow label="Cotización emitida">
                    <DateTime value={order.quote.issuedAt} />
                  </FieldRow>
                ) : null}
                {order.quote?.acceptedAt ? (
                  <FieldRow label="Cotización aceptada">
                    <DateTime value={order.quote.acceptedAt} />
                  </FieldRow>
                ) : null}
                {order.placedAt ? (
                  <FieldRow label="Confirmado">
                    <DateTime value={order.placedAt} />
                  </FieldRow>
                ) : null}
                {order.paidAt ? (
                  <FieldRow label="Pagado">
                    <DateTime value={order.paidAt} />
                  </FieldRow>
                ) : null}
                {order.fulfilledAt ? (
                  <FieldRow label="Entregado">
                    <DateTime value={order.fulfilledAt} />
                  </FieldRow>
                ) : null}
                {order.cancelledAt ? (
                  <FieldRow label="Cancelado">
                    <DateTime value={order.cancelledAt} />
                  </FieldRow>
                ) : null}
                <FieldRow label="Última actualización">
                  <DateTime value={order.updatedAt} />
                </FieldRow>
              </DescriptionList>
            </Section>

          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Lo que cuelga de este pedido, con su estado: cotización de origen, sesiones
 * de cobro (y cuánto se reembolsó), y el link público de seguimiento. Es la
 * misma sección "Relacionados" que tienen la cotización y el pago, así se
 * navega entre las tres entidades sin buscar el id a mano.
 */
function RelatedSection({
  order,
  trackingLink,
  trackingLoading,
  canReadPayments,
}: {
  order: Order;
  trackingLink: string | null;
  trackingLoading: boolean;
  canReadPayments: boolean;
}) {
  const refunded = order.payments.reduce((acc, p) => acc + Number(p.refundedTotal ?? 0), 0);
  const currency = order.payments[0]?.currency;
  return (
    <Section
      title="Relacionados"
      description="Cotización, cobros y link de seguimiento de este pedido."
    >
      <DescriptionList divided>
        <FieldRow label="Cotización">
          {order.quote ? (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadgeHelp status={order.quote.status} domain="quote" size="sm" />
              <Link
                href={`/quotes/${order.quote.id}`}
                className="inline-flex items-center gap-1 font-mono text-xs text-primary-strong underline-offset-4 hover:underline"
                title={order.quote.id}
              >
                {order.quote.id.slice(0, 8)}…
                <ExternalLink aria-hidden className="h-3 w-3" />
              </Link>
            </span>
          ) : (
            <span className="text-muted-foreground">Sin cotización (pedido directo)</span>
          )}
        </FieldRow>
        <FieldRow label={order.payments.length === 1 ? "Pago" : "Pagos"}>
          {order.payments.length === 0 ? (
            <span className="text-muted-foreground">Sin sesiones de pago</span>
          ) : (
            <ul className="space-y-1.5">
              {order.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <StatusBadgeHelp status={p.status} domain="payment" size="sm" />
                  <Money value={p.amount} currency={p.currency} />
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
                </li>
              ))}
            </ul>
          )}
        </FieldRow>
        {refunded > 0 ? (
          <FieldRow label="Reembolsado" numeric>
            <Money value={refunded.toFixed(2)} currency={currency} className="text-warning-foreground" />
          </FieldRow>
        ) : null}
        <FieldRow
          label="Seguimiento"
          hint="Link público y duradero. Lo reciben los avisos de WhatsApp al crear, pagar y entregar el pedido."
        >
          {trackingLoading ? (
            <SkeletonText lines={1} label="Generando link de seguimiento…" />
          ) : trackingLink ? (
            <span className="flex flex-wrap items-center gap-2">
              <a
                href={trackingLink}
                target="_blank"
                rel="noreferrer"
                className="break-all text-sm underline underline-offset-4"
              >
                {trackingLink}
              </a>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyToClipboard(trackingLink, "Link de seguimiento")}
              >
                <Copy className="h-3.5 w-3.5" />
                Copiar
              </Button>
            </span>
          ) : (
            <span className="text-muted-foreground">No se pudo generar el link.</span>
          )}
        </FieldRow>
      </DescriptionList>
    </Section>
  );
}
