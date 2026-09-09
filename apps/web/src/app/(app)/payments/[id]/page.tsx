"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Copy, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/app/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  money,
  statusVariant,
  PAYMENT_STATUS_LABEL,
  LEDGER_TYPE_LABEL,
  ORDER_STATUS_LABEL,
} from "@/lib/payments";

interface SessionLine {
  variantId: string;
  quantity: string;
  sku: string | null;
  title: string | null;
  productTitle: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
}

interface LedgerEntry {
  id: string;
  entryType: string;
  amount: string;
  balanceAfter: string;
  description: string;
  recordedAt: string;
}

interface SessionDetail {
  id: string;
  orderId: string;
  amount: string;
  currency: string;
  status: string;
  livemode: boolean;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  capturedAt: string | null;
  failedAt: string | null;
  refundedTotal: string;
  netTotal: string;
  lines: SessionLine[];
  ledger: LedgerEntry[];
  order: {
    id: string;
    status: string;
    source: string;
    total: string;
    subtotal: string;
    tax: string;
    shipping: string;
    discount: string;
    customer: {
      id: string;
      fullName: string;
      email: string | null;
      phone: string | null;
      taxId: string | null;
    };
  };
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  } catch {
    toast.message(label, { description: text });
  }
}

export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");

  const sessionQ = useQuery({
    queryKey: ["payment-session", params.id],
    queryFn: async () => {
      const res = await api.get<{ data: SessionDetail }>(`/payments/sessions/${params.id}`);
      return res.data.data;
    },
  });

  const refund = useMutation({
    mutationFn: async () => {
      await api.post("/payments/refunds", {
        sessionId: params.id,
        amount: refundAmount,
        reason: refundReason,
      });
    },
    onSuccess: async () => {
      toast.success("Reembolso registrado");
      setRefundOpen(false);
      setRefundReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["payment-session", params.id] }),
        queryClient.invalidateQueries({ queryKey: ["payment-sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["payment-ledger"] }),
      ]);
    },
    onError: () => toast.error("No se pudo registrar el reembolso"),
  });

  if (sessionQ.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando pago…</p>;
  }
  if (sessionQ.isError || !sessionQ.data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">No pude cargar esta sesión de pago.</p>
        <Button asChild variant="outline">
          <Link href="/payments">
            <ArrowLeft className="h-4 w-4" />
            Volver a pagos
          </Link>
        </Button>
      </div>
    );
  }

  const s = sessionQ.data;
  const refundable = s.status === "CAPTURED" || s.status === "PARTIALLY_REFUNDED";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Pago ${s.id.slice(0, 8)}…`}
        description={
          <>
            {s.order.customer.fullName} · pedido{" "}
            <Link href={`/orders/${s.orderId}`} className="text-primary hover:underline">
              {s.orderId.slice(0, 8)}…
            </Link>{" "}
            · {s.livemode ? "livemode" : "modo dummy"}
          </>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/payments">
                <ArrowLeft className="h-4 w-4" />
                Pagos
              </Link>
            </Button>
            <Button variant="outline" onClick={() => void copyToClipboard(s.id, "ID de sesión")}>
              <Copy className="h-4 w-4" />
              Copiar ID
            </Button>
            {refundable && (
              <Button
                onClick={() => {
                  setRefundAmount(s.netTotal);
                  setRefundOpen(true);
                }}
              >
                <RotateCcw className="h-4 w-4" />
                Reembolsar
              </Button>
            )}
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-card border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Estado</p>
          <p className="mt-1">
            <Badge variant={statusVariant(s.status)}>
              {PAYMENT_STATUS_LABEL[s.status] ?? s.status}
            </Badge>
          </p>
        </div>
        <Stat label="Monto" value={money(s.amount, s.currency)} />
        <Stat label="Reembolsado" value={money(s.refundedTotal, s.currency)} />
        <Stat label="Neto" value={money(s.netTotal, s.currency)} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Tabs defaultValue="detalle" className="space-y-4">
            <TabsList>
              <TabsTrigger value="detalle">Detalle de la venta</TabsTrigger>
              <TabsTrigger value="ledger">Ledger ({s.ledger.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="detalle">
              <section className="overflow-x-auto rounded-card border bg-card p-4">
                <h2 className="mb-3 font-semibold">Qué se cobró</h2>
                {s.lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Esta sesión no tiene líneas registradas.
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
                      {s.lines.map((l) => (
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
              </section>
            </TabsContent>

            <TabsContent value="ledger">
              <section className="overflow-x-auto rounded-card border bg-card p-4">
                <h2 className="mb-3 font-semibold">Movimientos de esta sesión</h2>
                {s.ledger.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin movimientos registrados.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="p-2">Tipo</th>
                        <th className="p-2 text-right">Monto</th>
                        <th className="p-2 text-right">Saldo</th>
                        <th className="p-2">Descripción</th>
                        <th className="p-2">Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.ledger.map((l) => (
                        <tr key={l.id} className="border-b last:border-0">
                          <td className="p-2">
                            <Badge variant={l.entryType === "REFUND" ? "destructive" : "muted"}>
                              {LEDGER_TYPE_LABEL[l.entryType] ?? l.entryType}
                            </Badge>
                          </td>
                          <td className="p-2 text-right font-mono">${l.amount}</td>
                          <td className="p-2 text-right font-mono">${l.balanceAfter}</td>
                          <td className="p-2 text-xs text-muted-foreground">{l.description}</td>
                          <td className="p-2 text-xs text-muted-foreground">
                            {new Date(l.recordedAt).toLocaleString("es-MX")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </TabsContent>
          </Tabs>

          <section className="rounded-card border bg-card p-4">
            <h2 className="mb-3 font-semibold">Línea de tiempo</h2>
            <ul className="space-y-2 text-sm">
              <TimelineRow label="Sesión creada" at={s.createdAt} />
              <TimelineRow label="Cobrado" at={s.capturedAt} />
              <TimelineRow label="Fallido" at={s.failedAt} />
              <TimelineRow label="Vence" at={s.expiresAt} />
              <TimelineRow label="Última actualización" at={s.updatedAt} />
            </ul>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-card border bg-card p-4">
            <h2 className="mb-3 font-semibold">Cliente</h2>
            <dl className="space-y-2 text-sm">
              <Row label="Nombre" value={s.order.customer.fullName} />
              <Row label="Correo" value={s.order.customer.email ?? "—"} />
              <Row label="Teléfono" value={s.order.customer.phone ?? "—"} />
              <Row label="RFC" value={s.order.customer.taxId ?? "—"} />
            </dl>
            <Button asChild variant="outline" size="sm" className="mt-3 w-full">
              <Link href={`/customers/${s.order.customer.id}`}>Ver cliente</Link>
            </Button>
          </section>

          <section className="rounded-card border bg-card p-4">
            <h2 className="mb-3 font-semibold">Pedido</h2>
            <dl className="space-y-2 text-sm">
              <Row
                label="Estado"
                value={ORDER_STATUS_LABEL[s.order.status] ?? s.order.status}
              />
              <Row label="Origen" value={s.order.source} />
              <Row label="Subtotal" value={`$${s.order.subtotal}`} mono />
              <Row label="Descuento" value={`$${s.order.discount}`} mono />
              <Row label="IVA" value={`$${s.order.tax}`} mono />
              <Row label="Envío" value={`$${s.order.shipping}`} mono />
              <div className="border-t pt-2">
                <Row label="Total" value={`$${s.order.total}`} mono bold />
              </div>
            </dl>
            <Button asChild variant="outline" size="sm" className="mt-3 w-full">
              <Link href={`/orders/${s.orderId}`}>Ver pedido completo</Link>
            </Button>
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        title={`¿Reembolsar ${money(refundAmount, s.currency)}?`}
        description={
          <div className="space-y-3 pt-1">
            <p>Esta acción registra el reembolso en el ledger. No se puede deshacer.</p>
            <div className="space-y-1.5">
              <Label htmlFor="refund-amount">Monto a reembolsar</Label>
              <Input
                id="refund-amount"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="refund-reason">Motivo</Label>
              <Input
                id="refund-reason"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="Ej. Cliente canceló el servicio"
              />
            </div>
          </div>
        }
        confirmLabel="Reembolsar"
        variant="destructive"
        pending={refund.isPending}
        onConfirm={() => refund.mutate()}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
  bold = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={bold ? "font-semibold" : "text-muted-foreground"}>{label}</dt>
      <dd className={`${mono ? "font-mono" : ""} ${bold ? "font-semibold" : ""} break-all text-right`}>
        {value}
      </dd>
    </div>
  );
}

function TimelineRow({ label, at }: { label: string; at: string | null }) {
  if (!at) return null;
  return (
    <li className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{new Date(at).toLocaleString("es-MX")}</span>
    </li>
  );
}
