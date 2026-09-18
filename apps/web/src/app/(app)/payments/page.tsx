"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreditCard, Hourglass, ReceiptText, RotateCcw, Search, TrendingUp, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { Money, formatMoney } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { StatTile } from "@/components/app/stat-tile";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { centsToDecimalString, toCents } from "@/lib/decimal";
import { useReportSummary } from "../_dashboard/use-dashboard-data";

/** Estados de sesión sobre los que el backend admite un (nuevo) reembolso. */
const REFUNDABLE_STATUSES = new Set(["CAPTURED", "PARTIALLY_REFUNDED"]);

interface Session {
  id: string;
  orderId: string;
  amount: string;
  /** Acumulado ya reembolsado de esta sesión. `amount` nunca lo descuenta. */
  refundedTotal: string;
  currency: string;
  status: string;
  /** CARD | SPEI | OXXO; null mientras la sesión sigue pendiente. */
  paymentMethod: string | null;
  customerName: string | null;
  capturedAt: string | null;
  createdAt: string;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CARD: "Tarjeta",
  SPEI: "SPEI",
  OXXO: "OXXO",
};

function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return "—";
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

/**
 * Lo que aún se puede reembolsar de una sesión, en centavos enteros para no
 * arrastrar error de flotante sobre los `Decimal(12,2)` del backend. `null` si
 * algún importe no se puede leer: entonces el diálogo abre vacío en vez de
 * proponer una cifra inventada.
 */
function remainingRefundable(s: Session): string | null {
  const amount = toCents(s.amount);
  const refunded = toCents(s.refundedTotal);
  if (amount === null || refunded === null) return null;
  return centsToDecimalString(Math.max(0, amount - refunded));
}

interface LedgerEntry {
  id: string;
  sessionId: string;
  entryType: string;
  amount: string;
  balanceAfter: string;
  description: string;
  recordedAt: string;
}

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const [refundTarget, setRefundTarget] = useState<Session | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [filter, setFilter] = useState("");

  const sessions = useQuery({
    queryKey: ["payment-sessions"],
    queryFn: async () => {
      const res = await api.get<{ data: Session[] }>("/payments/sessions");
      return res.data.data;
    },
  });

  const ledger = useQuery({
    queryKey: ["payment-ledger"],
    queryFn: async () => {
      const res = await api.get<{ data: LedgerEntry[] }>("/payments/ledger");
      return res.data.data;
    },
  });

  /**
   * Cifras de resumen. Las calcula el backend con agregados SQL sobre las
   * tablas completas (`GET /reports/summary`), no este cliente sobre las filas
   * que quepan en la ventana del listado. Misma clave de caché que el
   * panorama: navegar entre las dos pantallas no repite la petición.
   */
  const summary = useReportSummary();
  const sum = summary.data;
  /** Los cuatro mosaicos comparten consulta, y con ella carga, error y reintento. */
  const summaryTile = {
    isLoading: summary.isLoading,
    isError: summary.isError,
    onRetry: () => void summary.refetch(),
  };

  const refund = useMutation({
    mutationFn: async () => {
      await api.post("/payments/refunds", {
        sessionId: refundTarget!.id,
        amount: refundAmount,
        reason: refundReason,
      });
    },
    onSuccess: async () => {
      toast.success("Reembolso registrado");
      setRefundTarget(null);
      setRefundAmount("");
      setRefundReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["payment-sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["payment-ledger"] }),
        queryClient.invalidateQueries({ queryKey: ["reports-summary"] }),
      ]);
    },
    onError: () => toast.error("No se pudo registrar el reembolso"),
  });

  function openRefund(s: Session) {
    setRefundTarget(s);
    // Se propone lo que QUEDA por reembolsar, no el bruto de la sesión: sobre
    // una sesión ya reembolsada a medias, proponer `amount` sería proponer un
    // importe que el backend rechaza por excederse.
    setRefundAmount(remainingRefundable(s) ?? "");
    setRefundReason("");
  }

  const needle = filter.trim().toLowerCase();
  const visibleSessions = useMemo(
    () =>
      (sessions.data ?? []).filter(
        (s) =>
          !needle ||
          s.id.toLowerCase().includes(needle) ||
          (s.customerName ?? "").toLowerCase().includes(needle) ||
          s.status.toLowerCase().includes(needle),
      ),
    [sessions.data, needle],
  );
  const visibleLedger = useMemo(
    () =>
      (ledger.data ?? []).filter(
        (l) =>
          !needle ||
          l.sessionId.toLowerCase().includes(needle) ||
          l.entryType.toLowerCase().includes(needle) ||
          l.description.toLowerCase().includes(needle),
      ),
    [ledger.data, needle],
  );

  const sessionColumns: Array<DataTableColumn<Session>> = [
    {
      key: "id",
      header: "Sesión",
      width: "9rem",
      cell: (s) => (
        <span className="font-mono text-xs" title={s.id}>
          {s.id.slice(0, 8)}…
        </span>
      ),
    },
    { key: "customer", header: "Cliente", cell: (s) => s.customerName ?? "—" },
    {
      key: "status",
      header: "Estado",
      width: "9rem",
      cell: (s) => <StatusBadge status={s.status} domain="payment" withDot />,
    },
    {
      key: "amount",
      header: "Monto",
      numeric: true,
      width: "9rem",
      cell: (s) => <Money value={s.amount} currency={s.currency} />,
    },
    {
      key: "paymentMethod",
      header: "Método",
      width: "7rem",
      cell: (s) => (
        <span className="text-xs text-muted-foreground">{paymentMethodLabel(s.paymentMethod)}</span>
      ),
    },
    {
      key: "createdAt",
      header: "Creada",
      width: "11rem",
      cell: (s) => <DateTime value={s.createdAt} className="text-xs text-muted-foreground" />,
    },
    {
      key: "capturedAt",
      header: "Capturado",
      width: "11rem",
      cell: (s) => <DateTime value={s.capturedAt} className="text-xs text-muted-foreground" />,
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      width: "9rem",
      className: "text-right",
      // Una sesión reembolsada a medias sigue admitiendo reembolso: el backend
      // acepta CAPTURED y PARTIALLY_REFUNDED mientras quede saldo.
      cell: (s) =>
        REFUNDABLE_STATUSES.has(s.status) ? (
          <Button variant="outline" size="sm" onClick={() => openRefund(s)}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reembolsar
          </Button>
        ) : null,
    },
  ];

  const ledgerColumns: Array<DataTableColumn<LedgerEntry>> = [
    {
      key: "sessionId",
      header: "Sesión",
      width: "9rem",
      cell: (l) => (
        <span className="font-mono text-xs" title={l.sessionId}>
          {l.sessionId.slice(0, 8)}…
        </span>
      ),
    },
    {
      key: "entryType",
      header: "Tipo",
      width: "8rem",
      cell: (l) => <StatusBadge status={l.entryType} domain="ledger" />,
    },
    {
      key: "amount",
      header: "Monto",
      numeric: true,
      width: "9rem",
      cell: (l) => <Money value={l.amount} />,
    },
    {
      key: "balanceAfter",
      header: "Saldo",
      numeric: true,
      width: "9rem",
      cell: (l) => <Money value={l.balanceAfter} className="text-muted-foreground" />,
    },
    {
      key: "description",
      header: "Descripción",
      cell: (l) => <span className="text-xs text-muted-foreground">{l.description}</span>,
    },
    {
      key: "recordedAt",
      header: "Fecha",
      width: "11rem",
      cell: (l) => <DateTime value={l.recordedAt} className="text-xs text-muted-foreground" />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Pagos"
        description="Sesiones de checkout, ledger de movimientos y reembolsos."
      />

      <div className="space-y-6">
        {/*
          Las cuatro cifras salen de `GET /reports/summary`, que las calcula con
          agregados SQL sobre las tablas completas. Antes se sumaban aquí las
          filas de dos listados con topes distintos (50 sesiones, 100
          movimientos) y había que confesarlo en una nota al pie: describían esa
          ventana, no el histórico del comercio. Ya no.

          Y el "Neto" vuelve a tener mosaico propio. Se quitó porque no se podía
          calcular: `refund()` marcaba la sesión ENTERA como REFUNDED aunque el
          reembolso fuera parcial, así que su importe bruto desaparecía del
          filtro CAPTURED y restarle encima el ledger lo descontaba dos veces.
          Ahora la sesión conserva `amount` y acumula `refundedTotal`, y el
          backend devuelve bruto y neto por separado.
        */}
        <Section title="Resumen">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile size="compact"
              {...summaryTile}
              label="Cobrado (bruto)"
              tone="neutral"
              icon={<Wallet className="h-4 w-4" />}
              value={<Money value={sum?.capturedGross} />}
              hint="Todo lo que llegó a cobrarse, antes de reembolsos"
            />
            <StatTile size="compact"
              {...summaryTile}
              label="Reembolsado"
              tone="warning"
              icon={<RotateCcw className="h-4 w-4" />}
              value={<Money value={sum?.refundedTotal} />}
              hint="Devuelto al cliente, total y parcial"
            />
            <StatTile size="compact"
              {...summaryTile}
              label="Cobrado y no reembolsado"
              tone="success"
              icon={<TrendingUp className="h-4 w-4" />}
              value={<Money value={sum?.capturedNet} />}
              hint="Bruto menos reembolsos"
            />
            <StatTile size="compact"
              {...summaryTile}
              label="Por cobrar"
              tone="warning"
              icon={<Hourglass className="h-4 w-4" />}
              value={<Money value={sum?.outstandingTotal} />}
              hint={
                sum === undefined
                  ? undefined
                  : sum.outstandingCount === 0
                    ? "Ningún pedido espera cobro."
                    : `${sum.outstandingCount} ${
                        sum.outstandingCount === 1 ? "pedido" : "pedidos"
                      } esperando pago`
              }
            />
          </div>
        </Section>

        <Tabs defaultValue="pagos" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList>
              <TabsTrigger value="pagos">Pagos ({sessions.data?.length ?? 0})</TabsTrigger>
              <TabsTrigger value="ledger">Ledger ({ledger.data?.length ?? 0})</TabsTrigger>
            </TabsList>
            <div className="relative sm:w-72">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrar por id, cliente o estado…"
                className="pl-9"
                aria-label="Filtrar pagos y movimientos"
              />
            </div>
          </div>

          <TabsContent value="pagos">
            <Section title="Sesiones de pago" padded={false}>
              <DataTable
                columns={sessionColumns}
                rows={visibleSessions}
                isLoading={sessions.isLoading}
                isError={sessions.isError}
                error={sessions.error}
                onRetry={() => void sessions.refetch()}
                getRowHref={(s) => `/payments/${s.id}`}
                caption="Sesiones de checkout del comercio"
                empty={
                  needle
                    ? {
                        icon: <Search className="h-6 w-6" />,
                        title: "Ningún pago coincide",
                        description:
                          "Ajusta el filtro: busca por id de sesión, nombre del cliente o estado.",
                        action: (
                          <Button variant="outline" onClick={() => setFilter("")}>
                            Limpiar filtro
                          </Button>
                        ),
                      }
                    : {
                        icon: <CreditCard className="h-6 w-6" />,
                        title: "Sin sesiones de pago",
                        description:
                          "Cada checkout que abras desde un pedido aparecerá aquí con su monto y su estado.",
                      }
                }
              />
            </Section>
          </TabsContent>

          <TabsContent value="ledger">
            <Section title="Movimientos" padded={false}>
              <DataTable
                columns={ledgerColumns}
                rows={visibleLedger}
                isLoading={ledger.isLoading}
                isError={ledger.isError}
                error={ledger.error}
                onRetry={() => void ledger.refetch()}
                getRowHref={(l) => `/payments/${l.sessionId}`}
                caption="Movimientos del ledger"
                empty={
                  needle
                    ? {
                        icon: <Search className="h-6 w-6" />,
                        title: "Ningún movimiento coincide",
                        description:
                          "Ajusta el filtro: busca por id de sesión, tipo de movimiento o descripción.",
                        action: (
                          <Button variant="outline" onClick={() => setFilter("")}>
                            Limpiar filtro
                          </Button>
                        ),
                      }
                    : {
                        icon: <ReceiptText className="h-6 w-6" />,
                        title: "Sin movimientos",
                        description:
                          "El ledger registra cargos, reembolsos, comisiones y ajustes en cuanto se cobre el primer pago.",
                      }
                }
              />
            </Section>
          </TabsContent>
        </Tabs>
      </div>

      <ConfirmDialog
        open={refundTarget !== null}
        onOpenChange={(open) => !open && setRefundTarget(null)}
        title={`¿Reembolsar sesión ${refundTarget?.id.slice(0, 8)}…?`}
        description={
          <div className="space-y-3 pt-1">
            <p>Esta acción registra el reembolso en el ledger. No se puede deshacer.</p>
            {refundTarget && toCents(refundTarget.refundedTotal) ? (
              <p>
                Esta sesión ya tiene {formatMoney(refundTarget.refundedTotal)} reembolsados de{" "}
                {formatMoney(refundTarget.amount, refundTarget.currency)}; quedan{" "}
                {formatMoney(remainingRefundable(refundTarget), refundTarget.currency)}.
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="refund-amount">Monto a reembolsar</Label>
              <Input
                id="refund-amount"
                placeholder="0.00"
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
