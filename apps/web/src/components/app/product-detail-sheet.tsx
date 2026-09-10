"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/components/app/money";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/** Mínimo que cualquier vista del producto necesita para mostrarlo. */
export interface ProductDetailVariant {
  id: string;
  sku: string;
  title: string;
  price: string;
  stock: string | null;
}

export interface ProductDetailProduct {
  id?: string;
  sku: string;
  title: string;
  description?: string | null;
  variants: ProductDetailVariant[];
}

interface ProductDetailSheetProps {
  product: ProductDetailProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * `undefined` → modo lectura (quote detail, order detail, public quote).
   * Función → muestra botón "Agregar" en cada variante y llama al callback.
   */
  onAddVariant?: (variant: ProductDetailVariant) => void;
  /** Etiqueta del botón de acción. Default "Agregar". */
  addLabel?: string;
}

/**
 * Hoja compartida para mostrar el detalle de un producto y sus variantes.
 *
 * Reusada por:
 *  - el cotizador (modo lectura + acción "Agregar" sobre cada variante)
 *  - el detalle de cotización / pedido (modo lectura)
 *  - la cotización pública (modo lectura, sin acciones)
 *
 * El caller controla si la hoja está viva (`open`) y qué producto se ve
 * (`product`). El componente no toca el catálogo: solo renderiza lo que
 * le pasan.
 */
export function ProductDetailSheet({
  product,
  open,
  onOpenChange,
  onAddVariant,
  addLabel = "Agregar",
}: ProductDetailSheetProps) {
  const readOnly = !onAddVariant;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        title="Detalle del producto"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        {product ? (
          <>
            <SheetHeader className="border-b px-6 py-4">
              <SheetTitle className="line-clamp-2">{product.title}</SheetTitle>
              <SheetDescription>
                <span className="font-mono text-xs uppercase">{product.sku}</span>
                {product.variants.length > 0
                  ? ` · ${product.variants.length} ${product.variants.length === 1 ? "variante" : "variantes"}`
                  : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-6">
              {product.description ? (
                <p className="text-sm text-muted-foreground">{product.description}</p>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  Sin descripción del producto.
                </p>
              )}

              <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Variantes
              </p>
              {product.variants.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Este producto no tiene variantes activas.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {product.variants.map((v) => (
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
                      {readOnly ? null : (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => onAddVariant?.(v)}
                        >
                          <Plus aria-hidden className="h-3.5 w-3.5" />
                          {addLabel}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}