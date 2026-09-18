"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Minus,
  Package,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Money, formatMoney } from "@/components/app/money";
import { apiErrorMessage } from "@/app/(app)/admin/_components/api-error";
import { ProductDetailSheet } from "@/components/app/product-detail-sheet";

interface Variant {
  id: string;
  sku: string;
  title: string;
  price: string;
  stock: string | null;
  status?: string;
}

interface Product {
  id: string;
  sku: string;
  title: string;
  description?: string;
  variants: Variant[];
}

interface CartLine {
  key: string;
  variantId: string;
  sku: string;
  title: string;
  price: string;
  quantity: string;
  discountPct: number;
}

interface PricePreview {
  totals: {
    subtotal: string;
    discount: string;
    taxBase: string;
    tax: string;
    shipping: string;
    total: string;
  };
}

interface Customer {
  id: string;
  fullName: string;
}

/**
 * Inicial con la que empieza el título del producto. Si es un dígito va a la
 * pestaña "#", si es una letra a su grupo A-Z. Es lo único que tenemos para
 * derivar "categoría" sin un campo `category` real en el catálogo: cuando
 * el modelo de datos lo tenga, este agrupador se reemplaza y la UX no se
 * mueve (las tabs siguen ahí, solo cambia lo que muestran).
 */
function titleGroup(title: string): string {
  const c = (title || "").trim().charAt(0).toUpperCase();
  if (/[A-Z]/.test(c)) return c;
  return "#";
}

/**
 * Cotizador rediseñado:
 *
 * - Sheet ancho (95% del viewport, grid 3 columnas) para tener todo a la
 *   vista sin perder el contexto del listado de cotizaciones.
 * - Columna 1: tabs por inicial del título del producto. Cada tab es una
 *   rejilla de cards de producto: imagen, título, SKU y precio "desde".
 * - Columna 2: variantes del producto seleccionado. Una card por variante
 *   con precio, SKU y stock; tocar **Agregar** la empuja al carrito.
 * - Columna 3: carrito con líneas editables (cantidad, descuento) y totales
 *   calculados por el backend. Crear la cotización cierra el sheet.
 *
 * El sheet es una pieza grande a propósito: en el flujo real el vendedor
 * pasa del catálogo a la cotización con la misma ventana abierta y nunca
 * necesita abrir el detalle de cada variante en otra pestaña.
 *
 * **Cómo se abre:** el trigger vive en el `PageHeader` de la página
 * `/quotes`, NO aquí dentro. Esta vista solo RENDERIZA el Sheet cuando el
 * padre lo abre (`open=true`); tener el botón adentro duplicaba el título
 * "Cotizaciones" tres veces (PageHeader, sección del trigger, sección del
 * listado).
 */
export function NewQuoteForm({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        title="Nueva cotización"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[95vw]"
      >
        <QuoteSheet onDone={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

function QuoteSheet({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();

  const [customerId, setCustomerId] = useState("");
  const [issue, setIssue] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const products = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const res = await api.get<{ data: Product[] }>("/catalog/products", {
        params: { status: "ACTIVE" },
      });
      return res.data.data;
    },
  });

  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const res = await api.get<{ data: Customer[] }>("/customers");
      return res.data.data;
    },
  });

  const preview = useQuery({
    queryKey: ["pricing-preview", cart.map((l) => `${l.variantId}:${l.quantity}:${l.discountPct}`)],
    queryFn: async () => {
      const res = await api.post<{ data: PricePreview }>("/pricing/preview", {
        lines: cart.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          discountPct: l.discountPct,
        })),
      });
      return res.data.data;
    },
    enabled: cart.length > 0,
  });

  // Agrupar productos por inicial de su título. Si hay búsqueda, no agrupamos
  // (mostramos los resultados en un único panel plano).
  const grouped = useMemo(() => {
    const list = products.data ?? [];
    const out: Record<string, Product[]> = {};
    for (const p of list) {
      const k = titleGroup(p.title);
      (out[k] ??= []).push(p);
    }
    for (const k of Object.keys(out)) {
      out[k]!.sort((a, b) => a.title.localeCompare(b.title, "es"));
    }
    return out;
  }, [products.data]);

  const filtered = useMemo(() => {
    if (!search) return null;
    const q = search.toLowerCase();
    return (products.data ?? []).filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.variants.some((v) => v.sku.toLowerCase().includes(q) || v.title.toLowerCase().includes(q)),
    );
  }, [products.data, search]);

  // Elige la primera pestaña disponible cuando llegan los productos.
  const firstGroup = useMemo(() => {
    const keys = Object.keys(grouped).sort();
    return keys[0] ?? null;
  }, [grouped]);

  const [activeTab, setActiveTab] = useState<string>("");
  if (firstGroup && activeTab === "") setActiveTab(firstGroup);
  // Si la pestaña activa ya no existe (refetch cambió el set), cae a la primera.
  if (firstGroup && activeTab && !grouped[activeTab] && !search) setActiveTab(firstGroup);

  const [detailOpen, setDetailOpen] = useState(false);

  const selectedProduct = useMemo(
    () => products.data?.find((p) => p.id === selectedProductId) ?? null,
    [products.data, selectedProductId],
  );

  function addVariant(product: Product, variant: Variant) {
    const qty = "1.000";
    setCart((prev) => {
      const existing = prev.find((l) => l.variantId === variant.id);
      if (existing) {
        return prev.map((l) =>
          l.variantId === variant.id ? { ...l, quantity: qty } : l,
        );
      }
      return [
        ...prev,
        {
          key: variant.id,
          variantId: variant.id,
          sku: variant.sku,
          title: `${product.title} — ${variant.title}`,
          price: variant.price,
          quantity: qty,
          discountPct: 0,
        },
      ];
    });
    toast.success(`${product.title} agregado`);
  }

  function removeLine(variantId: string) {
    setCart((prev) => prev.filter((l) => l.variantId !== variantId));
  }

  function bumpQty(variantId: string, delta: number) {
    setCart((prev) =>
      prev.map((l) => {
        if (l.variantId !== variantId) return l;
        const cur = Number(l.quantity);
        const next = Math.max(0.001, +(cur + delta).toFixed(3));
        return { ...l, quantity: next.toFixed(3) };
      }),
    );
  }

  function setLineQty(variantId: string, raw: string) {
    setCart((prev) =>
      prev.map((l) => (l.variantId === variantId ? { ...l, quantity: raw } : l)),
    );
  }

  function setLineDiscount(variantId: string, raw: string) {
    const pct = Math.max(0, Math.min(100, Number(raw) || 0));
    setCart((prev) =>
      prev.map((l) => (l.variantId === variantId ? { ...l, discountPct: pct } : l)),
    );
  }

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.post("/quotes", {
        customerId,
        lines: cart.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          discountPct: l.discountPct,
        })),
        issue,
      });
      return res.data.data as { id: string };
    },
    onSuccess: async (created) => {
      toast.success(`Cotización ${created.id.slice(0, 8)} creada`);
      await qc.invalidateQueries({ queryKey: ["quotes"] });
      onDone();
      router.push(`/quotes/${created.id}`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo crear la cotización")),
  });

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!customerId) {
      toast.error("Selecciona un cliente");
      return;
    }
    if (cart.length === 0) {
      toast.error("Agrega al menos una variante");
      return;
    }
    create.mutate();
  }

  const totals = preview.data?.totals;
  const cartCount = cart.length;

  return (
    <form onSubmit={onSubmit} className="flex h-full min-h-0 flex-col">
      <SheetHeader className="border-b px-6 py-4">
        <SheetTitle>Nueva cotización</SheetTitle>
        <SheetDescription>
          Elige cliente, agrega productos y variantes. Los totales los calcula el backend.
        </SheetDescription>
      </SheetHeader>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_1.1fr_1.2fr]">
        {/* --- COL 1: catálogo (tabs + grid) ----------------------------- */}
        <div className="flex min-h-0 flex-col border-r">
          <div className="space-y-2 border-b px-4 py-3">
            <Label htmlFor="quote-customer" className="text-xs">
              Cliente
            </Label>
            <Select
              id="quote-customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Selecciona un cliente…</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </Select>
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre o SKU…"
                className="h-8 pl-7 text-sm"
                autoComplete="off"
                aria-label="Buscar producto"
              />
            </div>
          </div>

          {search || filtered ? (
            <div className="flex-1 overflow-y-auto p-3">
              {filtered && filtered.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                  Sin coincidencias para “{search}”.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {filtered?.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      active={selectedProductId === p.id}
                      onSelect={() => setSelectedProductId(p.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Tabs
              value={activeTab}
              defaultValue={activeTab}
              onValueChange={setActiveTab}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="overflow-x-auto border-b px-2 pt-2">
                <TabsList>
                  {Object.keys(grouped)
                    .sort()
                    .map((k) => (
                      <TabsTrigger key={k} value={k} className="px-3 text-xs">
                        {k}
                        <span className="ml-1 tabular-nums text-muted-foreground">
                          {grouped[k]!.length}
                        </span>
                      </TabsTrigger>
                    ))}
                </TabsList>
              </div>
              {Object.keys(grouped).map((k) => (
                <TabsContent
                  key={k}
                  value={k}
                  className="mt-0 flex-1 overflow-y-auto p-3"
                >
                  <div className="grid grid-cols-2 gap-2">
                    {grouped[k]!.map((p) => (
                      <ProductCard
                        key={p.id}
                        product={p}
                        active={selectedProductId === p.id}
                        onSelect={() => setSelectedProductId(p.id)}
                      />
                    ))}
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>

        {/* --- COL 2: variantes del producto elegido --------------------- */}
        <div className="flex min-h-0 flex-col border-r">
          <div className="border-b px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Variantes
            </p>
            {selectedProduct ? (
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <p className="line-clamp-1 text-sm font-semibold">
                  {selectedProduct.title}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0"
                  onClick={() => setDetailOpen(true)}
                  aria-label={`Ver detalle de ${selectedProduct.title}`}
                >
                  Ver detalle
                </Button>
              </div>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                Selecciona un producto a la izquierda para ver sus variantes.
              </p>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {!selectedProduct ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                <Package aria-hidden className="h-8 w-8 opacity-60" />
                <p>Ningún producto seleccionado.</p>
              </div>
            ) : selectedProduct.variants.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                Este producto no tiene variantes activas.
              </p>
            ) : (
              <ul className="space-y-2">
                {selectedProduct.variants.map((v) => {
                  const inCart = cart.some((l) => l.variantId === v.id);
                  return (
                    <li
                      key={v.id}
                      className="flex items-center gap-3 rounded-lg border bg-card p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{v.title}</p>
                        <p className="font-mono text-[10px] uppercase text-muted-foreground">
                          {v.sku}
                        </p>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="font-semibold tabular-nums text-foreground">
                            {formatMoney(v.price)}
                          </span>
                          {v.stock !== null ? (
                            <span>
                              Stock:{" "}
                              <span className="tabular-nums text-foreground">{v.stock}</span>
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={inCart ? "secondary" : "default"}
                        onClick={() => addVariant(selectedProduct, v)}
                      >
                        <Plus aria-hidden className="h-3.5 w-3.5" />
                        {inCart ? "Sumar" : "Agregar"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* --- COL 3: carrito + totales ---------------------------------- */}
        <div className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Cotización
              </p>
              <p className="mt-0.5 text-sm font-semibold">
                {cartCount === 0
                  ? "Vacía"
                  : `${cartCount} ${cartCount === 1 ? "variante" : "variantes"}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="issue"
                checked={issue}
                onChange={(e) => setIssue(e.target.checked)}
              />
              <Label htmlFor="issue" className="text-xs">
                Emitir
              </Label>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {cart.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                Agrega variantes desde el panel central.
              </p>
            ) : (
              <ul className="space-y-2">
                {cart.map((l) => (
                  <li
                    key={l.key}
                    className="rounded-lg border bg-card p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-medium">{l.title}</p>
                        <p className="font-mono text-[10px] uppercase text-muted-foreground">
                          {l.sku}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(l.variantId)}
                        aria-label={`Quitar ${l.title}`}
                        className="shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="font-semibold tabular-nums text-foreground">
                        {formatMoney(l.price)}
                      </span>
                      <span className="text-muted-foreground">c/u</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor={`qty-${l.key}`} className="text-xs">
                          Cantidad
                        </Label>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => bumpQty(l.variantId, -1)}
                            aria-label="Restar 1"
                            className="h-8 w-8"
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <Input
                            id={`qty-${l.key}`}
                            placeholder="1"
                            value={l.quantity}
                            onChange={(e) => setLineQty(l.variantId, e.target.value)}
                            className="h-8 text-center tabular-nums"
                            inputMode="decimal"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => bumpQty(l.variantId, 1)}
                            aria-label="Sumar 1"
                            className="h-8 w-8"
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`disc-${l.key}`} className="text-xs">
                          Desc %
                        </Label>
                        <Input
                          id={`disc-${l.key}`}
                          type="number"
                          step="0.01"
                          min={0}
                          max={100}
                          placeholder="0"
                          value={l.discountPct}
                          onChange={(e) => setLineDiscount(l.variantId, e.target.value)}
                          className="h-8 tabular-nums"
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t bg-muted/40 p-4">
            {preview.isFetching ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner size="sm" label={null} />
                Calculando totales…
              </p>
            ) : totals ? (
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">
                    <Money value={totals.subtotal} />
                  </dd>
                </div>
                {Number(totals.discount) > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Descuento</dt>
                    <dd className="tabular-nums">
                      −<Money value={totals.discount} />
                    </dd>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">IVA</dt>
                  <dd className="tabular-nums">
                    <Money value={totals.tax} />
                  </dd>
                </div>
                <div className="flex justify-between border-t pt-1.5 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">
                    <Money value={totals.total} emphasis />
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Sin totales aún.</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t bg-background px-6 py-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCloseOrCancel(onDone)}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" loading={create.isPending} disabled={cart.length === 0}>
          {create.isPending ? "Creando…" : "Crear cotización"}
        </Button>
      </div>

      <ProductDetailSheet
        product={selectedProduct}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onAddVariant={(v) => {
          if (!selectedProduct) return;
          addVariant(selectedProduct, v as Variant);
          setDetailOpen(false);
        }}
      />
    </form>
  );

  function onCloseOrCancel(close: () => void) {
    return () => {
      if (cart.length > 0) {
        const ok = window.confirm("¿Cerrar sin guardar? Se perderán las líneas agregadas.");
        if (!ok) return;
      }
      close();
    };
  }
}

/**
 * Card cuadrada para la rejilla de productos. Toca la card para que el panel
 * central muestre sus variantes; tocar el botón "+" agrega directamente la
 * primera variante activa (atajo para productos de variante única).
 */
function ProductCard({
  product,
  active,
  onSelect,
}: {
  product: Product;
  active: boolean;
  onSelect: () => void;
}) {
  const firstActive = product.variants[0];
  const priceFrom = product.variants.reduce(
    (min, v) => (Number(v.price) < Number(min ?? v.price) ? v.price : min ?? v.price),
    "",
  );
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={
        "group flex flex-col gap-1 rounded-lg border bg-card p-2.5 text-left transition-colors hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
        (active ? "border-primary-strong ring-2 ring-primary-strong/30" : "")
      }
    >
      <p className="line-clamp-2 text-sm font-medium">{product.title}</p>
      <p className="font-mono text-[10px] uppercase text-muted-foreground">{product.sku}</p>
      <div className="mt-auto flex items-end justify-between pt-1">
        <span className="text-xs font-semibold tabular-nums text-foreground">
          {firstActive ? formatMoney(priceFrom || firstActive.price) : "—"}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {product.variants.length} v.
        </span>
      </div>
    </button>
  );
}

// Re-exports para que el type-check encuentre tipos del archivo viejo.
export type { Product, Variant };
