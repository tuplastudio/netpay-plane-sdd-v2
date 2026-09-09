"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { statusVariant, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/payments";

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
  customer: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    taxId: string | null;
  };
  quote: { id: string; status: string; issuedAt: string | null; acceptedAt: string | null } | null;
  lines: OrderLine[];
  revisions: Array<{
    id: string;
    revisionNumber: number;
    status: string;
    total: string;
    deliveryMode: string;
    createdAt: string;
    expiresAt: string;
    lines: OrderLine[];
  }>;
  payments: Array<{
    id: string;
    status: string;
    amount: string;
    currency: string;
    capturedAt: string | null;
    createdAt: string;
  }>;
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

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState("1.000");
  const [deliveryMode, setDeliveryMode] = useState<"PICKUP" | "LOCAL_DELIVERY">("PICKUP");
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
  const isDraftFromQuote = order?.status === "DRAFT" && order.source === "QUOTE" && !!order.quoteId;

  const productsQ = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const res = await api.get<{ data: Product[] }>("/catalog/products");
      return res.data.data;
    },
    enabled: order?.status === "DRAFT" && order.source !== "QUOTE",
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
    enabled: !!isDraftFromQuote,
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
    onError: () => toast.error("No se pudo iniciar checkout"),
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
    onError: () => toast.error("No se pudo generar el link de pago"),
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
    onError: () => toast.error("No se pudo cancelar"),
  });

  async function startCheckoutManual() {
    if (!variantId) {
      toast.error("Selecciona una variante");
      return;
    }
    try {
      const res = await api.post(`/orders/${params.id}/checkout`, {
        lines: [{ variantId, quantity: qty }],
        deliveryMode,
      });
      const data = res.data.data as { checkoutToken: string | null };
      toast.success("Checkout abierto");
      if (data.checkoutToken) {
        const url = `${window.location.origin}/checkout/${data.checkoutToken}`;
        setPaymentLink(url);
        void copyToClipboard(url, "Link de pago");
      }
      await orderQ.refetch();
    } catch {
      toast.error("No se pudo iniciar checkout");
    }
  }

  if (orderQ.isLoading) return <main className="container py-8">Cargando…</main>;
  if (!order) return null;

  return (
    <main className="container py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Venta {order.id.slice(0, 8)}…</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={statusVariant(order.status)}>
              {ORDER_STATUS_LABEL[order.status] ?? order.status}
            </Badge>
            <span>{order.customer.fullName}</span>
            <span aria-hidden>·</span>
            <span>origen {order.source}</span>
            <span aria-hidden>·</span>
            <span>{new Date(order.createdAt).toLocaleString("es-MX")}</span>
            {order.quoteId ? (
              <>
                <span aria-hidden>·</span>
                <Link href={`/quotes/${order.quoteId}`} className="text-primary hover:underline">
                  cotización {order.quoteId.slice(0, 8)}…
                </Link>
              </>
            ) : null}
          </p>
        </div>
        {(order.status === "DRAFT" || order.status === "CHECKOUT_OPEN" || order.status === "AWAITING_PAYMENT") && (
          <Button variant="ghost" onClick={() => setCancelConfirmOpen(true)}>
            Cancelar pedido
          </Button>
        )}
      </header>

      <ConfirmDialog
        open={cancelConfirmOpen}
        onOpenChange={setCancelConfirmOpen}
        title="¿Cancelar pedido?"
        description="Se libera cualquier reserva de stock y el pedido deja de poder pagarse. No se puede deshacer."
        confirmLabel="Cancelar pedido"
        pending={cancelOrder.isPending}
        onConfirm={() => cancelOrder.mutate()}
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

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <section className="md:col-span-2 space-y-4">
          {(order.status === "CHECKOUT_OPEN" || order.status === "AWAITING_PAYMENT") && (
            <div className="rounded-card border bg-card p-4">
              <h2 className="mb-1 font-semibold">Esperando pago</h2>
              <p className="mb-3 text-sm text-muted-foreground">
                El pedido tiene un checkout abierto. Genera (o reenvía) el link de pago para cobrarlo en línea.
              </p>
              <Button onClick={() => resumeCheckout.mutate()} disabled={resumeCheckout.isPending}>
                {resumeCheckout.isPending ? "Generando…" : "Pagar pedido"}
              </Button>
            </div>
          )}

          {isDraftFromQuote && (
            <div className="rounded-card border bg-card p-4">
              <h2 className="mb-1 font-semibold">Iniciar checkout</h2>
              <p className="mb-3 text-sm text-muted-foreground">
                Este pedido viene de una cotización aceptada. Se cobra con las mismas líneas y descuentos.
              </p>
              <Button
                onClick={() => startCheckoutFromQuote.mutate()}
                disabled={startCheckoutFromQuote.isPending || quoteLinesQ.isLoading || !quoteLinesQ.data}
              >
                {startCheckoutFromQuote.isPending ? "Abriendo…" : "Iniciar checkout"}
              </Button>
            </div>
          )}

          {order.status === "DRAFT" && order.source !== "QUOTE" && (
            <div className="rounded-card border bg-card p-4">
              <h2 className="mb-3 font-semibold">Iniciar checkout</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="md:col-span-2 space-y-1.5">
                  <Label>Variante</Label>
                  <select
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    value={variantId}
                    onChange={(e) => setVariantId(e.target.value)}
                  >
                    <option value="">Selecciona…</option>
                    {productsQ.data?.flatMap((p) =>
                      p.variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {p.title} — {v.title} (${v.price})
                        </option>
                      )),
                    )}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Cantidad</Label>
                  <Input value={qty} onChange={(e) => setQty(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Entrega</Label>
                  <select
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    value={deliveryMode}
                    onChange={(e) => setDeliveryMode(e.target.value as "PICKUP" | "LOCAL_DELIVERY")}
                  >
                    <option value="PICKUP">Recolección</option>
                    <option value="LOCAL_DELIVERY">Envío local</option>
                  </select>
                </div>
              </div>
              <div className="mt-3">
                <Button onClick={startCheckoutManual}>Iniciar checkout</Button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-card border bg-card p-4">
            <h2 className="mb-3 font-semibold">Productos vendidos</h2>
            {order.lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Este pedido todavía no tiene líneas: se registran al iniciar el checkout.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="p-2">SKU</th>
                    <th className="p-2">Producto</th>
                    <th className="p-2 text-right">Cant.</th>
                    <th className="p-2 text-right">P. unit.</th>
                    <th className="p-2 text-right">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((l) => (
                    <tr key={l.variantId} className="border-b last:border-0">
                      <td className="p-2 font-mono text-xs">{l.sku ?? "—"}</td>
                      <td className="p-2">
                        {l.productTitle ? (
                          <span className="text-muted-foreground">{l.productTitle} · </span>
                        ) : null}
                        {l.title ?? l.variantId.slice(0, 8)}
                      </td>
                      <td className="p-2 text-right font-mono">{Number(l.quantity)}</td>
                      <td className="p-2 text-right font-mono">
                        {l.unitPrice ? `$${l.unitPrice}` : "—"}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {l.lineTotal ? `$${l.lineTotal}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="overflow-x-auto rounded-card border bg-card p-4">
            <h2 className="mb-3 font-semibold">Revisiones</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="p-2">#</th>
                  <th className="p-2">Estado</th>
                  <th className="p-2">Entrega</th>
                  <th className="p-2 text-right">Líneas</th>
                  <th className="p-2 text-right">Total</th>
                  <th className="p-2">Creada</th>
                </tr>
              </thead>
              <tbody>
                {order.revisions.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-2">{r.revisionNumber}</td>
                    <td className="p-2 text-xs uppercase">{r.status}</td>
                    <td className="p-2 text-xs">
                      {r.deliveryMode === "PICKUP" ? "Recolección" : "Envío local"}
                    </td>
                    <td className="p-2 text-right font-mono">{r.lines.length}</td>
                    <td className="p-2 text-right font-mono">${r.total}</td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString("es-MX")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-card border bg-card p-4">
            <h2 className="mb-3 font-semibold">Pagos</h2>
            {order.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin sesiones de pago.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="p-2">Sesión</th>
                    <th className="p-2">Estado</th>
                    <th className="p-2 text-right">Monto</th>
                    <th className="p-2">Creada</th>
                    <th className="p-2">Capturado</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {order.payments.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="p-2">
                        <Link
                          href={`/payments/${p.id}`}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {p.id.slice(0, 8)}…
                        </Link>
                      </td>
                      <td className="p-2">
                        <Badge variant={statusVariant(p.status)}>
                          {PAYMENT_STATUS_LABEL[p.status] ?? p.status}
                        </Badge>
                      </td>
                      <td className="p-2 text-right font-mono">${p.amount}</td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {new Date(p.createdAt).toLocaleString("es-MX")}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {p.capturedAt ? new Date(p.capturedAt).toLocaleString("es-MX") : "—"}
                      </td>
                      <td className="p-2 text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/payments/${p.id}`}>Ver pago</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-card border bg-card p-4">
            <h2 className="mb-3 font-semibold">Totales</h2>
            <dl className="space-y-2 text-sm">
              <Row label="Subtotal" value={order.subtotal} />
              <Row label="Descuento" value={order.discount} />
              <Row label="IVA" value={order.tax} />
              <Row label="Envío" value={order.shipping} />
              <div className="border-t pt-2">
                <Row label="Total" value={order.total} bold />
              </div>
            </dl>
          </div>

          <div className="rounded-card border bg-card p-4">
            <h2 className="mb-3 font-semibold">Cliente</h2>
            <dl className="space-y-2 text-sm">
              <TextRow label="Nombre" value={order.customer.fullName} />
              <TextRow label="Correo" value={order.customer.email ?? "—"} />
              <TextRow label="Teléfono" value={order.customer.phone ?? "—"} />
              <TextRow label="RFC" value={order.customer.taxId ?? "—"} />
            </dl>
            <Button asChild variant="outline" size="sm" className="mt-3 w-full">
              <Link href={`/customers/${order.customer.id}`}>Ver cliente</Link>
            </Button>
          </div>

          <div className="rounded-card border bg-card p-4">
            <h2 className="mb-3 font-semibold">Línea de tiempo</h2>
            <dl className="space-y-2 text-sm">
              <TextRow label="Creado" value={new Date(order.createdAt).toLocaleString("es-MX")} />
              {order.quote?.issuedAt ? (
                <TextRow
                  label="Cotización emitida"
                  value={new Date(order.quote.issuedAt).toLocaleString("es-MX")}
                />
              ) : null}
              {order.quote?.acceptedAt ? (
                <TextRow
                  label="Cotización aceptada"
                  value={new Date(order.quote.acceptedAt).toLocaleString("es-MX")}
                />
              ) : null}
              {order.placedAt ? (
                <TextRow label="Confirmado" value={new Date(order.placedAt).toLocaleString("es-MX")} />
              ) : null}
              {order.paidAt ? (
                <TextRow label="Pagado" value={new Date(order.paidAt).toLocaleString("es-MX")} />
              ) : null}
              <TextRow
                label="Última actualización"
                value={new Date(order.updatedAt).toLocaleString("es-MX")}
              />
            </dl>
          </div>
        </section>
      </div>
    </main>
  );
}

function TextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all text-right">{value}</dd>
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
