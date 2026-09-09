"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/app/page-header";

interface Customer {
  id: string;
  fullName: string;
  email: string | null;
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado al portapapeles`);
  } catch {
    toast.message(label, { description: text });
  }
}

export default function QuickChargePage() {
  const [customerId, setCustomerId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentLink, setPaymentLink] = useState<string | null>(null);

  const customers = useQuery({
    queryKey: ["customers-for-quick-charge"],
    queryFn: async () => {
      const res = await api.get<{ data: Customer[] }>("/customers");
      return res.data.data;
    },
  });

  const charge = useMutation({
    mutationFn: async () => {
      const res = await api.post("/orders/quick-charge", {
        customerId: customerId || undefined,
        description,
        amountTotal: amount,
      });
      return res.data.data as { checkoutToken: string | null };
    },
    onSuccess: (data) => {
      if (data.checkoutToken) {
        const url = `${window.location.origin}/checkout/${data.checkoutToken}`;
        setPaymentLink(url);
        void copyToClipboard(url, "Link de pago");
      }
      toast.success("Cobro creado");
      setDescription("");
      setAmount("");
    },
    onError: () => toast.error("No se pudo crear el cobro"),
  });

  const canSubmit = description.trim().length > 0 && Number(amount) > 0;

  return (
    <div className="mx-auto w-full max-w-lg space-y-6">
      <PageHeader
        title="Cobro rápido"
        description="Cobra un importe libre sin necesidad de una cotización o productos del catálogo."
      />

      <div className="rounded-card border bg-card p-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="customer">Cliente (opcional)</Label>
          <select
            id="customer"
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">Sin cliente (mostrador)</option>
            {customers.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName} {c.email ? `(${c.email})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Concepto</Label>
          <Input
            id="description"
            placeholder="Ej. Servicio de instalación"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="amount">Importe total (IVA incluido)</Label>
          <Input
            id="amount"
            inputMode="decimal"
            placeholder="116.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <Button
          className="w-full"
          onClick={() => charge.mutate()}
          disabled={!canSubmit || charge.isPending}
        >
          <Zap className="h-4 w-4" />
          {charge.isPending ? "Creando…" : "Crear cobro y generar link"}
        </Button>
      </div>

      {paymentLink && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border bg-emerald-50 p-4 text-sm dark:bg-emerald-950/30">
          <span className="font-medium">Link de pago:</span>
          <a href={paymentLink} target="_blank" rel="noreferrer" className="break-all text-primary underline">
            {paymentLink}
          </a>
          <Button variant="outline" size="sm" onClick={() => void copyToClipboard(paymentLink, "Link de pago")}>
            <Copy className="h-3.5 w-3.5" />
            Copiar
          </Button>
        </div>
      )}
    </div>
  );
}
