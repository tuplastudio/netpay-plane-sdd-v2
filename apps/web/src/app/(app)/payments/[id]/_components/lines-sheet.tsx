"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CirclePlus,
  Copy,
  ExternalLink,
  Minus,
  Package,
  Plus,
  RotateCcw,
} from "lucide-react";
import { Money, formatMoney } from "@/components/app/money";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

interface SessionLine {
  variantId: string;
  quantity: string;
  sku: string | null;
  title: string | null;
  productTitle: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
}

/** "2.000" → "2", "2.500" → "2.5": la cantidad puede tener 3 decimales pero
 * mostrarlos siempre es ruido cuando es entera o simple. */
function qty(value: string): string {
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** Dialog que muestra el desglose de la venta: líneas, totales y datos
 *  fiscales mínimos del cliente. Es el equivalente del cotizador pero
 *  en modo lectura: nada se edita desde aquí. */
export function LinesSheet({
  amount,
  currency,
  customerName,
  customerEmail,
  customerPhone,
  customerTaxId,
  customerId,
  orderId,
  orderTotal,
  orderSubtotal,
  orderTax,
  orderShipping,
  orderDiscount,
  lines,
}: {
  amount: string;
  currency: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerTaxId: string | null;
  customerId: string;
  orderId: string;
  orderTotal: string;
  orderSubtotal: string;
  orderTax: string;
  orderShipping: string;
  orderDiscount: string;
  lines: SessionLine[];
}) {
  const [selectedLine, setSelectedLine] = useState<SessionLine | null>(null);

  return (
    <>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm">
            <CirclePlus aria-hidden className="h-3.5 w-3.5" />
            Ver qué se cobró
          </Button>
        </SheetTrigger>
        <SheetContent
          side="right"
          title="Qué se cobró"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
        >
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>Detalle de la venta</SheetTitle>
            <SheetDescription>
              Líneas cobradas en esta sesión, total del pedido y datos del cliente.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-6">
            {lines.length === 0 ? (
              <p className="rounded-md border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                Esta sesión se creó sin desglose de productos; el monto cobrado es el del pedido.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow interactive={false}>
                    <TableHead>SKU</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead numeric>Cant.</TableHead>
                    <TableHead numeric>P. unit.</TableHead>
                    <TableHead numeric>Importe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow
                      key={l.variantId}
                      onClick={() => setSelectedLine(l)}
                      className="cursor-pointer"
                    >
                      <TableCell className="font-mono text-xs">{l.sku ?? "—"}</TableCell>
                      <TableCell>
                        {l.productTitle ? (
                          <span className="text-muted-foreground">{l.productTitle} · </span>
                        ) : null}
                        {l.title ?? l.variantId.slice(0, 8)}
                      </TableCell>
                      <TableCell numeric>{qty(l.quantity)}</TableCell>
                      <TableCell numeric>
                        <Money value={l.unitPrice} />
                      </TableCell>
                      <TableCell numeric>
                        <Money value={l.lineTotal} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow interactive={false}>
                    <TableCell colSpan={4} className="text-right font-semibold">
                      Cobrado en esta sesión
                    </TableCell>
                    <TableCell numeric>
                      <Money value={amount} currency={currency} emphasis />
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border bg-card p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cliente
                </p>
                <p className="font-medium">{customerName}</p>
                {customerEmail ? (
                  <p className="text-sm text-muted-foreground">{customerEmail}</p>
                ) : null}
                {customerPhone ? (
                  <p className="text-sm text-muted-foreground">{customerPhone}</p>
                ) : null}
                {customerTaxId ? (
                  <p className="font-mono text-xs text-muted-foreground">
                    RFC: {customerTaxId}
                  </p>
                ) : null}
                <Button asChild variant="link" size="sm" className="mt-2 h-auto px-0">
                  <Link href={`/customers/${customerId}`}>
                    Ver cliente
                    <ExternalLink aria-hidden className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Totales del pedido
                </p>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="tabular-nums">
                      <Money value={orderSubtotal} currency={currency} />
                    </dd>
                  </div>
                  {Number(orderDiscount) > 0 ? (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Descuento</dt>
                      <dd className="tabular-nums">
                        −<Money value={orderDiscount} currency={currency} />
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">IVA</dt>
                    <dd className="tabular-nums">
                      <Money value={orderTax} currency={currency} />
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Envío</dt>
                    <dd className="tabular-nums">
                      <Money value={orderShipping} currency={currency} />
                    </dd>
                  </div>
                  <div className="flex justify-between border-t pt-1.5 text-base font-semibold">
                    <dt>Total</dt>
                    <dd className="tabular-nums">
                      <Money value={orderTotal} currency={currency} emphasis />
                    </dd>
                  </div>
                </dl>
                <Button asChild variant="link" size="sm" className="mt-2 h-auto px-0">
                  <Link href={`/orders/${orderId}`}>
                    Ver pedido completo
                    <ExternalLink aria-hidden className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Sub-modal: detalle de la línea tocada. */}
      <Sheet open={!!selectedLine} onOpenChange={(o) => !o && setSelectedLine(null)}>
        <SheetContent
          side="right"
          title="Detalle del producto"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          {selectedLine ? <LineDetail line={selectedLine} currency={currency} /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function LineDetail({ line, currency }: { line: SessionLine; currency: string }) {
  const quantity = Number(line.quantity);
  const lineTotal = Number(line.lineTotal ?? 0);
  const unitPrice = Number(line.unitPrice ?? 0);
  const subtotal = quantity * unitPrice;
  const matches = Math.abs(subtotal - lineTotal) < 0.005;

  function bump(..._args: unknown[]) {
    toast.info("Vista previa: solo lectura");
  }

  return (
    <>
      <SheetHeader className="border-b px-6 py-4">
        <SheetTitle className="line-clamp-2">
          {line.productTitle ? `${line.productTitle} — ` : ""}
          {line.title ?? "Producto"}
        </SheetTitle>
        <SheetDescription>
          <span className="font-mono text-xs uppercase">{line.sku ?? "—"}</span>
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto p-6">
        <dl className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">SKU</dt>
            <dd className="font-mono text-xs">{line.sku ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Variante</dt>
            <dd className="max-w-[60%] text-right">{line.title ?? "—"}</dd>
          </div>
          {line.productTitle ? (
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Producto</dt>
              <dd className="max-w-[60%] text-right">{line.productTitle}</dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Precio unitario</dt>
            <dd className="font-semibold tabular-nums">
              <Money value={line.unitPrice} currency={currency} />
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Cantidad cobrada</dt>
            <dd className="tabular-nums">{qty(line.quantity)}</dd>
          </div>
        </dl>

        <div className="mt-6 rounded-lg border bg-card p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Editar (solo vista previa)
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            La sesión de pago es histórica. Para modificar el pedido, abre el pedido completo.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Cantidad</p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => bump("qty", -1)}
                  aria-label="Restar 1"
                  className="h-8 w-8"
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <div className="flex h-8 flex-1 items-center justify-center rounded-md border bg-muted/40 tabular-nums">
                  {qty(line.quantity)}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => bump("qty", 1)}
                  aria-label="Sumar 1"
                  className="h-8 w-8"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">P. unitario</p>
              <div className="flex h-8 items-center rounded-md border bg-muted/40 px-2 text-sm tabular-nums">
                {formatMoney(line.unitPrice ?? "0", currency)}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border bg-muted/40 p-4">
          <p className="text-xs text-muted-foreground">Importe cobrado</p>
          <p className="text-lg font-semibold tabular-nums">
            <Money value={line.lineTotal} currency={currency} emphasis />
          </p>
          {matches ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Coincide con {qty(line.quantity)} × {formatMoney(line.unitPrice ?? "0", currency)}.
            </p>
          ) : (
            <p className="mt-1 text-xs text-warning-foreground">
              El importe de la sesión ({formatMoney(line.lineTotal ?? "0", currency)}) no
              coincide con el cálculo {qty(line.quantity)} ×{" "}
              {formatMoney(line.unitPrice ?? "0", currency)} = {subtotal.toFixed(2)}.
            </p>
          )}
        </div>

        <Button asChild variant="outline" size="sm" className="mt-4 w-full">
          <Link href={`/catalog`}>
            <Package aria-hidden className="h-3.5 w-3.5" />
            Ir al catálogo
          </Link>
        </Button>
      </div>

      <div className="flex items-center justify-end gap-2 border-t bg-background px-6 py-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void copyToClipboard(line.sku ?? line.variantId, "SKU")}
        >
          <Copy aria-hidden className="h-3.5 w-3.5" />
          Copiar SKU
        </Button>
        <Button asChild size="sm">
          <Link href={`/orders`}>
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
            Reembolsar desde el pedido
          </Link>
        </Button>
      </div>
    </>
  );
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  } catch {
    toast.message(label, { description: text });
  }
}