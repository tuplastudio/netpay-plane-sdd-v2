"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  CheckCircle2,
  Copy,
  Mail,
  PackageSearch,
  Receipt,
  SearchX,
  Share2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SkeletonRegion } from "@/components/ui/skeleton";
import { Money } from "@/components/app/money";

type PublicOrderStatus =
  | "DRAFT"
  | "CHECKOUT_OPEN"
  | "AWAITING_PAYMENT"
  | "PAID"
  | "FULFILLED"
  | "REFUNDED"
  | "EXPIRED"
  | "CANCELLED"
  | (string & {});

/** Estados en los que el pago ya está aplicado: se deja de hacer polling. */
const SETTLED: ReadonlyArray<string> = ["PAID", "FULFILLED"];

interface PublicOrder {
  id: string;
  status: PublicOrderStatus;
  /** `false` en sandbox: muestra el aviso "Modo de pruebas". */
  livemode?: boolean;
  /** true si el pedido tiene un correo al que enviar el recibo (opcional). */
  hasCustomerEmail?: boolean;
  /** Seguimiento durable del pedido (opcional): token o URL completa. */
  trackingToken?: string | null;
  trackingUrl?: string | null;
  subtotal: string;
  discount: string;
  tax: string;
  shipping: string;
  total: string;
  merchant: string;
  customer: { fullName: string; email?: string | null };
  lines: Array<{ variantId: string; sku: string; title: string; quantity: string }>;
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  } catch {
    toast.message(label, { description: text });
  }
}

/**
 * Página de agradecimiento post-pago.
 *
 * Es **opcional** en el flujo: el cliente llega aquí porque la pasarela
 * (de pruebas o real) redirige a `/checkout/{token}/gracias` tras un pago
 * CAPTURED. Si el cliente abre esta URL antes de pagar (o si el pago
 * nunca llegó), se muestra un fallback amable que lo manda de vuelta
 * al cobro.
 *
 * Mantiene el lenguaje "modo de pruebas" cuando `livemode=false` para que
 * nadie confunda la pantalla con un comprobante fiscal real.
 */
export default function ThanksPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const orderQ = useQuery({
    queryKey: ["public-order", token],
    queryFn: async () => {
      const res = await api.get<{ data: PublicOrder }>(`/orders/public/${token}`);
      return res.data.data;
    },
    retry: false,
    // La pasarela puede redirigir aquí antes de que llegue el webhook: se
    // consulta cada 4 s hasta ver el pago aplicado (o un error definitivo).
    refetchInterval: (query) => {
      if (query.state.error) return false;
      const status = query.state.data?.status;
      return status && SETTLED.includes(status) ? false : 4_000;
    },
  });

  // Sin scroll al cargar: el "¡Listo!" grande debe entrar ya en foco.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  if (orderQ.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
        <SkeletonRegion
          label="Cargando tu pago…"
          className="w-full max-w-md overflow-hidden rounded-card border bg-card shadow-airbnb"
        >
          <div className="space-y-4 p-8 text-center">
            <div className="mx-auto h-12 w-12 animate-pulse rounded-full bg-success-subtle" />
            <div className="mx-auto h-6 w-40 rounded bg-muted" />
            <div className="mx-auto h-4 w-56 rounded bg-muted" />
          </div>
        </SkeletonRegion>
      </main>
    );
  }

  const notFound =
    (orderQ.error as { response?: { status?: number } } | null)?.response?.status === 404;
  if (notFound) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
        <div className="w-full max-w-md space-y-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <SearchX aria-hidden className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h1 className="font-display text-display-md">No encontramos este pago</h1>
            <p className="text-sm text-muted-foreground">
              Revisa el enlace: puede estar incompleto o ya no ser válido. Si ya pagaste, pide al
              vendedor que te confirme el pedido.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (orderQ.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
        <div className="w-full max-w-md space-y-5 text-center">
          <div className="space-y-2">
            <h1 className="font-display text-display-md">No pudimos consultar tu pago</h1>
            <p className="text-sm text-muted-foreground">
              Revisa tu conexión e inténtalo de nuevo.
            </p>
          </div>
          <Button
            variant="secondary"
            className="h-11"
            loading={orderQ.isFetching}
            onClick={() => void orderQ.refetch()}
          >
            Reintentar
          </Button>
        </div>
      </main>
    );
  }

  // Pago aún no confirmado: caemos al estado de "aún no vemos tu pago".
  if (!orderQ.data || !SETTLED.includes(orderQ.data.status)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
        <div className="w-full max-w-md space-y-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning-subtle text-warning-foreground">
            <ShieldCheck aria-hidden className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h1 className="font-display text-display-md">
              Aún no vemos tu pago
            </h1>
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
              Si ya pagaste, espera unos segundos: esta página se actualiza sola. Si quieres
              revisar el estado del cobro, abre el enlace original.
            </p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Button asChild variant="secondary" className="h-11">
              <Link href={`/checkout/${token}`}>Volver al cobro</Link>
            </Button>
            {orderQ.data?.livemode === false ? (
              <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
                Modo de pruebas · sin dinero real
              </p>
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  const order = orderQ.data;
  const shareUrl = typeof window !== "undefined" ? window.location.origin : "";
  const hasEmail = order.hasCustomerEmail === true || Boolean(order.customer.email);
  const trackingHref =
    order.trackingUrl ??
    (order.trackingToken
      ? `/orders/public/track/${encodeURIComponent(order.trackingToken)}`
      : null);

  return (
    <main className="flex min-h-screen justify-center bg-muted/30 px-4 py-6 sm:items-center sm:py-10">
      <div className="w-full max-w-md space-y-4">
        {/* --- Tarjeta de "¡Listo!" ---------------------------------- */}
        <section className="overflow-hidden rounded-card border bg-card text-center shadow-airbnb">
          <div className="bg-success-subtle px-6 py-8 text-success-foreground">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-success text-success-foreground shadow-airbnb">
              <CheckCircle2 aria-hidden className="h-8 w-8" />
            </div>
            <h1 className="font-display text-display-md">¡Listo! Tu pago se aplicó</h1>
            <p className="mt-1 text-sm">
              Gracias por tu compra en <strong>{order.merchant}</strong>.
            </p>
          </div>

          <div className="space-y-1 border-b px-6 py-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Monto cobrado
            </p>
            <Money
              value={order.total}
              emphasis
              showCurrency
              className="block text-3xl leading-none tabular-nums"
            />
          </div>

          <dl className="space-y-2 px-6 py-5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Pedido</dt>
              <dd className="inline-flex items-center gap-1.5 font-mono text-xs">
                {order.id.slice(0, 8)}
                <button
                  type="button"
                  onClick={() => void copyToClipboard(order.id, "ID del pedido")}
                  className="-my-3 inline-flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Copiar ID del pedido"
                >
                  <Copy aria-hidden className="h-3.5 w-3.5" />
                </button>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Cliente</dt>
              <dd>{order.customer.fullName}</dd>
            </div>
          </dl>
        </section>

        {/* --- Próximos pasos ----------------------------------------- */}
        <section className="rounded-card border bg-card p-5 shadow-airbnb sm:p-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Qué sigue
          </h2>
          <ul className="space-y-3 text-sm">
            {hasEmail ? (
              <li className="flex gap-3">
                <Mail aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>
                  Recibirás un correo con el resumen del cobro y los datos del vendedor
                  para cualquier duda.
                </span>
              </li>
            ) : null}
            <li className="flex gap-3">
              <Receipt aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                Si necesitas factura, escribe al vendedor con tus datos fiscales
                (RFC, régimen fiscal y código postal). Verá el pedido referenciado
                y te enviará el CFDI.
              </span>
            </li>
            <li className="flex gap-3">
              <Calendar aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                Guarda este enlace: te dejamos el comprobante mientras la pasarela
                no genera uno propio.
              </span>
            </li>
          </ul>
        </section>

        {/* --- Acciones ----------------------------------------------- */}
        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:justify-center">
          {trackingHref ? (
            <Button asChild className="h-11">
              <a href={trackingHref}>
                <PackageSearch aria-hidden className="h-4 w-4" />
                Seguir mi pedido
              </a>
            </Button>
          ) : null}
          <Button
            variant="secondary"
            className="h-11"
            onClick={() => void copyToClipboard(`${shareUrl}/checkout/${token}`, "Enlace")}
          >
            <Share2 aria-hidden className="h-3.5 w-3.5" />
            Copiar enlace
          </Button>
          <Button asChild variant={trackingHref ? "secondary" : "default"} className="h-11">
            <Link href={`/checkout/${token}`}>Ver detalle del cobro</Link>
          </Button>
        </div>

        <p className="flex flex-wrap items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
          {order.livemode === false ? "Modo de pruebas · sin dinero real · " : null}
          Este comprobante{" "}
          <strong>no es un CFDI</strong>.
        </p>

        <p className="text-center text-[10px] text-muted-foreground">
          Si tu navegador no redirige solo, puedes cerrar esta ventana.
        </p>
      </div>
    </main>
  );
}