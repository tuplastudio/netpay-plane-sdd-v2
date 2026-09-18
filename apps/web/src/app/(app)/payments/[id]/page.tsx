"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Copy, ReceiptText, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonText } from "@/components/ui/skeleton";
import { SOURCE_LABELS, StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateTime } from "@/components/app/date-time";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { Money, formatMoney } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { StatTile } from "@/components/app/stat-tile";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toCents } from "@/lib/decimal";
import { LinesSheet } from "./_components/lines-sheet";

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
  /** CARD | SPEI | OXXO; null mientras la sesión sigue pendiente. */
  paymentMethod: string | null;
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
        // Los totales del panorama y de /payments salen de un agregado del
        // backend; tras un reembolso hay que volver a pedirlo.
        queryClient.invalidateQueries({ queryKey: ["reports-summary"] }),
      ]);
    },
    onError: () => toast.error("No se pudo registrar el reembolso"),
  });

  const breadcrumbs = [
    { label: "Pagos", href: "/payments" },
    { label: `#${params.id.slice(0, 8)}` },
  ];

  if (sessionQ.isLoading) {
    return (
      <div>
        <PageHeader title="Pago" backHref="/payments" breadcrumbs={breadcrumbs} />
        <Section title="Cargando pago">
          <SkeletonText lines={4} label="Cargando pago…" />
        </Section>
      </div>
    );
  }

  if (sessionQ.isError || !sessionQ.data) {
    return (
      <div>
        <PageHeader title="Pago" backHref="/payments" breadcrumbs={breadcrumbs} />
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>No se pudo cargar esta sesión de pago</AlertTitle>
          <AlertDescription>
            <p>Revisa el identificador o inténtalo de nuevo.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void sessionQ.refetch()}>
                Reintentar
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/payments">Volver a pagos</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const s = sessionQ.data;
  const refundable = s.status === "CAPTURED" || s.status === "PARTIALLY_REFUNDED";

  return (
    <div>
      <PageHeader
        title={`Pago ${s.id.slice(0, 8)}…`}
        backHref="/payments"
        breadcrumbs={[{ label: "Pagos", href: "/payments" }, { label: `#${s.id.slice(0, 8)}` }]}
        meta={
          <>
            <StatusBadge status={s.status} domain="payment" withDot />
            <span className="text-foreground">{s.order.customer.fullName}</span>
            <span aria-hidden>·</span>
            <span>
              Pedido{" "}
              <Link
                href={`/orders/${s.orderId}`}
                className="font-mono text-xs text-primary-strong underline-offset-4 hover:underline"
                title={s.orderId}
              >
                {s.orderId.slice(0, 8)}…
              </Link>
            </span>
            <Badge variant={s.livemode ? "info" : "neutral"}>
              {s.livemode ? "Livemode" : "Modo de pruebas"}
            </Badge>
          </>
        }
        actions={
          <>
            <LinesSheet
              amount={s.amount}
              currency={s.currency}
              customerName={s.order.customer.fullName}
              customerEmail={s.order.customer.email}
              customerPhone={s.order.customer.phone}
              customerTaxId={s.order.customer.taxId}
              customerId={s.order.customer.id}
              orderId={s.orderId}
              orderTotal={s.order.total}
              orderSubtotal={s.order.subtotal}
              orderTax={s.order.tax}
              orderShipping={s.order.shipping}
              orderDiscount={s.order.discount}
              lines={s.lines}
            />
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

      <div className="space-y-6">
        {/*
          Estas tres cifras las calcula el backend para ESTA sesión
          (`payment.service.ts#getSession`: netTotal = amount − Σ reembolsos de
          la propia sesión). No hay aritmética de cliente aquí, y a diferencia
          del resumen del listado no hay doble resta: el minuendo es el monto
          bruto de la sesión, no un subconjunto filtrado por estado.
        */}
        <section aria-label="Resumen del pago" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <StatTile size="compact" label="Monto" value={<Money value={s.amount} currency={s.currency} />} />
          <StatTile size="compact"
            label="Reembolsado"
            tone={toCents(s.refundedTotal) ? "warning" : "neutral"}
            value={<Money value={s.refundedTotal} currency={s.currency} />}
          />
          <StatTile size="compact"
            label="Neto"
            tone="success"
            value={<Money value={s.netTotal} currency={s.currency} />}
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Tabs defaultValue="ledger" className="space-y-4">
              <TabsList>
                <TabsTrigger value="ledger">Ledger ({s.ledger.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="ledger">
                <Section title="Movimientos de esta sesión" padded={false}>
                  {s.ledger.length === 0 ? (
                    <EmptyState
                      icon={<ReceiptText className="h-6 w-6" />}
                      title="Sin movimientos"
                      description="Cargos, reembolsos, comisiones y ajustes de esta sesión aparecerán aquí."
                    />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow interactive={false}>
                          <TableHead>Tipo</TableHead>
                          <TableHead numeric>Monto</TableHead>
                          <TableHead numeric>Saldo</TableHead>
                          <TableHead>Descripción</TableHead>
                          <TableHead>Fecha</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {s.ledger.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell>
                              <StatusBadge status={l.entryType} domain="ledger" />
                            </TableCell>
                            <TableCell numeric>
                              <Money value={l.amount} />
                            </TableCell>
                            <TableCell numeric>
                              <Money value={l.balanceAfter} className="text-muted-foreground" />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {l.description}
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
                  )}
                </Section>
              </TabsContent>
            </Tabs>

            <Section title="Línea de tiempo">
              <DescriptionList divided>
                <FieldRow label="Método de pago">
                  {s.paymentMethod
                    ? { CARD: "Tarjeta", SPEI: "Transferencia SPEI", OXXO: "Efectivo OXXO" }[s.paymentMethod] ?? s.paymentMethod
                    : "Pendiente"}
                </FieldRow>
                <FieldRow label="Sesión creada">
                  <DateTime value={s.createdAt} />
                </FieldRow>
                {s.capturedAt ? (
                  <FieldRow label="Cobrado">
                    <DateTime value={s.capturedAt} />
                  </FieldRow>
                ) : null}
                {s.failedAt ? (
                  <FieldRow label="Fallido">
                    <DateTime value={s.failedAt} />
                  </FieldRow>
                ) : null}
                <FieldRow label="Vence">
                  <DateTime value={s.expiresAt} />
                </FieldRow>
                <FieldRow label="Última actualización">
                  <DateTime value={s.updatedAt} />
                </FieldRow>
              </DescriptionList>
            </Section>
          </div>

          <div className="space-y-6">
            <Section
              title="Cliente"
              footer={
                <Button asChild variant="outline" size="sm">
                  <Link href={`/customers/${s.order.customer.id}`}>Ver cliente</Link>
                </Button>
              }
            >
              <DescriptionList divided>
                <FieldRow label="Nombre">{s.order.customer.fullName}</FieldRow>
                <FieldRow label="Correo">{s.order.customer.email}</FieldRow>
                <FieldRow label="Teléfono">{s.order.customer.phone}</FieldRow>
                <FieldRow label="RFC" mono>
                  {s.order.customer.taxId}
                </FieldRow>
              </DescriptionList>
            </Section>

            <Section
              title="Pedido"
              footer={
                <Button asChild variant="outline" size="sm">
                  <Link href={`/orders/${s.orderId}`}>Ver pedido completo</Link>
                </Button>
              }
            >
              <DescriptionList divided>
                <FieldRow label="Estado">
                  <StatusBadge status={s.order.status} domain="order" />
                </FieldRow>
                <FieldRow label="Origen">
                  {SOURCE_LABELS[s.order.source] ?? s.order.source}
                </FieldRow>
                <FieldRow label="Subtotal" numeric>
                  <Money value={s.order.subtotal} />
                </FieldRow>
                <FieldRow label="Descuento" numeric>
                  <Money value={s.order.discount} />
                </FieldRow>
                <FieldRow label="IVA" numeric>
                  <Money value={s.order.tax} />
                </FieldRow>
                <FieldRow label="Envío" numeric>
                  <Money value={s.order.shipping} />
                </FieldRow>
                <FieldRow label="Total" numeric emphasis>
                  <Money value={s.order.total} emphasis showCurrency />
                </FieldRow>
              </DescriptionList>
            </Section>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        title={`¿Reembolsar ${formatMoney(refundAmount, s.currency)}?`}
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
