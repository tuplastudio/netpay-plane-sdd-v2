"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DELIVERY_MODE_LABELS } from "@/components/ui/status-badge";
import { formatMoney } from "@/components/app/money";
import { Section } from "@/components/app/section";

export interface CheckoutVariant {
  id: string;
  title: string;
  price: string;
}

export interface CheckoutProduct {
  id: string;
  title: string;
  variants: CheckoutVariant[];
}

export type DeliveryMode = "PICKUP" | "LOCAL_DELIVERY";

/**
 * Apertura manual de checkout para un pedido en borrador que no viene de una
 * cotización: hay que elegir variante, cantidad y modo de entrega.
 * El disparo del mutation vive en la página; aquí solo se captura el formulario.
 */
export function ManualCheckoutCard({
  products,
  pending,
  onStart,
}: {
  products: CheckoutProduct[] | undefined;
  pending: boolean;
  onStart: (input: { variantId: string; quantity: string; deliveryMode: DeliveryMode }) => void;
}) {
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState("1.000");
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("PICKUP");

  return (
    <Section
      title="Iniciar checkout"
      description="Elige qué se cobra y cómo se entrega para abrir el checkout de este pedido."
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="checkout-variant">Variante</Label>
            <Select
              id="checkout-variant"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
            >
              <option value="">Selecciona…</option>
              {products?.flatMap((p) =>
                p.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {p.title} — {v.title} ({formatMoney(v.price)})
                  </option>
                )),
              )}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="checkout-qty">Cantidad</Label>
            <Input id="checkout-qty" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="checkout-delivery">Entrega</Label>
            <Select
              id="checkout-delivery"
              value={deliveryMode}
              onChange={(e) => setDeliveryMode(e.target.value as DeliveryMode)}
            >
              <option value="PICKUP">{DELIVERY_MODE_LABELS.PICKUP}</option>
              <option value="LOCAL_DELIVERY">{DELIVERY_MODE_LABELS.LOCAL_DELIVERY}</option>
            </Select>
          </div>
        </div>
        <Button
          loading={pending}
          onClick={() => onStart({ variantId, quantity: qty, deliveryMode })}
        >
          Iniciar checkout
        </Button>
      </div>
    </Section>
  );
}
