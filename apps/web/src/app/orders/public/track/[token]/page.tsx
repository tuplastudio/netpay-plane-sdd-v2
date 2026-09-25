"use client";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  PackageCheck,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Money } from "@/components/app/money";
import { DateTime } from "@/components/app/date-time";

interface TrackingLine {
  variantId: string;
  sku: string;
  title: string;
  quantity: string;
}

interface TrackingView {
  id: string;
  status: string;
  total: string;
  merchant: string;
  customer: { fullName: string };
  lines: TrackingLine[];
  timeline: {
    createdAt: string;
    paidAt: string | null;
    fulfilledAt: string | null;
    cancelledAt: string | null;
  };
}

async function fetchTracking(token: string): Promise<TrackingView> {
  const res = await fetch(`/api/v1/orders/public/track/${token}`, { credentials: "omit" });
  if (!res.ok) {
    throw new Error(res.status === 404 ? "Link inválido" : "Error al cargar");
  }
  const json = await res.json();
  return json.data as TrackingView;
}

const STEPS: Array<{ key: keyof TrackingView["timeline"]; label: string }> = [
  { key: "createdAt", label: "Pedido creado" },
  { key: "paidAt", label: "Pago confirmado" },
  { key: "fulfilledAt", label: "Entregado" },
];

export default function PublicOrderTrackingPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const q = useQuery({
    queryKey: ["public-order-tracking", token],
    queryFn: () => fetchTracking(token),
    retry: false,
    staleTime: 30_000,
  });

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-4">
          {/* Marca, no navegación: la abre un cliente final sin cuenta, y `/`
              redirige a `/login` a quien no trae sesión. */}
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
            >
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold">{q.data?.merchant ?? "Easy Sell"}</span>
          </span>
          <span className="text-xs text-muted-foreground">Seguimiento de pedido</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError || !q.data ? (
          <ErrorState onRetry={() => void q.refetch()} retrying={q.isFetching} />
        ) : (
          <TrackingCard tracking={q.data} />
        )}
      </main>
    </div>
  );
}

function LoadingState() {
  return (
    <SkeletonRegion label="Cargando el pedido…" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-56" />
      </div>
      <div className="space-y-3 rounded-card border bg-card p-5 shadow-airbnb">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </SkeletonRegion>
  );
}

function ErrorState({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <Alert variant="warning">
      <AlertTriangle aria-hidden />
      <AlertTitle>Este link ya no está disponible</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>El link es inválido. Pide a tu asesor uno nuevo.</p>
        <Button variant="outline" size="sm" loading={retrying} onClick={onRetry}>
          <RefreshCw aria-hidden className="h-3.5 w-3.5" />
          Reintentar
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "PAID":
      return "Pago confirmado, preparando tu pedido";
    case "FULFILLED":
      return "Entregado";
    case "CANCELLED":
      return "Cancelado";
    case "EXPIRED":
      return "Vencido";
    default:
      return "En proceso";
  }
}

function TrackingCard({ tracking }: { tracking: TrackingView }) {
  const cancelled = !!tracking.timeline.cancelledAt;

  return (
    <article className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Pedido</p>
        <h1 className="text-2xl font-semibold tracking-tight">{tracking.customer.fullName}</h1>
        <p className="text-sm text-muted-foreground">
          Folio <span className="font-mono">{tracking.id.slice(0, 8)}</span>
        </p>
      </header>

      {cancelled ? (
        <Alert variant="destructive">
          <XCircle aria-hidden />
          <AlertTitle>Pedido cancelado</AlertTitle>
          <AlertDescription>
            Este pedido fue cancelado <DateTime value={tracking.timeline.cancelledAt} />.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="rounded-card border bg-card p-5 text-center shadow-airbnb sm:p-6">
        <h2 className="text-sm text-muted-foreground">Estado actual</h2>
        <p className="mt-1 text-xl font-semibold">{statusLabel(tracking.status)}</p>
        <Money value={tracking.total} emphasis className="mt-3 block text-2xl leading-none" />
      </section>

      {!cancelled ? (
        <section className="rounded-card border bg-card p-5 shadow-airbnb sm:p-6">
          <h2 className="mb-4 text-sm font-semibold">Seguimiento</h2>
          <ol className="space-y-4">
            {STEPS.map((step) => {
              const at = tracking.timeline[step.key];
              const done = !!at;
              return (
                <li key={step.key} className="flex items-start gap-3">
                  {done ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-foreground" aria-hidden />
                  ) : (
                    <CircleDot className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <div>
                    <p className={done ? "font-medium" : "text-muted-foreground"}>{step.label}</p>
                    {at ? (
                      <p className="text-xs text-muted-foreground">
                        <DateTime value={at} />
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-card border bg-card shadow-airbnb">
        <h2 className="flex items-center gap-2 px-5 pt-5 text-base font-semibold sm:px-6 sm:pt-6">
          <PackageCheck className="h-4 w-4" aria-hidden />
          Lo que llevas
        </h2>
        <ul className="mt-3 divide-y">
          {tracking.lines.map((line) => (
            <li key={line.variantId} className="flex items-center justify-between px-5 py-3 text-sm sm:px-6">
              <span>{line.title}</span>
              <span className="text-muted-foreground">x{line.quantity}</span>
            </li>
          ))}
        </ul>
        <div className="h-2" />
      </section>
    </article>
  );
}
