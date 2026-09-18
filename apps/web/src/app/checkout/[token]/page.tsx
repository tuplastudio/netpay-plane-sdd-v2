"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  ChevronRight,
  ShieldCheck,
  Store,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Money } from "@/components/app/money";
import { DateTime } from "@/components/app/date-time";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { cn } from "@/lib/utils";
import {
  ProductDetailSheet,
  type ProductDetailProduct,
} from "@/components/app/product-detail-sheet";
import { BillingSection } from "./_components/billing-section";

interface PublicOrderLine {
  variantId: string;
  sku: string;
  title: string;
  quantity: string;
  unitPrice: string | null;
  lineTotal: string | null;
  /** Producto padre con sus variantes activas, para el detalle sin sesión. */
  product: ProductDetailProduct | null;
}

/** Lo que se abre al tocar una línea: el producto real o, si ya no está en catálogo, la línea. */
function productFor(line: PublicOrderLine): ProductDetailProduct {
  if (line.product) return line.product;
  return {
    sku: line.sku,
    title: line.title,
    description: null,
    variants: [
      { id: line.variantId, sku: line.sku, title: line.title, price: line.unitPrice ?? "0", stock: null },
    ],
  };
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

/** Columna centrada de ancho acotado: la misma en los cuatro estados. */
function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen justify-center bg-muted/30 px-4 py-6 sm:items-center sm:py-10">
      <div className="w-full max-w-md space-y-4">{children}</div>
    </main>
  );
}

function BrandMark({ merchant }: { merchant?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span
        aria-hidden
        className="flex h-11 w-11 items-center justify-center rounded-card bg-primary text-primary-foreground"
      >
        <Store className="h-5 w-5" />
      </span>
      {merchant ? (
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {merchant}
        </p>
      ) : null}
    </div>
  );
}

/** Pie de confianza: siempre visible, incluso en error o carga. */
function TrustLine() {
  return (
    <p className="flex flex-wrap items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
      <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
      Modo de pruebas · sin dinero real
    </p>
  );
}

export default function CheckoutPublicPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [paying, setPaying] = useState(false);
  const [detailLine, setDetailLine] = useState<PublicOrderLine | null>(null);

  const orderQ = useQuery({
    queryKey: ["public-order", token],
    queryFn: async () => {
      const res = await api.get<{ data: PublicOrder }>(`/orders/public/${token}`);
      return res.data.data;
    },
    retry: false,
    // Antes del click en "Pagar" (CHECKOUT_OPEN) no hay nada que esperar:
    // cero polling. Después (AWAITING_PAYMENT) el webhook del gateway puede
    // marcar el pedido como PAID en cualquier momento; 10 s basta para que
    // la pantalla lo refleje sin martillar el API cada 3 s.
    refetchInterval: (query) => (query.state.data?.status === "AWAITING_PAYMENT" ? 10_000 : false),
  });

  const order = orderQ.data;
  const remainingMs = useCountdown(order && PAYABLE.includes(order.status) ? order.expiresAt : null);
  const expired = remainingMs === 0;

  async function startCheckout() {
    if (paying) return;
    setPaying(true);
    try {
      const res = await api.post(`/orders/public/${token}/checkout`);
      const data = res.data.data;
      window.location.href = data.checkoutUrl;
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const message = (err as { response?: { data?: { error?: { message?: string }; message?: string } } })
        ?.response?.data;
      const detail = message?.error?.message ?? message?.message;
      if (status === 404) toast.error("Este link de pago ya no es válido. Pide uno nuevo al vendedor.");
      else if (status === 400) toast.error(detail ?? "Este pedido ya no acepta pagos.");
      else if (status === 429) toast.error("Demasiados intentos seguidos. Espera un momento y vuelve a intentar.");
      else toast.error("No pudimos abrir la pasarela de pago. Inténtalo de nuevo en unos segundos.");
      setPaying(false);
    }
  }

  // --- 1. Cargando -----------------------------------------------------------
  if (orderQ.isLoading) {
    return (
      <PublicShell>
        <BrandMark />
        <SkeletonRegion
          label="Cargando el cobro…"
          className="overflow-hidden rounded-card border bg-card shadow-airbnb"
        >
          <div className="space-y-3 border-b p-6 text-center">
            <Skeleton className="mx-auto h-3 w-24" />
            <Skeleton className="mx-auto h-10 w-44" />
            <Skeleton className="mx-auto h-5 w-28 rounded-pill" />
          </div>
          <div className="space-y-3 p-6">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </SkeletonRegion>
        <TrustLine />
      </PublicShell>
    );
  }

  // --- 2. Error / link inválido ---------------------------------------------
  if (orderQ.isError || !order) {
    return (
      <PublicShell>
        <BrandMark />
        <Alert variant="warning">
          <AlertTriangle aria-hidden />
          <AlertTitle>Este enlace de pago ya no sirve</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              El link es inválido, ya se usó o venció. Pide al vendedor que te genere uno nuevo;
              no hagas ningún pago por otra vía.
            </p>
            <Button
              variant="outline"
              size="sm"
              loading={orderQ.isFetching}
              onClick={() => void orderQ.refetch()}
            >
              <RefreshCw aria-hidden className="h-3.5 w-3.5" />
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
        <TrustLine />
      </PublicShell>
    );
  }

  // --- 3. Estado del pedido --------------------------------------------------
  const effectiveStatus = expired && PAYABLE.includes(order.status) ? "EXPIRED" : order.status;
  const payable = PAYABLE.includes(order.status) && !expired;
  const isExpired = order.status === "EXPIRED" || (expired && PAYABLE.includes(order.status));

  return (
    <PublicShell>
      <header className="flex flex-col items-center gap-2 text-center">
        <BrandMark merchant={order.merchant} />
        <h1 className="text-xl font-semibold tracking-tight">Pago del pedido</h1>
        <p className="text-sm text-muted-foreground">{order.customer.fullName}</p>
      </header>

      <div className="overflow-hidden rounded-card border bg-card shadow-airbnb">
        {/* Jerarquía: el total y la acción van juntos y arriba de todo, para que
            en un teléfono de 360px se vean sin hacer scroll. */}
        <div className="space-y-3 border-b p-6 text-center">
          <p className="text-sm text-muted-foreground">Total a pagar</p>
          <Money
            value={order.total}
            emphasis
            className="block text-4xl leading-none tracking-tight"
          />
          <div>
            <StatusBadge status={effectiveStatus} domain="order" withDot />
          </div>
        </div>

        <div className="border-b p-5 sm:p-6">
          {/* 3a. Pagable */}
          {payable && (
            <>
              <Button
                className="h-12 w-full text-base"
                size="lg"
                onClick={() => void startCheckout()}
                loading={paying}
              >
                {paying ? "Redirigiendo…" : "Pagar ahora"}
              </Button>
              {remainingMs !== null && (
                <p
                  className={cn(
                    "mt-3 flex items-center justify-center gap-1.5 text-xs",
                    remainingMs < 60_000 ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  <Clock aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Este cobro expira en{" "}
                    <span className="tabular-nums">{formatCountdown(remainingMs)}</span>
                  </span>
                </p>
              )}
              <p
                className="mt-2 text-center text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                {order.status === "AWAITING_PAYMENT"
                  ? "Ya abriste la pasarela. Esta página se actualiza sola en cuanto se confirme el pago."
                  : "Te llevaremos a una pasarela segura para pagar con tarjeta, transferencia SPEI o efectivo."}
              </p>
            </>
          )}

          {/* 3b. Pagado */}
          {order.status === "PAID" && (
            <div className="space-y-1 text-center">
              <CheckCircle2 aria-hidden className="mx-auto h-10 w-10 text-success" />
              <p className="text-base font-semibold">¡Pago confirmado!</p>
              <p className="text-sm text-muted-foreground">
                Ya no tienes que hacer nada. Puedes cerrar esta ventana.
              </p>
            </div>
          )}

          {/* 3c. Vencido */}
          {isExpired && (
            <div className="space-y-1 text-center">
              <Clock aria-hidden className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="text-base font-semibold">El link de pago venció</p>
              <p className="text-sm text-muted-foreground">
                Pide al vendedor un link nuevo. El pedido sigue registrado, solo caducó el enlace.
              </p>
            </div>
          )}

          {/* 3d. Cancelado */}
          {order.status === "CANCELLED" && (
            <div className="space-y-1 text-center">
              <XCircle aria-hidden className="mx-auto h-10 w-10 text-destructive" />
              <p className="text-base font-semibold">Pedido cancelado</p>
              <p className="text-sm text-muted-foreground">
                Este pedido ya no acepta pagos. Si crees que es un error, contacta al vendedor.
              </p>
            </div>
          )}
        </div>

        {order.lines.length > 0 && (
          <div className="space-y-2 border-b p-5 sm:p-6">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Qué estás pagando
              <span className="ml-2 normal-case tracking-normal">· toca un producto para ver su detalle</span>
            </h2>
            <ul className="-mx-2 divide-y">
              {order.lines.map((l) => (
                <li key={l.variantId}>
                  <button
                    type="button"
                    onClick={() => setDetailLine(l)}
                    aria-label={`Ver detalle de ${l.title}`}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                  >
                    <span className="min-w-0">
                      <span className="block break-words font-medium">
                        {l.product?.title && l.product.title !== l.title
                          ? `${l.product.title} — ${l.title}`
                          : l.title}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        <span className="font-mono">{l.sku}</span>
                        <span aria-hidden> · </span>
                        <span className="tabular-nums">× {l.quantity}</span>
                        {l.unitPrice ? (
                          <>
                            <span aria-hidden> · </span>
                            <Money value={l.unitPrice} /> c/u
                          </>
                        ) : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {l.lineTotal ? (
                        <Money value={l.lineTotal} className="tabular-nums text-sm" />
                      ) : null}
                      <ChevronRight aria-hidden className="h-4 w-4 text-muted-foreground" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="p-5 sm:p-6">
          <h2 className="sr-only">Desglose del importe</h2>
          <DescriptionList>
            <FieldRow label="Subtotal" numeric>
              <Money value={order.subtotal} />
            </FieldRow>
            <FieldRow label="Descuento" numeric>
              <Money value={order.discount} />
            </FieldRow>
            <FieldRow label="IVA" numeric>
              <Money value={order.tax} />
            </FieldRow>
            <FieldRow label="Envío" numeric>
              <Money value={order.shipping} />
            </FieldRow>
            <FieldRow label="Total" numeric emphasis>
              <Money value={order.total} showCurrency />
            </FieldRow>
            {order.expiresAt ? (
              <FieldRow label="Vence">
                <DateTime value={order.expiresAt} className="text-muted-foreground" />
              </FieldRow>
            ) : null}
          </DescriptionList>
        </div>
      </div>

      <TrustLine />
      <BillingSection />
      <ProductDetailSheet
        product={detailLine ? productFor(detailLine) : null}
        open={detailLine !== null}
        onOpenChange={(open) => !open && setDetailLine(null)}
      />
    </PublicShell>
  );
}
