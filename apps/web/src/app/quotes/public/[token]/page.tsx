"use client";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Download, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
  lines: Array<{
    id: string;
    sku: string;
    title: string;
    quantity: string;
    unitPrice: string;
    lineSubtotal: string;
  }>;
}

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

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold">NetPay Plane</span>
          </Link>
          <Badge variant="muted">Documento comercial</Badge>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando cotización…</p>
        ) : q.isError || !q.data ? (
          <ErrorState />
        ) : (
          <QuoteView quote={q.data} token={token} />
        )}

        <p className="mt-8 text-center text-[11px] text-muted-foreground">
          Documento comercial. No constituye CFDI.
        </p>
      </main>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="rounded-lg border bg-background p-8 text-center">
      <h1 className="text-lg font-semibold">Link no disponible</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        El link es inválido, ya expiró o la cotización fue revocada.
      </p>
      <Button asChild className="mt-4" variant="outline">
        <Link href="/">Volver al inicio</Link>
      </Button>
    </div>
  );
}

function QuoteView({ quote, token }: { quote: QuotePublic; token: string }) {
  const expired = new Date(quote.expiresAt).getTime() < Date.now();

  return (
    <article className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Cotización {quote.id.slice(0, 8)}
        </p>
        <h1 className="text-2xl font-semibold">
          {quote.customer.fullName || "Cliente"}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={quote.status === "ACCEPTED" ? "success" : "secondary"}>
            {quote.status}
          </Badge>
          {expired ? <Badge variant="warning">Vencida</Badge> : null}
          {quote.customer.email ? <span>· {quote.customer.email}</span> : null}
        </div>
      </header>

      <section className="rounded-lg border bg-background p-6 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="pb-3">Producto</th>
              <th className="pb-3 text-right">Cant.</th>
              <th className="pb-3 text-right">P. unitario</th>
              <th className="pb-3 text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="py-3">
                  <div className="font-mono text-[10px] uppercase text-muted-foreground">
                    {l.sku}
                  </div>
                  <div className="font-medium">{l.title}</div>
                </td>
                <td className="py-3 text-right tabular-nums">{l.quantity}</td>
                <td className="py-3 text-right tabular-nums">${l.unitPrice}</td>
                <td className="py-3 text-right font-mono tabular-nums">${l.lineSubtotal}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-sm">
            {Number(quote.discount) > 0 ? (
              <tr>
                <td colSpan={3} className="pt-3 text-right text-muted-foreground">Descuento</td>
                <td className="pt-3 text-right font-mono tabular-nums">-${quote.discount}</td>
              </tr>
            ) : null}
            <tr>
              <td colSpan={3} className="pt-1 text-right text-muted-foreground">Subtotal</td>
              <td className="pt-1 text-right font-mono tabular-nums">${quote.taxBase}</td>
            </tr>
            <tr>
              <td colSpan={3} className="pt-1 text-right text-muted-foreground">IVA</td>
              <td className="pt-1 text-right font-mono tabular-nums">${quote.tax}</td>
            </tr>
            {Number(quote.shipping) > 0 ? (
              <tr>
                <td colSpan={3} className="pt-1 text-right text-muted-foreground">Envío</td>
                <td className="pt-1 text-right font-mono tabular-nums">${quote.shipping}</td>
              </tr>
            ) : null}
            <tr className="border-t">
              <td colSpan={3} className="pt-3 text-right text-base font-semibold">Total</td>
              <td className="pt-3 text-right font-mono text-base font-semibold tabular-nums">
                ${quote.total} {quote.currency ?? "MXN"}
              </td>
            </tr>
          </tfoot>
        </table>

        {quote.notes ? (
          <p className="mt-6 rounded-md bg-muted p-3 text-sm">
            <strong>Notas:</strong> {quote.notes}
          </p>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-4">
        <p className="text-xs text-muted-foreground">
          Válida hasta <strong>{new Date(quote.expiresAt).toLocaleDateString()}</strong>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" size="sm">
            <a href={`/api/v1/quotes/public/${token}/pdf`} target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" />
              Descargar PDF
            </a>
          </Button>
          {!expired ? (
            <p className="text-xs text-muted-foreground">
              Para pagar, confirma con tu asesor: te comparte el link de pago en cuanto apruebe la
              cotización.
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
