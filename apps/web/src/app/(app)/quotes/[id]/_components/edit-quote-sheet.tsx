"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Money } from "@/components/app/money";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { apiErrorMessage } from "@/app/(app)/admin/_components/api-error";

interface Variant {
  id: string;
  sku: string;
  title: string;
  price: string;
  stock: string | null;
}

interface Product {
  id: string;
  sku: string;
  title: string;
  variants: Variant[];
}

export interface EditableQuoteLine {
  variantId: string;
  sku: string;
  title: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
}

interface CartLine {
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
    tax: string;
    shipping: string;
    total: string;
  };
}

interface UpdateResult {
  id: string;
  total: string;
  customerNotified: boolean;
  orderReset: boolean;
}

function normalizeQty(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "1.000";
  return n.toFixed(3);
}

/**
 * Edición de una cotización que todavía no se pagó. Reusa las mismas reglas
 * del cotizador (cantidad NN.NNN, descuento 0-100) pero en un panel corto:
 * quien edita ya tiene las líneas y sólo ajusta cantidades, quita o agrega
 * una presentación. Los totales los calcula el backend con `/pricing/preview`.
 */
export function EditQuoteSheet({
  open,
  onOpenChange,
  quoteId,
  lines,
  notes,
  status,
  hasOrder,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  lines: EditableQuoteLine[];
  notes: string | null;
  status: string;
  hasOrder: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const qc = useQueryClient();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [draftNotes, setDraftNotes] = useState("");
  const [search, setSearch] = useState("");

  // Se resetea cada vez que se abre: si el usuario cerró sin guardar, la
  // próxima apertura parte de lo que está en el servidor, no de su borrador.
  useEffect(() => {
    if (!open) return;
    setCart(
      lines.map((l) => ({
        variantId: l.variantId,
        sku: l.sku,
        title: l.title,
        price: l.unitPrice,
        quantity: l.quantity,
        discountPct: Number(l.discountPct) || 0,
      })),
    );
    setDraftNotes(notes ?? "");
    setSearch("");
  }, [open, lines, notes]);

  const products = useQuery({
    queryKey: ["products", "ACTIVE"],
    queryFn: async () => {
      const res = await api.get<{ data: Product[] }>("/catalog/products", {
        params: { status: "ACTIVE" },
      });
      return res.data.data;
    },
    enabled: open,
  });

  const preview = useQuery({
    queryKey: [
      "pricing-preview",
      cart.map((l) => `${l.variantId}:${l.quantity}:${l.discountPct}`),
    ],
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
    enabled: open && cart.length > 0,
  });

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const out: Array<{ product: Product; variant: Variant }> = [];
    for (const p of products.data ?? []) {
      for (const v of p.variants) {
        const hay = `${p.title} ${p.sku} ${v.title} ${v.sku}`.toLowerCase();
        if (hay.includes(q)) out.push({ product: p, variant: v });
        if (out.length >= 8) return out;
      }
    }
    return out;
  }, [products.data, search]);

  function addVariant(product: Product, variant: Variant) {
    setCart((prev) => {
      if (prev.some((l) => l.variantId === variant.id)) return prev;
      return [
        ...prev,
        {
          variantId: variant.id,
          sku: variant.sku,
          title: `${product.title} — ${variant.title}`,
          price: variant.price,
          quantity: "1.000",
          discountPct: 0,
        },
      ];
    });
    setSearch("");
  }

  function patchLine(variantId: string, patch: Partial<CartLine>) {
    setCart((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)));
  }

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.patch<{ data: UpdateResult }>(`/quotes/${quoteId}`, {
        lines: cart.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          discountPct: l.discountPct,
        })),
        notes: draftNotes.trim() === "" ? null : draftNotes.trim(),
      });
      return res.data.data;
    },
    onSuccess: async (data) => {
      toast.success(
        data.customerNotified
          ? "Cotización actualizada y reenviada al cliente"
          : "Cotización actualizada",
      );
      if (data.orderReset) {
        toast.message("El pedido volvió a borrador", {
          description: "Se liberó la reserva anterior. Vuelve a iniciar el checkout para cobrar.",
        });
      }
      await qc.invalidateQueries({ queryKey: ["quote", quoteId] });
      await qc.invalidateQueries({ queryKey: ["quotes"] });
      await onSaved();
      onOpenChange(false);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo actualizar la cotización")),
  });

  const totals = preview.data?.totals;
  const dirty = useMemo(() => {
    const before = lines
      .map((l) => `${l.variantId}:${l.quantity}:${Number(l.discountPct) || 0}`)
      .sort()
      .join("|");
    const after = cart
      .map((l) => `${l.variantId}:${l.quantity}:${l.discountPct}`)
      .sort()
      .join("|");
    return before !== after || (notes ?? "") !== draftNotes.trim();
  }, [cart, lines, notes, draftNotes]);
  const canSave = cart.length > 0 && dirty && !save.isPending;
  const customerWillBeNotified = status === "ACCEPTED" || status === "ISSUED";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>Editar cotización</SheetTitle>
          <SheetDescription>
            Ajusta cantidades, descuentos o presentaciones. Los totales se recalculan con los precios
            vigentes del catálogo.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {customerWillBeNotified ? (
            <Alert variant="info">
              <AlertTriangle />
              <AlertTitle>El cliente ya tiene esta cotización</AlertTitle>
              <AlertDescription>
                Al guardar se le envía un link con la versión nueva.
                {hasOrder
                  ? " El pedido asociado vuelve a borrador y habrá que abrir el checkout de nuevo."
                  : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="edit-quote-search">Agregar presentación</Label>
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="edit-quote-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Busca por producto o SKU…"
                className="pl-8"
                autoComplete="off"
              />
            </div>
            {search.trim() ? (
              <ul
                role="listbox"
                aria-label="Resultados"
                className="max-h-56 divide-y overflow-y-auto rounded-card border bg-card"
              >
                {products.isLoading ? (
                  <li className="px-3 py-2 text-sm text-muted-foreground">Buscando…</li>
                ) : matches.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted-foreground">Sin coincidencias</li>
                ) : (
                  matches.map(({ product, variant }) => {
                    const inCart = cart.some((l) => l.variantId === variant.id);
                    return (
                      <li key={variant.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={inCart}
                          disabled={inCart}
                          onClick={() => addVariant(product, variant)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {product.title} — {variant.title}
                            </span>
                            <span className="block font-mono text-xs text-muted-foreground">
                              {variant.sku}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-xs">
                            <Money value={variant.price} />
                            {inCart ? (
                              <span className="text-muted-foreground">Ya está</span>
                            ) : (
                              <Plus aria-hidden className="h-4 w-4" />
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Líneas</p>
            {cart.length === 0 ? (
              <EmptyState
                title="Sin líneas"
                description="Agrega al menos una presentación para guardar."
              />
            ) : (
              <ul className="divide-y rounded-card border bg-card">
                {cart.map((l) => (
                  <li key={l.variantId} className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{l.title}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {l.sku} · <Money value={l.price} /> c/u
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        aria-label={`Quitar ${l.title}`}
                        onClick={() =>
                          setCart((prev) => prev.filter((x) => x.variantId !== l.variantId))
                        }
                      >
                        <Trash2 aria-hidden className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor={`qty-${l.variantId}`} className="text-xs">
                          Cantidad
                        </Label>
                        <Input
                          id={`qty-${l.variantId}`}
                          inputMode="decimal"
                          value={l.quantity}
                          onChange={(e) => patchLine(l.variantId, { quantity: e.target.value })}
                          onBlur={(e) =>
                            patchLine(l.variantId, { quantity: normalizeQty(e.target.value) })
                          }
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`disc-${l.variantId}`} className="text-xs">
                          Descuento %
                        </Label>
                        <Input
                          id={`disc-${l.variantId}`}
                          inputMode="numeric"
                          value={String(l.discountPct)}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            patchLine(l.variantId, {
                              discountPct: Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0,
                            });
                          }}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-quote-notes">Notas para el cliente</Label>
            <Textarea
              id="edit-quote-notes"
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Condiciones, tiempos de entrega, aclaraciones…"
            />
          </div>

          <div className="rounded-card border bg-muted/40 p-3">
            <DescriptionList divided>
              <FieldRow label="Subtotal" numeric>
                <Money value={totals?.subtotal ?? null} />
              </FieldRow>
              <FieldRow label="Descuento" numeric>
                <Money value={totals?.discount ?? null} />
              </FieldRow>
              <FieldRow label="IVA" numeric>
                <Money value={totals?.tax ?? null} />
              </FieldRow>
              <FieldRow label="Envío" numeric>
                <Money value={totals?.shipping ?? null} />
              </FieldRow>
              <FieldRow label="Total" numeric emphasis>
                <Money value={totals?.total ?? null} emphasis showCurrency />
              </FieldRow>
            </DescriptionList>
            {preview.isError ? (
              <p className="mt-2 text-xs text-destructive-subtle-foreground">
                No se pudo calcular el total. Revisa cantidades y descuentos.
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-6 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            loading={save.isPending}
            disabled={!canSave}
            onClick={() => save.mutate()}
          >
            Guardar cambios
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
