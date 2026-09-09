"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Download } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";

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
  capturedAt: string | null;
}

interface OrderDetail {
  id: string;
  status: string;
  total: string;
  payments: OrderPayment[];
}

function statusVariant(status: string): "success" | "warning" | "muted" | "destructive" {
  if (status === "ACCEPTED" || status === "PAID" || status === "CAPTURED") return "success";
  if (status === "DRAFT" || status === "AWAITING_PAYMENT" || status === "CHECKOUT_OPEN") return "warning";
  if (status === "CANCELLED" || status === "EXPIRED" || status === "FAILED") return "destructive";
  return "muted";
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
  const router = useRouter();
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const q = useQuery({
    queryKey: ["quote", params.id],
    queryFn: async () => {
      const res = await api.get<{ data: QuoteDetail }>(`/quotes/${params.id}`);
      return res.data.data;
    },
  });

  const orderId = q.data?.order?.id ?? null;

  // Detalle de pago: cuando la cotización ya generó un pedido, se consulta
  // aparte para mostrar el desglose de intentos de pago (dummy gateway).
  const order = useQuery({
    queryKey: ["order-for-quote", orderId],
    queryFn: async () => {
      const res = await api.get<{ data: OrderDetail }>(`/orders/${orderId}`);
      return res.data.data;
    },
    enabled: !!orderId,
  });

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

  if (q.isLoading) return <div className="py-8 text-sm text-muted-foreground">Cargando…</div>;
  if (!q.data) return null;
  const quote = q.data;

  return (
    <div>
      <PageHeader
        title={`Cotización ${quote.id.slice(0, 8)}…`}
        description={
          <>
            {quote.customer.fullName} · <Badge variant={statusVariant(quote.status)}>{quote.status}</Badge>
          </>
        }
        actions={
          <>
            {quote.status === "DRAFT" && (
              <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
                Emitir
              </Button>
            )}
            {quote.status === "ISSUED" && (
              <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
                {approve.isPending ? "Aprobando…" : "Aprobar cotización"}
              </Button>
            )}
            {(quote.status === "DRAFT" || quote.status === "ISSUED") && (
              <>
                <Button variant="outline" onClick={() => share.mutate()} disabled={share.isPending}>
                  Compartir
                </Button>
                <Button variant="ghost" onClick={() => setCancelConfirmOpen(true)}>
                  Cancelar
                </Button>
              </>
            )}
            <Button asChild variant="outline">
              <a href={`/api/v1/quotes/${quote.id}/pdf`} target="_blank" rel="noreferrer">
                <Download className="h-4 w-4" />
                Recibo
              </a>
            </Button>
          </>
        }
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

      {paymentLink && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-card border bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
          <span className="font-medium">Link de pago:</span>
          <a href={paymentLink} target="_blank" rel="noreferrer" className="break-all text-primary underline">
            {paymentLink}
          </a>
          <Button variant="outline" size="sm" onClick={() => void copyToClipboard(paymentLink, "Link de pago")}>
            <Copy className="h-3.5 w-3.5" />
            Copiar
          </Button>
        </div>
      )}

      {shareToken && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-card border bg-muted p-3 text-sm">
          <span className="font-medium">Link de la cotización:</span>
          <a href={`/quotes/public/${shareToken}`} className="break-all text-primary underline">
            {typeof window !== "undefined" ? window.location.origin : ""}/quotes/public/{shareToken}
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
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <section className="overflow-x-auto rounded-card border bg-card p-4 md:col-span-2">
          <h2 className="mb-3 font-semibold">Líneas</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="p-2">SKU</th>
                <th className="p-2">Producto</th>
                <th className="p-2 text-right">Cantidad</th>
                <th className="p-2 text-right">Precio</th>
                <th className="p-2 text-right">Desc%</th>
                <th className="p-2 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="p-2 font-mono text-xs">{l.sku}</td>
                  <td className="p-2">{l.title}</td>
                  <td className="p-2 text-right tabular-nums">{l.quantity}</td>
                  <td className="p-2 text-right font-mono">${l.unitPrice}</td>
                  <td className="p-2 text-right">{l.discountPct}%</td>
                  <td className="p-2 text-right font-mono">${l.lineSubtotal}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {orderId && (
            <div className="mt-6 border-t pt-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold">Detalle de pago</h2>
                <Button variant="ghost" size="sm" onClick={() => router.push(`/orders/${orderId}`)}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Ver pedido completo
                </Button>
              </div>
              {order.isLoading ? (
                <p className="text-sm text-muted-foreground">Cargando pago…</p>
              ) : order.data && order.data.payments.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="p-2">ID</th>
                      <th className="p-2">Estado</th>
                      <th className="p-2 text-right">Monto</th>
                      <th className="p-2">Capturado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.data.payments.map((p) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="p-2 font-mono text-xs">{p.id.slice(0, 8)}…</td>
                        <td className="p-2">
                          <Badge variant={statusVariant(p.status)}>{p.status}</Badge>
                        </td>
                        <td className="p-2 text-right font-mono">${p.amount}</td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {p.capturedAt ? new Date(p.capturedAt).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Pedido <Badge variant={statusVariant(order.data?.status ?? "")}>{order.data?.status}</Badge>{" "}
                  · sin sesiones de pago todavía.
                </p>
              )}
            </div>
          )}
        </section>

        <section className="rounded-card border bg-card p-4">
          <h2 className="mb-3 font-semibold">Totales</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Subtotal" value={quote.subtotal} />
            <Row label="Descuento" value={quote.discount} />
            <Row label="IVA" value={quote.tax} />
            <Row label="Envío" value={quote.shipping} />
            <div className="border-t pt-2">
              <Row label="Total" value={quote.total} bold />
            </div>
            <div className="border-t pt-2 text-xs text-muted-foreground">
              Vence: {new Date(quote.expiresAt).toLocaleString()}
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className={bold ? "font-semibold" : "text-muted-foreground"}>{label}</dt>
      <dd className={bold ? "font-mono font-semibold" : "font-mono"}>${value}</dd>
    </div>
  );
}
