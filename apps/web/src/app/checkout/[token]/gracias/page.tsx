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
  Receipt,
  Share2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SkeletonRegion } from "@/components/ui/skeleton";
import { Money } from "@/components/app/money";
import { DateTime } from "@/components/app/date-time";

interface PublicOrder {
  id: string;
  status: string;
  subtotal: string;
  discount: string;
  tax: string;
  shipping: string;
  total: string;
  merchant: string;
  customer: { fullName: string };
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
            <div className="mx-auto h-12 w-12 animate-pulse rounded-full bg-success/20" />
            <div className="mx-auto h-6 w-40 rounded bg-muted" />
            <div className="mx-auto h-4 w-56 rounded bg-muted" />
          </div>
        </SkeletonRegion>
      </main>
    );
  }

  // Pago aún no confirmado: caemos al estado de "aún no vemos tu pago".
  if (!orderQ.data || orderQ.data.status !== "PAID") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
        <div className="w-full max-w-md space-y-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning-subtle text-warning-foreground">
            <ShieldCheck aria-hidden className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">
              Aún no vemos tu pago
            </h1>
            <p className="text-sm text-muted-foreground">
              Si ya pagaste, espera unos segundos y se actualizará solo. Si quieres
              revisar el estado del cobro, abre el enlace original.
            </p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/checkout/${token}`}>Volver al cobro</Link>
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
              Modo de pruebas · sin dinero real
            </p>
          </div>
        </div>
      </main>
    );
  }

  const order = orderQ.data;
  const shareUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <main className="flex min-h-screen justify-center bg-muted/30 px-4 py-6 sm:items-center sm:py-10">
      <div className="w-full max-w-md space-y-4">
        {/* --- Tarjeta de "¡Listo!" ---------------------------------- */}
        <section className="overflow-hidden rounded-card border bg-card text-center shadow-airbnb">
          <div className="bg-success-subtle px-6 py-8 text-success-foreground">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-success text-success-foreground shadow-airbnb">
              <CheckCircle2 aria-hidden className="h-8 w-8" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">¡Listo! Tu pago se aplicó</h1>
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
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
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
            <li className="flex gap-3">
              <Mail aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                Recibirás un correo con el resumen del cobro y los datos del vendedor
                para cualquier duda.
              </span>
            </li>
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
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyToClipboard(`${shareUrl}/checkout/${token}`, "Enlace")}
          >
            <Share2 aria-hidden className="h-3.5 w-3.5" />
            Copiar enlace
          </Button>
          <Button asChild size="sm">
            <Link href={`/checkout/${token}`}>Ver detalle del cobro</Link>
          </Button>
        </div>

        <p className="flex flex-wrap items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
          Modo de pruebas · sin dinero real · este comprobante{" "}
          <strong>no es un CFDI</strong>.
        </p>

        <p className="text-center text-[10px] text-muted-foreground">
          Si tu navegador no redirige solo, puedes cerrar esta ventana.
        </p>

        {/* Datetime se importa por si lo quieres usar luego; aquí no se
            renderiza porque el servidor ya trae createdAt en la respuesta
            del cobro. */}
        <span className="hidden">
          <DateTime value={new Date().toISOString()} />
        </span>
      </div>
    </main>
  );
}