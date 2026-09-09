"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Clock, XCircle, AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PublicOrderLine {
  variantId: string;
  sku: string;
  title: string;
  quantity: string;
}

interface PublicOrder {
  id: string;
  status: string;
  subtotal: string;
  discount: string;
  tax: string;
  shipping: string;
  total: string;
  merchant: string;
  expiresAt: string | null;
  customer: { fullName: string };
  lines: PublicOrderLine[];
}

const PAYABLE = ["CHECKOUT_OPEN", "AWAITING_PAYMENT"];

function useCountdown(expiresAt: string | null) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) {
      setRemainingMs(null);
      return;
    }
    const target = new Date(expiresAt).getTime();
    const tick = () => setRemainingMs(Math.max(0, target - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return remainingMs;
}

function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function CheckoutPublicPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [paying, setPaying] = useState(false);

  const orderQ = useQuery({
    queryKey: ["public-order", token],
    queryFn: async () => {
      const res = await api.get<{ data: PublicOrder }>(`/orders/public/${token}`);
      return res.data.data;
    },
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && PAYABLE.includes(status) ? 3000 : false;
    },
  });

  const order = orderQ.data;
  const remainingMs = useCountdown(order && PAYABLE.includes(order.status) ? order.expiresAt : null);
  const expired = remainingMs === 0;

  async function startCheckout() {
    setPaying(true);
    try {
      const res = await api.post(`/orders/public/${token}/checkout`);
      const data = res.data.data;
      window.location.href = data.checkoutUrl;
    } catch {
      toast.error("No se pudo iniciar el pago");
      setPaying(false);
    }
  }

  if (orderQ.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (orderQ.isError || !order) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <div className="w-full max-w-sm space-y-3 rounded-card border bg-card p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="text-lg font-semibold">Link inválido o expirado</h1>
          <p className="text-sm text-muted-foreground">
            Este enlace de pago ya no es válido. Pide al vendedor que genere uno nuevo.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md space-y-4">
        <header className="text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {order.merchant}
          </p>
          <h1 className="text-xl font-semibold">Pago del pedido</h1>
          <p className="text-sm text-muted-foreground">{order.customer.fullName}</p>
        </header>

        <div className="overflow-hidden rounded-card border bg-card shadow-sm">
          <div className="border-b p-6 text-center">
            <p className="text-sm text-muted-foreground">Total a pagar</p>
            <p className="my-1 font-mono text-4xl font-semibold tabular-nums">${order.total}</p>
            <StatusPill status={order.status} expired={expired} />
          </div>

          {order.lines.length > 0 && (
            <div className="space-y-2 border-b p-5">
              {order.lines.map((l) => (
                <div key={l.variantId} className="flex items-center justify-between text-sm">
                  <span className="truncate">
                    {l.title} <span className="text-muted-foreground">× {l.quantity}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{l.sku}</span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5 border-b p-5 text-sm">
            <TotalRow label="Subtotal" value={order.subtotal} />
            <TotalRow label="Descuento" value={order.discount} />
            <TotalRow label="IVA" value={order.tax} />
            <TotalRow label="Envío" value={order.shipping} />
          </div>

          <div className="p-6">
            {PAYABLE.includes(order.status) && !expired && (
              <>
                <Button className="w-full" size="lg" onClick={startCheckout} disabled={paying}>
                  {paying ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Redirigiendo…
                    </>
                  ) : (
                    "Pagar con dummy"
                  )}
                </Button>
                {remainingMs !== null && (
                  <p
                    className={cn(
                      "mt-3 flex items-center justify-center gap-1.5 text-xs",
                      remainingMs < 60_000 ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    Expira en {formatCountdown(remainingMs)}
                  </p>
                )}
                <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Esta página se actualiza sola al confirmarse el pago.
                </p>
              </>
            )}

            {order.status === "PAID" && (
              <div className="space-y-1 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                <p className="font-medium">¡Pago confirmado!</p>
                <p className="text-sm text-muted-foreground">Puedes cerrar esta ventana.</p>
              </div>
            )}

            {(order.status === "EXPIRED" || expired) && (
              <div className="space-y-1 text-center">
                <Clock className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="font-medium">El link de pago expiró</p>
                <p className="text-sm text-muted-foreground">
                  Pide al vendedor un nuevo link de pago.
                </p>
              </div>
            )}

            {order.status === "CANCELLED" && (
              <div className="space-y-1 text-center">
                <XCircle className="mx-auto h-10 w-10 text-destructive" />
                <p className="font-medium">Pedido cancelado</p>
                <p className="text-sm text-muted-foreground">Este pedido ya no acepta pagos.</p>
              </div>
            )}
          </div>
        </div>

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Pasarela simulada · <code>livemode=false</code> · sin dinero real
        </p>
      </div>
    </main>
  );
}

function StatusPill({ status, expired }: { status: string; expired: boolean }) {
  const effective = expired && PAYABLE.includes(status) ? "EXPIRED" : status;
  const map: Record<string, { label: string; className: string }> = {
    CHECKOUT_OPEN: { label: "Esperando pago", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
    AWAITING_PAYMENT: { label: "Esperando pago", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
    PAID: { label: "Pagado", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
    EXPIRED: { label: "Expirado", className: "bg-muted text-muted-foreground" },
    CANCELLED: { label: "Cancelado", className: "bg-destructive/10 text-destructive" },
  };
  const cfg = map[effective] ?? { label: effective, className: "bg-muted text-muted-foreground" };
  return (
    <span
      className={cn(
        "mt-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
        cfg.className,
      )}
    >
      {cfg.label}
    </span>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono text-foreground">${value}</span>
    </div>
  );
}
