"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";

interface Quote {
  id: string;
  status: string;
  total: string;
  customer: { fullName: string };
  expiresAt: string;
}

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
  totals: { subtotal: string; discount: string; taxBase: string; tax: string; shipping: string; total: string };
}

function statusVariant(status: string): "success" | "warning" | "muted" {
  if (status === "ISSUED" || status === "ACCEPTED") return "success";
  if (status === "DRAFT") return "warning";
  return "muted";
}

export default function QuotesPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const [customerId, setCustomerId] = useState("");
  const [issue, setIssue] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([]);

  const [draftVariantId, setDraftVariantId] = useState("");
  const [draftQty, setDraftQty] = useState("1.000");
  const [draftDiscount, setDraftDiscount] = useState("0");

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
      const res = await api.get<{ data: Array<{ id: string; fullName: string }> }>("/customers");
      return res.data.data;
    },
  });

  const list = useQuery({
    queryKey: ["quotes"],
    queryFn: async () => {
      const res = await api.get<{ data: Quote[] }>("/quotes");
      return res.data.data;
    },
  });

  // Total oficial: la misma calculadora que usa el agente y el backend al
  // emitir. Nunca se le pide al usuario confiar en una suma hecha en el
  // navegador.
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

  const allVariants = useMemo(
    () => products.data?.flatMap((p) => p.variants.map((v) => ({ ...v, productTitle: p.title }))) ?? [],
    [products.data],
  );

  function addLine() {
    const variant = allVariants.find((v) => v.id === draftVariantId);
    if (!variant) {
      toast.error("Selecciona un producto");
      return;
    }
    if (!/^\d+\.\d{3}$/.test(draftQty)) {
      toast.error("Cantidad debe tener formato NN.NNN, ej. 1.000");
      return;
    }
    const discountPct = Number(draftDiscount) || 0;
    setCart((prev) => {
      const existing = prev.find((l) => l.variantId === variant.id);
      if (existing) {
        return prev.map((l) =>
          l.variantId === variant.id ? { ...l, quantity: draftQty, discountPct } : l,
        );
      }
      return [
        ...prev,
        {
          key: variant.id,
          variantId: variant.id,
          sku: variant.sku,
          title: `${variant.productTitle} — ${variant.title}`,
          price: variant.price,
          quantity: draftQty,
          discountPct,
        },
      ];
    });
    setDraftVariantId("");
    setDraftQty("1.000");
    setDraftDiscount("0");
  }

  function removeLine(variantId: string) {
    setCart((prev) => prev.filter((l) => l.variantId !== variantId));
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
      return res.data.data;
    },
    onSuccess: async (created) => {
      toast.success(`Cotización ${created.id.slice(0, 8)} creada`);
      setCart([]);
      setCustomerId("");
      await qc.invalidateQueries({ queryKey: ["quotes"] });
      router.push(`/quotes/${created.id}`);
    },
    onError: (error) => {
      const detail = (error as { response?: { data?: { message?: string } } })?.response?.data;
      toast.error(detail?.message ?? "No se pudo crear la cotización");
    },
  });

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!customerId) {
      toast.error("Selecciona un cliente");
      return;
    }
    if (cart.length === 0) {
      toast.error("Agrega al menos una línea");
      return;
    }
    create.mutate();
  }

  const totals = preview.data?.totals;

  return (
    <div>
      <PageHeader
        title="Cotizaciones"
        description="Cotiza varios productos y variantes en una sola cotización, emítela y comparte el link público."
      />

      <form onSubmit={onSubmit} className="mb-6 space-y-4 rounded-card border bg-card p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="customerId">Cliente</Label>
            <select
              id="customerId"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Selecciona…</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={issue} onChange={(e) => setIssue(e.target.checked)} />
              Emitir inmediatamente
            </label>
          </div>
        </div>

        <div className="rounded-lg border border-dashed p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Agregar producto
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
            <select
              value={draftVariantId}
              onChange={(e) => setDraftVariantId(e.target.value)}
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Selecciona un producto y variante…</option>
              {products.data?.map((p) => (
                <optgroup key={p.id} label={p.title}>
                  {p.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.title} — ${v.price}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <Input
              value={draftQty}
              onChange={(e) => setDraftQty(e.target.value)}
              placeholder="1.000"
              className="w-full sm:w-24"
              aria-label="Cantidad"
            />
            <Input
              value={draftDiscount}
              onChange={(e) => setDraftDiscount(e.target.value)}
              type="number"
              step="0.01"
              placeholder="Desc %"
              className="w-full sm:w-24"
              aria-label="Descuento %"
            />
            <Button type="button" variant="outline" onClick={addLine}>
              <Plus className="h-4 w-4" />
              Agregar
            </Button>
          </div>
        </div>

        {cart.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted text-left text-xs uppercase text-muted-foreground">
                  <th className="p-2">SKU</th>
                  <th className="p-2">Producto</th>
                  <th className="p-2 text-right">Cantidad</th>
                  <th className="p-2 text-right">Precio</th>
                  <th className="p-2 text-right">Desc%</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((line) => (
                  <tr key={line.key} className="border-b last:border-0">
                    <td className="p-2 font-mono text-xs">{line.sku}</td>
                    <td className="p-2">{line.title}</td>
                    <td className="p-2 text-right tabular-nums">{line.quantity}</td>
                    <td className="p-2 text-right font-mono">${line.price}</td>
                    <td className="p-2 text-right">{line.discountPct}%</td>
                    <td className="p-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeLine(line.variantId)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Quitar ${line.title}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t bg-muted/50 p-3 text-sm">
              {preview.isFetching ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculando…
                </span>
              ) : totals ? (
                <>
                  <span className="text-muted-foreground">
                    Subtotal <span className="font-mono text-foreground">${totals.subtotal}</span>
                  </span>
                  <span className="text-muted-foreground">
                    IVA <span className="font-mono text-foreground">${totals.tax}</span>
                  </span>
                  <span className="font-semibold">
                    Total <span className="font-mono">${totals.total}</span>
                  </span>
                </>
              ) : null}
            </div>
          </div>
        )}

        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Creando…" : "Crear cotización"}
        </Button>
      </form>

      <div className="overflow-x-auto rounded-card border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="p-3">ID</th>
              <th className="p-3">Cliente</th>
              <th className="p-3">Estado</th>
              <th className="p-3">Total</th>
              <th className="p-3">Vence</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((q) => (
              <tr
                key={q.id}
                className="cursor-pointer border-b hover:bg-muted"
                onClick={() => router.push(`/quotes/${q.id}`)}
              >
                <td className="p-3 font-mono text-xs">{q.id.slice(0, 8)}…</td>
                <td className="p-3">{q.customer.fullName}</td>
                <td className="p-3">
                  <Badge variant={statusVariant(q.status)}>{q.status}</Badge>
                </td>
                <td className="p-3 font-mono">${q.total}</td>
                <td className="p-3 text-muted-foreground">
                  {new Date(q.expiresAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  Sin cotizaciones todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
