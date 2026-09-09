"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/app/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { money, statusVariant, PAYMENT_STATUS_LABEL, LEDGER_TYPE_LABEL } from "@/lib/payments";

interface Session {
  id: string;
  orderId: string;
  amount: string;
  currency: string;
  status: string;
  customerName: string | null;
  capturedAt: string | null;
  createdAt: string;
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
      ]);
    },
    onError: () => toast.error("No se pudo registrar el reembolso"),
  });

  function openRefund(s: Session) {
    setRefundTarget(s);
    setRefundAmount(s.amount);
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

  const totals = useMemo(() => {
    const list = sessions.data ?? [];
    const captured = list.filter((s) => s.status === "CAPTURED");
    const refunded = (ledger.data ?? []).filter((l) => l.entryType === "REFUND");
    return {
      capturedCount: captured.length,
      capturedAmount: captured.reduce((sum, s) => sum + Number(s.amount), 0),
      pending: list.filter((s) => s.status === "PENDING").length,
      refundedAmount: refunded.reduce((sum, l) => sum + Number(l.amount), 0),
    };
  }, [sessions.data, ledger.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pagos"
        description="Sesiones de checkout, ledger de movimientos y reembolsos."
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cobrado" value={money(totals.capturedAmount)} hint={`${totals.capturedCount} sesiones`} />
        <Stat label="Reembolsado" value={money(totals.refundedAmount)} />
        <Stat label="Pendientes" value={String(totals.pending)} hint="esperando pago" />
        <Stat label="Neto" value={money(totals.capturedAmount - totals.refundedAmount)} />
      </section>

      <Tabs defaultValue="pagos" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="pagos">Pagos ({sessions.data?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="ledger">Ledger ({ledger.data?.length ?? 0})</TabsTrigger>
          </TabsList>
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filtrar por id, cliente o estado…"
              className="h-9 pl-8"
              aria-label="Filtrar pagos"
            />
          </div>
        </div>

        <TabsContent value="pagos">
          <section className="overflow-x-auto rounded-card border bg-card p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="p-2">Sesión</th>
                  <th className="p-2">Cliente</th>
                  <th className="p-2">Estado</th>
                  <th className="p-2 text-right">Monto</th>
                  <th className="p-2">Creada</th>
                  <th className="p-2">Capturado</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {visibleSessions.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="p-2">
                      <Link
                        href={`/payments/${s.id}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {s.id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="p-2">{s.customerName ?? "—"}</td>
                    <td className="p-2">
                      <Badge variant={statusVariant(s.status)}>
                        {PAYMENT_STATUS_LABEL[s.status] ?? s.status}
                      </Badge>
                    </td>
                    <td className="p-2 text-right font-mono">
                      ${s.amount} {s.currency}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {new Date(s.createdAt).toLocaleString("es-MX")}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {s.capturedAt ? new Date(s.capturedAt).toLocaleString("es-MX") : "—"}
                    </td>
                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/payments/${s.id}`}>Ver detalle</Link>
                        </Button>
                        {s.status === "CAPTURED" && (
                          <Button variant="outline" size="sm" onClick={() => openRefund(s)}>
                            <RotateCcw className="h-3.5 w-3.5" />
                            Reembolsar
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleSessions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-3 text-center text-sm text-muted-foreground">
                      {needle ? "Ningún pago coincide con el filtro." : "Sin sesiones de pago."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </TabsContent>

        <TabsContent value="ledger">
          <section className="overflow-x-auto rounded-card border bg-card p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="p-2">Sesión</th>
                  <th className="p-2">Tipo</th>
                  <th className="p-2 text-right">Monto</th>
                  <th className="p-2 text-right">Saldo</th>
                  <th className="p-2">Descripción</th>
                  <th className="p-2">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {visibleLedger.map((l) => (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="p-2">
                      <Link
                        href={`/payments/${l.sessionId}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {l.sessionId.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="p-2 text-xs">
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
                {visibleLedger.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-3 text-center text-sm text-muted-foreground">
                      {needle ? "Ningún movimiento coincide con el filtro." : "Sin movimientos."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={refundTarget !== null}
        onOpenChange={(open) => !open && setRefundTarget(null)}
        title={`¿Reembolsar sesión ${refundTarget?.id.slice(0, 8)}…?`}
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
        pending={refund.isPending}
        onConfirm={() => refund.mutate()}
      />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
