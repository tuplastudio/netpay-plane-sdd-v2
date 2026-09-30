"use client";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Link2,
  MapPin,
  MessageCircle,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Share2,
  ShieldCheck,
  Sparkles,
  Store,
  Truck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { StatusBadge, DELIVERY_MODE_LABELS } from "@/components/ui/status-badge";
import { Money } from "@/components/app/money";
import { DateTime } from "@/components/app/date-time";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { DetailLinesTable } from "@/components/app/detail-lines-table";
import { onTenantColor } from "@/lib/hex-to-hsl";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------------ */
/* Contrato del API público (GET /orders/public/track/:token)               */
/* ------------------------------------------------------------------------ */

interface TrackingLine {
  key: string;
  sku: string | null;
  title: string;
  quantity: string;
  unitPrice: string | null;
  lineTotal: string | null;
}

interface TrackingView {
  folio: string;
  status: string;
  source: string;
  currency: string;
  livemode: boolean;
  subtotal: string;
  discount: string;
  tax: string;
  shipping: string;
  total: string;
  merchant: { name: string; logoUrl: string | null; primaryColor: string | null };
  customer: { fullName: string };
  lines: TrackingLine[];
  delivery: {
    mode: "PICKUP" | "LOCAL_DELIVERY" | (string & {});
    address: {
      label: string;
      line1: string;
      line2: string | null;
      city: string;
      state: string;
      postalCode: string;
    } | null;
  } | null;
  payment: {
    lastStatus: "PENDING" | "CAPTURED" | "FAILED" | null;
    method: string | null;
    capturedAt: string | null;
    refundedTotal: string;
    checkoutToken: string | null;
    checkoutExpiresAt: string | null;
  };
  timeline: {
    createdAt: string;
    placedAt: string | null;
    paidAt: string | null;
    fulfilledAt: string | null;
    cancelledAt: string | null;
    updatedAt: string;
  };
  whatsappNumber: string | null;
  checkoutUrl: string | null;
}

async function fetchTracking(token: string): Promise<TrackingView> {
  const res = await fetch(`/api/v1/orders/public/track/${encodeURIComponent(token)}`, {
    credentials: "omit",
  });
  if (!res.ok) {
    throw new Error(res.status === 404 ? "Link inválido" : "Error al cargar");
  }
  const json = await res.json();
  return json.data as TrackingView;
}

/** Estados en los que ya no va a pasar nada más: sin polling. */
const TERMINAL = new Set(["FULFILLED", "CANCELLED", "EXPIRED", "REFUNDED"]);
const PAYABLE = new Set(["CHECKOUT_OPEN", "AWAITING_PAYMENT"]);

const METHOD_LABELS: Record<string, string> = {
  CARD: "Tarjeta",
  SPEI: "Transferencia SPEI",
  OXXO: "Efectivo OXXO",
};

/* ------------------------------------------------------------------------ */
/* Página                                                                    */
/* ------------------------------------------------------------------------ */

export default function PublicOrderTrackingPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const q = useQuery({
    queryKey: ["public-order-tracking", token],
    queryFn: () => fetchTracking(token),
    retry: false,
    staleTime: 15_000,
    // Se actualiza sola cada 30 s mientras el pedido siga vivo: el cliente
    // deja la pestaña abierta esperando "pagado" o "entregado".
    refetchInterval: (query) => {
      if (query.state.error) return false;
      const status = query.state.data?.status;
      return status && TERMINAL.has(status) ? false : 30_000;
    },
    refetchIntervalInBackground: false,
  });

  const merchant = q.data?.merchant ?? null;
  const brandColor = merchant?.primaryColor ?? null;

  return (
    <div
      className="min-h-screen bg-background"
      // Color de marca del comercio: dato del tenant, no un hex fijo en el
      // TSX (misma excepción que `branding-section.tsx`).
      style={brandColor ? ({ "--tenant-brand": brandColor } as React.CSSProperties) : undefined}
    >
      {brandColor ? <div aria-hidden className="h-1 w-full bg-[var(--tenant-brand)]" /> : null}
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-4">
          {/* Marca, no navegación: la abre un cliente final sin cuenta, y `/`
              redirige a `/login` a quien no trae sesión. */}
          {merchant ? (
            <MerchantBrand merchant={merchant} />
          ) : (
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-strong text-primary-foreground"
              >
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold">Easy Sell</span>
            </span>
          )}
          <div className="flex items-center gap-1">
            <span className="hidden text-xs text-muted-foreground sm:inline">Seguimiento de pedido</span>
            <ShareButton folio={q.data?.folio ?? null} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError || !q.data ? (
          <ErrorState onRetry={() => void q.refetch()} retrying={q.isFetching} />
        ) : (
          <TrackingView tracking={q.data} refreshing={q.isFetching} onRefresh={() => void q.refetch()} />
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Estados de carga / error                                                  */
/* ------------------------------------------------------------------------ */

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
      <div className="space-y-3 rounded-card border bg-card p-5 shadow-airbnb">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-full" />
      </div>
    </SkeletonRegion>
  );
}

function ErrorState({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <Alert variant="warning">
      <AlertTriangle aria-hidden />
      <AlertTitle>Este link no está disponible</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>El link es inválido o está incompleto. Pide a tu asesor que te lo comparta de nuevo.</p>
        <Button variant="outline" size="sm" loading={retrying} onClick={onRetry}>
          <RefreshCw aria-hidden className="h-3.5 w-3.5" />
          Reintentar
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/* ------------------------------------------------------------------------ */
/* Marca y compartir                                                         */
/* ------------------------------------------------------------------------ */

function MerchantBrand({ merchant }: { merchant: TrackingView["merchant"] }) {
  const [broken, setBroken] = useState(false);
  const showLogo = !!merchant.logoUrl && !broken;
  const initial = merchant.name.trim().charAt(0).toUpperCase() || "?";
  const color = merchant.primaryColor;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- origen externo (API del comercio), sin optimizador
        <img
          src={merchant.logoUrl ?? undefined}
          alt={`Logo de ${merchant.name}`}
          className="max-h-10 w-auto max-w-[8rem] object-contain"
          onError={() => setBroken(true)}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
            color ? "bg-[var(--tenant-brand)]" : "bg-secondary",
          )}
          style={color ? { color: onTenantColor(color) } : undefined}
        >
          {initial}
        </span>
      )}
      <span className="truncate text-sm font-semibold">{merchant.name}</span>
    </div>
  );
}

/** Compartir (Web Share API en móvil) o copiar el link al portapapeles. */
function ShareButton({ folio }: { folio: string | null }) {
  const [copied, setCopied] = useState(false);
  // Se decide tras montar: en SSR no hay `navigator`, y leerlo durante el
  // render produce un HTML distinto al del cliente (hydration mismatch).
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setCanShare(typeof navigator.share === "function");
  }, []);
  return (
    <button
      type="button"
      onClick={async () => {
        const url = window.location.href;
        try {
          if (canShare) {
            await navigator.share({ title: folio ? `Pedido ${folio}` : "Mi pedido", url });
            return;
          }
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Compartir cancelado o clipboard bloqueado: el link sigue en la
          // barra del navegador, no hace falta más feedback.
        }
      }}
      aria-label={canShare ? "Compartir link de seguimiento" : "Copiar link de seguimiento"}
      className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8"
    >
      {copied ? (
        <Check aria-hidden className="h-4 w-4 text-success" />
      ) : canShare ? (
        <Share2 aria-hidden className="h-4 w-4" />
      ) : (
        <Link2 aria-hidden className="h-4 w-4" />
      )}
    </button>
  );
}

/* ------------------------------------------------------------------------ */
/* Lógica de presentación del estado                                        */
/* ------------------------------------------------------------------------ */

function headline(t: TrackingView): { title: string; hint: string } {
  const pickup = t.delivery?.mode !== "LOCAL_DELIVERY";
  switch (t.status) {
    case "DRAFT":
      return { title: "Recibimos tu pedido", hint: "Tu asesor lo está confirmando. Te avisamos cuando puedas pagarlo." };
    case "CHECKOUT_OPEN":
    case "AWAITING_PAYMENT":
      return t.payment.lastStatus === "FAILED"
        ? { title: "El pago no se completó", hint: "Puedes intentarlo de nuevo con el botón de abajo." }
        : { title: "Pendiente de pago", hint: "En cuanto se confirme el pago empezamos a prepararlo." };
    case "PAID":
      return {
        title: pickup ? "Pagado · preparando tu pedido" : "Pagado · preparando tu envío",
        hint: pickup ? "Te avisamos cuando esté listo para recoger." : "Te avisamos cuando salga en camino.",
      };
    case "FULFILLED":
      return { title: "Entregado", hint: "Gracias por tu compra." };
    case "CANCELLED":
      return { title: "Pedido cancelado", hint: "Si tienes dudas, escríbenos por WhatsApp." };
    case "EXPIRED":
      return { title: "El link de pago venció", hint: "Pide a tu asesor uno nuevo para retomar el pedido." };
    case "REFUNDED":
      return { title: "Reembolsado", hint: "El cobro se devolvió por completo." };
    default:
      return { title: "En proceso", hint: "" };
  }
}

type StepState = "done" | "current" | "pending";

interface Step {
  key: string;
  label: string;
  hint: string | null;
  at: string | null;
  state: StepState;
}

function buildSteps(t: TrackingView): Step[] {
  const pickup = t.delivery?.mode !== "LOCAL_DELIVERY";
  const paid = !!t.timeline.paidAt;
  const fulfilled = !!t.timeline.fulfilledAt;
  const payable = PAYABLE.has(t.status);
  const preparing = t.status === "PAID";
  return [
    {
      key: "received",
      label: "Recibido",
      hint: null,
      at: t.timeline.createdAt,
      state: "done",
    },
    {
      key: "paid",
      label: "Pagado",
      hint: payable ? "Esperando la confirmación del pago" : null,
      at: t.timeline.paidAt,
      state: paid ? "done" : payable || t.status === "DRAFT" ? "current" : "pending",
    },
    {
      key: "preparing",
      label: "En preparación",
      hint: preparing
        ? pickup
          ? "Te avisamos cuando esté listo para recoger"
          : "Te avisamos cuando salga en camino"
        : null,
      at: null,
      state: fulfilled ? "done" : preparing ? "current" : "pending",
    },
    {
      key: "delivered",
      label: pickup ? "Entregado en tienda" : "Entregado a domicilio",
      hint: null,
      at: t.timeline.fulfilledAt,
      state: fulfilled ? "done" : "pending",
    },
  ];
}

/* ------------------------------------------------------------------------ */
/* Vista                                                                     */
/* ------------------------------------------------------------------------ */

function TrackingView({
  tracking: t,
  refreshing,
  onRefresh,
}: {
  tracking: TrackingView;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const head = headline(t);
  const cancelled = t.status === "CANCELLED";
  const expired = t.status === "EXPIRED";
  const refunded = t.status === "REFUNDED";
  const partialRefund = !refunded && Number(t.payment.refundedTotal) > 0;
  const payable = PAYABLE.has(t.status) && !!t.checkoutUrl;
  const steps = buildSteps(t);
  const waHref = whatsappHref(t.whatsappNumber, t.folio);
  const isTerminal = TERMINAL.has(t.status);

  return (
    <article className={cn("space-y-5", payable && "pb-24 sm:pb-0")}>
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Pedido</p>
        <h1 className="font-display text-display-md">{head.title}</h1>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>
            Folio <span className="font-mono">{t.folio}</span>
          </span>
          <span aria-hidden>·</span>
          <span>{t.customer.fullName}</span>
          <StatusBadge status={t.status} domain="order" size="sm" withDot />
        </p>
      </header>

      {cancelled ? (
        <Alert variant="destructive">
          <XCircle aria-hidden />
          <AlertTitle>Pedido cancelado</AlertTitle>
          <AlertDescription>
            Este pedido fue cancelado <DateTime value={t.timeline.cancelledAt} />. Si ya habías pagado, el
            negocio te reembolsa.
          </AlertDescription>
        </Alert>
      ) : null}
      {expired ? (
        <Alert variant="warning">
          <Clock aria-hidden />
          <AlertTitle>El link de pago venció</AlertTitle>
          <AlertDescription>
            El pedido no se pagó a tiempo y la reserva se liberó. Pide a tu asesor un link nuevo.
          </AlertDescription>
        </Alert>
      ) : null}
      {refunded ? (
        <Alert variant="warning">
          <RotateCcw aria-hidden />
          <AlertTitle>Reembolso aplicado</AlertTitle>
          <AlertDescription>
            Se devolvió <Money value={t.payment.refundedTotal} currency={t.currency} /> a tu método de pago.
            Puede tardar unos días en reflejarse.
          </AlertDescription>
        </Alert>
      ) : null}
      {partialRefund ? (
        <Alert variant="info">
          <RotateCcw aria-hidden />
          <AlertTitle>Reembolso parcial</AlertTitle>
          <AlertDescription>
            Se devolvió <Money value={t.payment.refundedTotal} currency={t.currency} /> del total cobrado.
          </AlertDescription>
        </Alert>
      ) : null}
      {t.payment.lastStatus === "FAILED" && PAYABLE.has(t.status) ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>El último intento de pago fue rechazado</AlertTitle>
          <AlertDescription>No se hizo ningún cargo. Puedes intentarlo de nuevo.</AlertDescription>
        </Alert>
      ) : null}

      {/* Total y acción principal arriba de todo: en móvil es lo primero que se busca. */}
      <section aria-labelledby="track-total" className="rounded-card border bg-card p-5 text-center shadow-airbnb sm:p-6">
        <h2 id="track-total" className="text-sm text-muted-foreground">
          {t.timeline.paidAt ? "Total pagado" : "Total del pedido"}
        </h2>
        <Money
          value={t.total}
          currency={t.currency}
          emphasis
          className="mt-2 block font-display text-display-md leading-none"
        />
        {head.hint ? <p className="mt-3 text-sm text-muted-foreground">{head.hint}</p> : null}
        {payable ? (
          <div className="mt-4 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
            <PayNowButton href={t.checkoutUrl!} />
          </div>
        ) : null}
        {payable && t.payment.checkoutExpiresAt ? (
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Clock aria-hidden className="h-3.5 w-3.5" />
            El link de pago vence <DateTime value={t.payment.checkoutExpiresAt} />
          </p>
        ) : null}
      </section>

      {!cancelled && !expired ? (
        <section aria-labelledby="track-steps" className="rounded-card border bg-card p-5 shadow-airbnb sm:p-6">
          <h2 id="track-steps" className="mb-4 text-sm font-semibold">
            Seguimiento
          </h2>
          <Stepper steps={steps} />
        </section>
      ) : null}

      <section aria-labelledby="track-delivery" className="rounded-card border bg-card p-5 shadow-airbnb sm:p-6">
        <h2 id="track-delivery" className="mb-3 flex items-center gap-2 text-sm font-semibold">
          {t.delivery?.mode === "LOCAL_DELIVERY" ? (
            <Truck aria-hidden className="h-4 w-4" />
          ) : (
            <Store aria-hidden className="h-4 w-4" />
          )}
          Entrega
        </h2>
        {t.delivery ? (
          <DescriptionList divided>
            <FieldRow label="Modalidad">
              {DELIVERY_MODE_LABELS[t.delivery.mode] ?? t.delivery.mode}
            </FieldRow>
            {t.delivery.mode === "LOCAL_DELIVERY" ? (
              <FieldRow label="Dirección">
                {t.delivery.address ? (
                  <span className="inline-flex items-start gap-1.5">
                    <MapPin aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>
                      {t.delivery.address.line1}
                      {t.delivery.address.line2 ? `, ${t.delivery.address.line2}` : ""}
                      <br />
                      <span className="text-muted-foreground">
                        {t.delivery.address.city}, {t.delivery.address.state} · CP {t.delivery.address.postalCode}
                      </span>
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Tu asesor confirma la dirección contigo.</span>
                )}
              </FieldRow>
            ) : (
              <FieldRow label="Dónde">
                <span>
                  Recoges en {t.merchant.name}.{" "}
                  <span className="text-muted-foreground">Te avisamos cuando esté listo.</span>
                </span>
              </FieldRow>
            )}
          </DescriptionList>
        ) : (
          <p className="text-sm text-muted-foreground">
            La forma de entrega se define al confirmar el pedido.
          </p>
        )}
      </section>

      <section aria-labelledby="track-lines" className="overflow-hidden rounded-card border bg-card shadow-airbnb">
        <h2 id="track-lines" className="flex items-center gap-2 px-5 pt-5 text-sm font-semibold sm:px-6 sm:pt-6">
          <PackageCheck aria-hidden className="h-4 w-4" />
          Lo que llevas
          {t.lines.length > 0 ? (
            <span className="text-xs font-normal text-muted-foreground">
              ({t.lines.length} {t.lines.length === 1 ? "artículo" : "artículos"})
            </span>
          ) : null}
        </h2>
        {t.lines.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground sm:px-6">
            Las líneas se registran al confirmar el pedido.
          </p>
        ) : t.lines.every((l) => l.unitPrice && l.lineTotal) ? (
          <div className="mt-3 px-1 sm:px-2">
            <DetailLinesTable
              lines={t.lines.map((l) => ({
                key: l.key,
                variantId: l.key,
                sku: l.sku ?? "—",
                title: l.title,
                quantity: l.quantity,
                unitPrice: l.unitPrice!,
                lineSubtotal: l.lineTotal!,
              }))}
              total={t.total}
              currency={t.currency}
              showDiscount={false}
              footerLabel="Total"
              interactiveDetail={false}
            />
          </div>
        ) : (
          <ul className="mt-3 divide-y">
            {t.lines.map((l) => (
              <li key={l.key} className="flex items-center justify-between gap-3 px-5 py-3 text-sm sm:px-6">
                <span className="min-w-0 truncate">{l.title}</span>
                <span className="shrink-0 text-muted-foreground">x{l.quantity}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t p-5 sm:p-6">
          <h3 className="sr-only">Desglose</h3>
          <DescriptionList className="sm:ml-auto sm:max-w-sm">
            {Number(t.discount) > 0 ? (
              <FieldRow label="Descuento" numeric>
                <Money value={t.discount} currency={t.currency} />
              </FieldRow>
            ) : null}
            <FieldRow label="Subtotal" numeric>
              <Money value={t.subtotal} currency={t.currency} />
            </FieldRow>
            <FieldRow label="IVA" numeric>
              <Money value={t.tax} currency={t.currency} />
            </FieldRow>
            {Number(t.shipping) > 0 ? (
              <FieldRow label="Envío" numeric>
                <Money value={t.shipping} currency={t.currency} />
              </FieldRow>
            ) : null}
            <FieldRow label="Total" numeric emphasis>
              <Money value={t.total} currency={t.currency} showCurrency />
            </FieldRow>
          </DescriptionList>
        </div>
      </section>

      <section aria-labelledby="track-payment" className="rounded-card border bg-card p-5 shadow-airbnb sm:p-6">
        <h2 id="track-payment" className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <CreditCard aria-hidden className="h-4 w-4" />
          Pago
        </h2>
        <DescriptionList divided>
          <FieldRow label="Estado">
            <PaymentStatus tracking={t} />
          </FieldRow>
          {t.payment.method ? (
            <FieldRow label="Método">{METHOD_LABELS[t.payment.method] ?? t.payment.method}</FieldRow>
          ) : null}
          {t.payment.capturedAt ? (
            <FieldRow label="Pagado el">
              <DateTime value={t.payment.capturedAt} />
            </FieldRow>
          ) : null}
          {Number(t.payment.refundedTotal) > 0 ? (
            <FieldRow label="Reembolsado" numeric>
              <Money value={t.payment.refundedTotal} currency={t.currency} />
            </FieldRow>
          ) : null}
        </DescriptionList>
      </section>

      {waHref ? (
        <section aria-labelledby="track-contact" className="rounded-card border bg-card p-5 shadow-airbnb sm:p-6">
          <h2 id="track-contact" className="mb-1 text-sm font-semibold">
            ¿Dudas con tu pedido?
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Escríbenos por WhatsApp; ya conocemos tu folio.
          </p>
          <Button asChild variant="outline" className="h-11 w-full sm:w-auto">
            <a href={waHref} target="_blank" rel="noreferrer">
              <MessageCircle aria-hidden className="h-4 w-4" />
              Escribir a {t.merchant.name}
            </a>
          </Button>
        </section>
      ) : null}

      <footer className="space-y-2 text-center text-xs text-muted-foreground">
        <p className="flex flex-wrap items-center justify-center gap-1.5">
          <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
          Seguimiento con Easy Sell
          {t.livemode === false ? " · modo de pruebas" : ""}
        </p>
        <p className="flex flex-wrap items-center justify-center gap-1.5">
          Actualizado <DateTime value={t.timeline.updatedAt} />
          {isTerminal ? null : (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                className="inline-flex items-center gap-1 underline-offset-4 hover:underline disabled:opacity-60"
              >
                <RefreshCw aria-hidden className={cn("h-3 w-3", refreshing && "animate-spin")} />
                {refreshing ? "Actualizando…" : "Actualizar"}
              </button>
            </>
          )}
        </p>
      </footer>

      {payable ? <StickyPayBar tracking={t} /> : null}
    </article>
  );
}

function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="relative space-y-0">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
            {!last ? (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[11px] top-6 h-[calc(100%-0.75rem)] w-0.5",
                  step.state === "done" ? "bg-success" : "bg-border",
                )}
              />
            ) : null}
            <span
              aria-hidden
              className={cn(
                "relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
                step.state === "done" && "border-success bg-success-subtle text-success-foreground",
                step.state === "current" && "border-brand bg-background text-brand-text",
                step.state === "pending" && "border-border bg-background text-muted-foreground",
              )}
            >
              {step.state === "done" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : step.state === "current" ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-border" />
              )}
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  "text-sm",
                  step.state === "done" && "font-medium",
                  step.state === "current" && "font-semibold",
                  step.state === "pending" && "text-muted-foreground",
                )}
                aria-current={step.state === "current" ? "step" : undefined}
              >
                {step.label}
                {step.state === "current" ? <span className="sr-only"> (paso actual)</span> : null}
              </p>
              {step.at ? (
                <p className="text-xs text-muted-foreground">
                  <DateTime value={step.at} />
                </p>
              ) : step.hint ? (
                <p className="text-xs text-muted-foreground">{step.hint}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PaymentStatus({ tracking: t }: { tracking: TrackingView }) {
  if (t.status === "REFUNDED") return <StatusBadge status="REFUNDED" domain="payment" withDot />;
  if (Number(t.payment.refundedTotal) > 0) {
    return <StatusBadge status="PARTIALLY_REFUNDED" domain="payment" withDot />;
  }
  if (t.timeline.paidAt || t.payment.lastStatus === "CAPTURED") {
    return <StatusBadge status="CAPTURED" domain="payment" label="Pagado" withDot />;
  }
  if (t.payment.lastStatus === "FAILED") return <StatusBadge status="FAILED" domain="payment" withDot />;
  if (t.status === "CANCELLED" || t.status === "EXPIRED") {
    return <StatusBadge status="CANCELLED" domain="payment" label="Sin cobro" withDot />;
  }
  return <StatusBadge status="PENDING" domain="payment" label="Pendiente de pago" withDot />;
}

function PayNowButton({ href, compact = false }: { href: string; compact?: boolean }) {
  return (
    <Button asChild size="lg" variant="accent" className={compact ? "h-11 shrink-0 px-6" : "h-12 w-full sm:w-auto sm:px-8"}>
      <a href={href}>
        <CreditCard aria-hidden className="h-4 w-4" />
        Pagar ahora
      </a>
    </Button>
  );
}

/**
 * Barra fija al fondo, solo en móvil: con muchas líneas el botón de pagar
 * (arriba) queda lejos del scroll. `pb-24` en el artículo le deja espacio.
 */
function StickyPayBar({ tracking: t }: { tracking: TrackingView }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 p-3 shadow-airbnb-lg backdrop-blur sm:hidden">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption text-muted-foreground">Total</p>
          <Money value={t.total} currency={t.currency} showCurrency emphasis className="text-lg leading-none" />
        </div>
        <PayNowButton href={t.checkoutUrl!} compact />
      </div>
    </div>
  );
}

/** `https://wa.me/<dígitos>?text=…` o null si el número no parece válido. */
function whatsappHref(raw: string | null | undefined, folio: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const text = encodeURIComponent(`Hola, tengo una duda sobre mi pedido ${folio}.`);
  return `https://wa.me/${digits}?text=${text}`;
}
