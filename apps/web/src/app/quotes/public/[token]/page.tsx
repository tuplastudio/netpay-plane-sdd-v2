"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  FileText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { EntityId } from "@/components/app/entity-id";
import { Money } from "@/components/app/money";
import { DateTime } from "@/components/app/date-time";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { DetailLinesTable } from "@/components/app/detail-lines-table";

interface QuotePublic {
  id: string;
  status: string;
  total: string;
  subtotal: string;
  taxBase: string;
  tax: string;
  shipping: string;
  discount: string;
  currency: string;
  expiresAt: string;
  notes: string | null;
  customer: { fullName: string; email: string | null };
  /** Empresa que emite: nombre y logo (si subió uno) para el encabezado. */
  merchant: { name: string; logoUrl: string | null } | null;
  lines: Array<{
    id: string;
    sku: string;
    title: string;
    quantity: string;
    unitPrice: string;
    lineSubtotal: string;
  }>;
  /** Pedido generado por esta cotización, si ya existe. */
  order: { id: string; status: string } | null;
  /** Link de pago vigente (checkout abierto y sin vencer), si lo hay. */
  checkoutToken: string | null;
}

const PAID_STATUSES = new Set(["PAID", "FULFILLED"]);
const CLOSED_ORDER_STATUSES = new Set(["CANCELLED", "EXPIRED", "REFUNDED"]);

async function fetchPublicQuote(token: string): Promise<QuotePublic> {
  const res = await fetch(`/api/v1/quotes/public/${token}`, { credentials: "omit" });
  if (!res.ok) {
    throw new Error(res.status === 404 ? "Link inválido" : "Error al cargar");
  }
  const json = await res.json();
  return json.data as QuotePublic;
}

export default function PublicQuotePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const q = useQuery({
    queryKey: ["public-quote", token],
    queryFn: () => fetchPublicQuote(token),
    retry: false,
    staleTime: 60_000,
  });

  const merchant = q.data?.merchant ?? null;

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-4">
          {merchant ? (
            <MerchantBrand merchant={merchant} />
          ) : (
            // Marca, no navegación: esta página la abre un cliente final sin
            // cuenta. Enlazar a `/` lo mandaba al middleware, que redirige a
            // `/login` a quien no trae sesión — parecía que la cotización
            // pedía iniciar sesión.
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
              >
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold">Easy Sell</span>
            </span>
          )}
          <span className="text-xs text-muted-foreground">Documento comercial</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError || !q.data ? (
          <ErrorState onRetry={() => void q.refetch()} retrying={q.isFetching} />
        ) : (
          <QuoteView quote={q.data} token={token} />
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Documento comercial emitido por el comercio. No constituye CFDI.
        </p>
      </main>
    </div>
  );
}

function LoadingState() {
  return (
    <SkeletonRegion label="Cargando la cotización…" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-5 w-24 rounded-pill" />
      </div>
      <div className="space-y-3 rounded-card border bg-card p-5 shadow-airbnb">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-4 h-8 w-40 self-end" />
      </div>
      <Skeleton className="h-12 w-full" />
    </SkeletonRegion>
  );
}

function ErrorState({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <Alert variant="warning">
      <AlertTriangle aria-hidden />
      <AlertTitle>Este link ya no está disponible</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          El link es inválido, ya venció o la cotización fue revocada. Pide a tu asesor que te
          comparta uno nuevo.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" loading={retrying} onClick={onRetry}>
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
            Reintentar
          </Button>

        </div>
      </AlertDescription>
    </Alert>
  );
}

/** Aviso de estado terminal: aceptada, vencida o cancelada. */
function TerminalNotice({
  status,
  expired,
  paid,
}: {
  status: string;
  expired: boolean;
  paid: boolean;
}) {
  if (status === "ACCEPTED") {
    return (
      <Alert variant="success">
        <CheckCircle2 aria-hidden />
        <AlertTitle>{paid ? "Cotización pagada" : "Cotización aceptada"}</AlertTitle>
        <AlertDescription>
          {paid
            ? "El pago quedó registrado. Tu asesor te confirma la entrega."
            : "Ya quedó aceptada. Puedes pagarla desde aquí con el botón de abajo."}
        </AlertDescription>
      </Alert>
    );
  }
  if (status === "CANCELLED") {
    return (
      <Alert variant="destructive">
        <AlertTriangle aria-hidden />
        <AlertTitle>Cotización cancelada</AlertTitle>
        <AlertDescription>
          Esta cotización fue cancelada por el comercio y ya no se puede aceptar.
        </AlertDescription>
      </Alert>
    );
  }
  if (status === "EXPIRED" || expired) {
    return (
      <Alert variant="warning">
        <Clock aria-hidden />
        <AlertTitle>Esta cotización venció</AlertTitle>
        <AlertDescription>
          Los precios ya no están garantizados. Pide a tu asesor una cotización nueva.
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

/**
 * Botón de pago del link público. Si el checkout ya está abierto lleva
 * directo al link vigente; si no, lo abre (acepta la cotización, crea el
 * pedido y reserva stock) y redirige al checkout recién emitido.
 */
function PayButton({ token, checkoutToken }: { token: string; checkoutToken: string | null }) {
  const open = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/orders/public/quote/${token}/checkout`, {
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json" },
      });
      const json = (await res.json().catch(() => null)) as
        | { data?: { checkoutToken: string }; message?: string; error?: { message?: string } }
        | null;
      if (!res.ok || !json?.data?.checkoutToken) {
        throw new Error(
          json?.error?.message ?? json?.message ?? "No se pudo abrir el pago. Intenta de nuevo.",
        );
      }
      return json.data.checkoutToken;
    },
    onSuccess: (checkout) => {
      window.location.assign(`/checkout/${checkout}`);
    },
  });

  if (checkoutToken) {
    return (
      <Button asChild size="lg" className="h-12 w-full sm:w-auto sm:px-8">
        <Link href={`/checkout/${checkoutToken}`}>
          <CreditCard aria-hidden className="h-4 w-4" />
          Pagar ahora
        </Link>
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto">
      <Button
        size="lg"
        className="h-12 w-full sm:w-auto sm:px-8"
        loading={open.isPending}
        onClick={() => open.mutate()}
      >
        <CreditCard aria-hidden className="h-4 w-4" />
        Aceptar y pagar
      </Button>
      {open.isError ? (
        <p role="alert" className="text-xs text-destructive-subtle-foreground">
          {open.error instanceof Error ? open.error.message : "No se pudo abrir el pago."}
        </p>
      ) : null}
    </div>
  );
}

/** Nombre y logo del comercio que emite la cotización. El logo solo se pinta
 * si lo subió (y validó) desde su panel; sin logo queda el nombre solo. */
function MerchantBrand({ merchant }: { merchant: NonNullable<QuotePublic["merchant"]> }) {
  const [broken, setBroken] = useState(false);
  const showLogo = !!merchant.logoUrl && !broken;
  return (
    <div className="flex min-w-0 items-center gap-3">
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- origen externo (API del comercio), sin optimizador
        <img
          src={merchant.logoUrl ?? undefined}
          alt={`Logo de ${merchant.name}`}
          className="max-h-12 w-auto max-w-[10rem] object-contain"
          onError={() => setBroken(true)}
        />
      ) : null}
      <span className="truncate text-sm font-semibold">{merchant.name}</span>
    </div>
  );
}

function QuoteView({ quote, token }: { quote: QuotePublic; token: string }) {
  const expired = new Date(quote.expiresAt).getTime() < Date.now();
  const effectiveStatus = expired && quote.status === "ISSUED" ? "EXPIRED" : quote.status;
  const currency = quote.currency || "MXN";
  const terminal =
    effectiveStatus === "ACCEPTED" ||
    effectiveStatus === "CANCELLED" ||
    effectiveStatus === "EXPIRED";
  const paid = !!quote.order && PAID_STATUSES.has(quote.order.status);
  const orderClosed = !!quote.order && CLOSED_ORDER_STATUSES.has(quote.order.status);
  // Se puede pagar mientras la cotización siga viva (emitida o aceptada, sin
  // vencer) y su pedido, si existe, no esté pagado ni cerrado.
  const payable =
    !paid &&
    !orderClosed &&
    !expired &&
    (effectiveStatus === "ISSUED" || effectiveStatus === "ACCEPTED");

  return (
    <article className="space-y-5">
      <header className="space-y-2">
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="uppercase tracking-wider">Cotización</span>
          <EntityId value={quote.id} toastLabel="Folio de la cotización" />
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {quote.customer.fullName || "Cliente"}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <StatusBadge status={effectiveStatus} domain="quote" withDot />
          {quote.customer.email ? (
            <span className="break-all">{quote.customer.email}</span>
          ) : null}
        </div>
      </header>

      {terminal ? (
        <TerminalNotice status={effectiveStatus} expired={expired} paid={paid} />
      ) : null}

      {/* Total arriba de todo: en un teléfono es el dato que se busca primero. */}
      <section
        aria-labelledby="quote-total"
        className="rounded-card border bg-card p-5 text-center shadow-airbnb sm:p-6"
      >
        <h2 id="quote-total" className="text-sm text-muted-foreground">
          Total de la cotización
        </h2>
        <Money
          value={quote.total}
          currency={currency}
          emphasis
          className="mt-2 block text-4xl leading-none tracking-tight"
        />
        <p className="mt-3 text-xs text-muted-foreground">
          Válida hasta <DateTime value={quote.expiresAt} withTime={false} className="font-medium" />
        </p>
        <div className="mt-4 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
          {payable ? (
            <PayButton token={token} checkoutToken={quote.checkoutToken} />
          ) : null}
          <Button
            asChild
            size="lg"
            variant={payable ? "outline" : "default"}
            className="h-12 w-full sm:w-auto sm:px-8"
          >
            <a href={`/api/v1/quotes/public/${token}/pdf`} target="_blank" rel="noreferrer">
              <Download aria-hidden className="h-4 w-4" />
              Descargar PDF
            </a>
          </Button>
        </div>
        {paid ? (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-success-foreground">
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
            Pagada
          </p>
        ) : payable ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {quote.checkoutToken
              ? "Tu link de pago sigue vigente. Puedes retomarlo cuando quieras."
              : "Al pagar se acepta la cotización con estos conceptos y precios."}
          </p>
        ) : orderClosed ? (
          <p className="mt-3 text-xs text-muted-foreground">
            El pedido de esta cotización se cerró. Pide a tu asesor un link nuevo.
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="quote-lines"
        className="overflow-hidden rounded-card border bg-card shadow-airbnb"
      >
        <h2 id="quote-lines" className="px-5 pt-5 text-base font-semibold sm:px-6 sm:pt-6">
          Conceptos
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            toca una fila para ver el detalle del producto
          </span>
        </h2>

        {quote.lines.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title="Sin conceptos"
            description="Esta cotización no tiene líneas capturadas. Pregunta a tu asesor antes de aprobarla."
          />
        ) : (
          <div className="mt-3 px-1 sm:px-2">
            <DetailLinesTable
              lines={quote.lines.map((l) => ({
                key: l.id,
                variantId: l.id,
                sku: l.sku,
                title: l.title,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                lineSubtotal: l.lineSubtotal,
              }))}
              total={quote.total}
              currency={currency}
              showDiscount={false}
              footerLabel="Total de la cotización"
            />
          </div>
        )}

        <div className="border-t p-5 sm:p-6">
          <h3 className="sr-only">Desglose</h3>
          <DescriptionList className="sm:ml-auto sm:max-w-sm">
            {Number(quote.discount) > 0 ? (
              <FieldRow label="Descuento" numeric>
                <Money value={quote.discount} currency={currency} />
              </FieldRow>
            ) : null}
            <FieldRow label="Subtotal" numeric>
              <Money value={quote.taxBase} currency={currency} />
            </FieldRow>
            <FieldRow label="IVA" numeric>
              <Money value={quote.tax} currency={currency} />
            </FieldRow>
            {Number(quote.shipping) > 0 ? (
              <FieldRow label="Envío" numeric>
                <Money value={quote.shipping} currency={currency} />
              </FieldRow>
            ) : null}
            <FieldRow label="Total" numeric emphasis>
              <Money value={quote.total} currency={currency} showCurrency />
            </FieldRow>
          </DescriptionList>
        </div>

        {quote.notes ? (
          <div className="border-t bg-muted p-5 text-sm sm:p-6">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Notas
            </h3>
            <p className="whitespace-pre-line break-words">{quote.notes}</p>
          </div>
        ) : null}
      </section>
      <footer className="mt-8 flex flex-wrap items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
        Pago seguro con NetPay
      </footer>
    </article>
  );
}
