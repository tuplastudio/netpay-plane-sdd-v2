"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Minus, Package, Plus, Search, Send, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/components/app/money";
import { useReply, useSendQuoteMessage, type Conversation } from "./use-conversations";
import {
  useCreateQuickQuote,
  useQuickQuoteProducts,
  useShareQuote,
  type QuickQuoteProduct,
} from "./use-conversation-context";

/**
 * Cotizador rápido, ahora en una hoja lateral en vez de un bloque desplegable
 * dentro del panel de contexto.
 *
 * El motivo es de forma, no de lógica: inline, abrir el cotizador empujaba
 * identidad, notas y pestañas fuera de la vista en una columna de 24rem, de
 * modo que cotizar y leer el hilo eran excluyentes. Como hoja se abre encima,
 * se cierra con Esc y devuelve a la conversación exactamente como estaba.
 *
 * La lógica (catálogo activo, carrito, `POST /quotes` con `issue: true`, link
 * público + envío por el canal) es la que ya existía; lo nuevo es la cantidad
 * por línea y el total antes de crear.
 */

interface CartLine {
  variantId: string;
  title: string;
  sku: string;
  price: string;
  quantity: number;
}

function cartTotal(cart: CartLine[]): number {
  return cart.reduce((sum, l) => sum + Number(l.price) * l.quantity, 0);
}

export function QuickQuoteSheet({
  conversation,
  open,
  onOpenChange,
}: {
  conversation: Conversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [createdQuoteId, setCreatedQuoteId] = useState<string | null>(null);

  const products = useQuickQuoteProducts(open);
  const createQuote = useCreateQuickQuote();
  const shareQuote = useShareQuote();
  const reply = useReply(conversation.id);
  const sendQuote = useSendQuoteMessage(conversation.id);

  // Cerrar es empezar de cero: dejar el carrito de la vez pasada colgando es
  // la forma más fácil de mandarle al cliente una cotización que no era.
  useEffect(() => {
    if (open) return;
    setSearch("");
    setCart([]);
    setCreatedQuoteId(null);
  }, [open]);

  const results: QuickQuoteProduct[] = useMemo(() => {
    const list = products.data ?? [];
    if (!search.trim()) return list.slice(0, 20);
    const q = search.toLowerCase();
    return list.filter((p) => p.title.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [products.data, search]);

  const customerId = conversation.customerId;
  const total = cartTotal(cart);

  function addVariant(product: QuickQuoteProduct, variant: QuickQuoteProduct["variants"][number]) {
    setCart((prev) => {
      const existing = prev.find((l) => l.variantId === variant.id);
      if (existing) {
        return prev.map((l) =>
          l.variantId === variant.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          variantId: variant.id,
          title:
            product.variants.length > 1 ? `${product.title} — ${variant.title}` : product.title,
          sku: variant.sku,
          price: variant.price,
          quantity: 1,
        },
      ];
    });
    toast.success(`${product.title} agregado`);
  }

  function setQuantity(variantId: string, quantity: number) {
    if (!Number.isFinite(quantity) || quantity < 1) return;
    setCart((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, quantity } : l)));
  }

  /** Link público + mensaje por el canal vivo, y de vuelta a la conversación. */
  async function sendLink() {
    if (!createdQuoteId) return;
    const token = await shareQuote.mutateAsync(createdQuoteId);
    const url = `${window.location.origin}/quotes/public/${token}`;
    const text = `Aquí tienes tu cotización: ${url}`;
    const options = { onSuccess: () => onOpenChange(false) };
    if (conversation.handoffToHuman) reply.mutate(text, options);
    else sendQuote.mutate(text, options);
  }

  const sending = shareQuote.isPending || reply.isPending || sendQuote.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Cotizar rápido</SheetTitle>
          <SheetDescription>
            Arma la cotización y mándasela al cliente sin salir de la conversación.
          </SheetDescription>
        </SheetHeader>

        {!customerId ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Vincula primero una ficha de cliente para poder cotizarle.
          </p>
        ) : createdQuoteId ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-card border border-success-subtle bg-success-subtle/40 p-3 text-sm">
              <p className="font-medium">Cotización creada por {formatMoney(total.toFixed(2))}.</p>
              <p className="text-muted-foreground">
                Envíala por WhatsApp: se genera el link público y se manda por el mismo canal del
                hilo.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={sending} onClick={() => void sendLink()}>
                <Send aria-hidden className="h-3.5 w-3.5" />
                Enviar por WhatsApp
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/quotes/${createdQuoteId}`}>Ver cotización</Link>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                Cerrar
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
            <div className="relative shrink-0">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar producto…"
                className="h-9 pl-8 text-sm"
                aria-label="Buscar producto"
                autoFocus
              />
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {products.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : results.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  <Package aria-hidden className="mx-auto mb-1 h-5 w-5 opacity-60" />
                  Sin resultados.
                </p>
              ) : (
                results.map((p) => (
                  <ul key={p.id} className="space-y-1">
                    {p.variants.map((v) => (
                      <li
                        key={v.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border px-2 py-1.5 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {p.title}
                            {p.variants.length > 1 ? ` — ${v.title}` : ""}
                          </p>
                          <p className="text-muted-foreground">{formatMoney(v.price)}</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 px-2"
                          aria-label={`Agregar ${p.title}${p.variants.length > 1 ? ` ${v.title}` : ""}`}
                          onClick={() => addVariant(p, v)}
                        >
                          <Plus aria-hidden className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ))
              )}
            </div>

            <div className="shrink-0 space-y-2 border-t border-border pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Carrito ({cart.length})
              </p>
              {cart.length === 0 ? (
                <p className="text-xs text-muted-foreground">Agrega variantes de arriba.</p>
              ) : (
                <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                  {cart.map((l) => (
                    <li key={l.variantId} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate">{l.title}</span>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          aria-label={`Quitar una unidad de ${l.title}`}
                          disabled={l.quantity <= 1}
                          onClick={() => setQuantity(l.variantId, l.quantity - 1)}
                        >
                          <Minus aria-hidden className="h-3 w-3" />
                        </Button>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          value={l.quantity}
                          aria-label={`Cantidad de ${l.title}`}
                          className="h-6 w-12 px-1 text-center text-[11px]"
                          onChange={(e) => setQuantity(l.variantId, Number(e.target.value))}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          aria-label={`Agregar una unidad de ${l.title}`}
                          onClick={() => setQuantity(l.variantId, l.quantity + 1)}
                        >
                          <Plus aria-hidden className="h-3 w-3" />
                        </Button>
                      </div>
                      <span className="w-20 shrink-0 text-right font-medium">
                        {formatMoney((Number(l.price) * l.quantity).toFixed(2))}
                      </span>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        aria-label={`Quitar ${l.title}`}
                        onClick={() =>
                          setCart((prev) => prev.filter((x) => x.variantId !== l.variantId))
                        }
                      >
                        <Trash2 aria-hidden className="h-3 w-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex items-center justify-between border-t border-border pt-2 text-sm">
                <span className="font-medium">Total</span>
                <span className="font-semibold tabular-nums">
                  {formatMoney(total.toFixed(2))}
                </span>
              </div>

              <Button
                size="sm"
                className="w-full"
                disabled={cart.length === 0}
                loading={createQuote.isPending}
                onClick={() =>
                  createQuote.mutate(
                    {
                      customerId,
                      lines: cart.map((l) => ({
                        variantId: l.variantId,
                        quantity: l.quantity.toFixed(3),
                      })),
                    },
                    { onSuccess: (created) => setCreatedQuoteId(created.id) },
                  )
                }
              >
                <ShoppingCart aria-hidden className="h-3.5 w-3.5" />
                Crear cotización
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
