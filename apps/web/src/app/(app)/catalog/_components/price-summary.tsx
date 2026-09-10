"use client";
import { Money } from "@/components/app/money";
import type { Product } from "../catalog-shared";
import { priceRange } from "./product-helpers";

/**
 * Precio de un producto en el listado: importe único si todas las variantes
 * cuestan lo mismo, "desde $X" si difieren (con el rango completo en `title`
 * y para lectores de pantalla), em dash si no hay variantes.
 */
export function PriceSummary({ product }: { product: Product }) {
  const range = priceRange(product);
  if (!range) {
    return (
      <>
        <span aria-hidden className="text-muted-foreground">
          —
        </span>
        <span className="sr-only">Sin variantes con precio</span>
      </>
    );
  }
  if (range.min === range.max) return <Money value={range.min} />;
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-xs text-muted-foreground">desde</span>
      <Money value={range.min} />
      <span className="sr-only">
        hasta <Money value={range.max} />
      </span>
    </span>
  );
}
