"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";

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

function statusVariant(status: string): "success" | "warning" | "muted" | "destructive" {
  if (status === "CAPTURED") return "success";
  if (status === "PENDING") return "warning";
  if (status === "FAILED" || status === "REFUNDED") return "destructive";
  return "muted";
}

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const [refundTarget, setRefundTarget] = useState<Session | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pagos"
        description="Sesiones de checkout, ledger de movimientos y reembolsos."
      />

      <section className="overflow-x-auto rounded-card border bg-card p-4">
        <h2 className="mb-3 font-semibold">Sesiones de checkout</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="p-2">ID</th>
              <th className="p-2">Cliente</th>
              <th className="p-2">Estado</th>
              <th className="p-2 text-right">Monto</th>
              <th className="p-2">Capturado</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {sessions.data?.map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="p-2 font-mono text-xs">{s.id.slice(0, 8)}…</td>
                <td className="p-2">{s.customerName ?? "—"}</td>
                <td className="p-2">
                  <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
                </td>
                <td className="p-2 text-right font-mono">
                  ${s.amount} {s.currency}
                </td>
                <td className="p-2 text-xs text-muted-foreground">
                  {s.capturedAt ? new Date(s.capturedAt).toLocaleString() : "—"}
                </td>
                <td className="p-2 text-right">
                  {s.status === "CAPTURED" && (
                    <Button variant="outline" size="sm" onClick={() => openRefund(s)}>
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reembolsar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {sessions.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="p-3 text-center text-sm text-muted-foreground">
                  Sin sesiones de pago.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="overflow-x-auto rounded-card border bg-card p-4">
        <h2 className="mb-3 font-semibold">Ledger</h2>
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
            {ledger.data?.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="p-2 font-mono text-xs">{l.sessionId.slice(0, 8)}…</td>
                <td className="p-2 text-xs uppercase">{l.entryType}</td>
                <td className="p-2 text-right font-mono">${l.amount}</td>
                <td className="p-2 text-right font-mono">${l.balanceAfter}</td>
                <td className="p-2 text-xs text-muted-foreground">{l.description}</td>
                <td className="p-2 text-xs text-muted-foreground">
                  {new Date(l.recordedAt).toLocaleString()}
                </td>
              </tr>
            ))}
            {ledger.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="p-3 text-center text-sm text-muted-foreground">
                  Sin movimientos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

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
