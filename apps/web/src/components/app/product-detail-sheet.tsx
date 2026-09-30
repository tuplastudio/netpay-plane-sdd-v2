"use client";

import * as React from "react";
import { ImageIcon, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/components/app/money";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/** Foto mínima para la galería del detalle (la general del producto o la de una variante). */
export interface ProductDetailImage {
  id: string;
  url: string;
  altText?: string | null;
}

/** Mínimo que cualquier vista del producto necesita para mostrarlo. */
export interface ProductDetailVariant {
  id: string;
  sku: string;
  title: string;
  price: string;
  stock: string | null;
  /** Fotos propias de la variante (opcional). */
  images?: ProductDetailImage[];
}

export interface ProductDetailProduct {
  id?: string;
  sku: string;
  title: string;
  description?: string | null;
  variants: ProductDetailVariant[];
  /** Galería general, en orden (la primera es la portada). Opcional. */
  images?: ProductDetailImage[];
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
  /** Acciones al pie del panel (p. ej. "Editar" en el catálogo). */
  footer?: React.ReactNode;
}

/**
 * Hoja compartida para mostrar el detalle de un producto y sus variantes.
 *
 * Reusada por:
 *  - el catálogo (galería + acciones en el pie)
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
  footer,
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
            <SheetHeader className="border-b px-6 py-4 pr-12">
              <SheetTitle className="line-clamp-2">{product.title}</SheetTitle>
              <SheetDescription>
                <span className="font-mono text-xs uppercase">{product.sku}</span>
                {product.variants.length > 0
                  ? ` · ${product.variants.length} ${product.variants.length === 1 ? "variante" : "variantes"}`
                  : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {product.images && product.images.length > 0 ? (
                <ProductGallery key={product.id ?? product.sku} images={product.images} title={product.title} />
              ) : null}

              {product.description ? (
                <p className={cn("text-sm text-muted-foreground", product.images?.length ? "mt-6" : "")}>
                  {product.description}
                </p>
              ) : (
                <p className={cn("text-sm text-muted-foreground", product.images?.length ? "mt-6" : "")}>
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
                      {v.images?.[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element -- foto de catálogo servida por el API
                        <img
                          src={v.images[0].url}
                          alt={v.images[0].altText?.trim() || v.title}
                          className="h-12 w-12 shrink-0 rounded-md border object-cover"
                        />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{v.title}</p>
                        <p className="font-mono text-micro uppercase text-muted-foreground">
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

            {footer ? (
              <div className="flex shrink-0 flex-col-reverse gap-2 border-t bg-background px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
                {footer}
              </div>
            ) : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Galería de solo lectura: foto grande + tira de miniaturas para cambiarla.
 * Las miniaturas son un `tablist`-lite con botones reales (teclado y lector).
 */
function ProductGallery({ images, title }: { images: ProductDetailImage[]; title: string }) {
  const [index, setIndex] = React.useState(0);
  const current = images[Math.min(index, images.length - 1)] ?? images[0];
  if (!current) return null;
  const alt = (img: ProductDetailImage) => img.altText?.trim() || title;
  return (
    <div className="space-y-2">
      <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- foto de catálogo servida por el API */}
        <img src={current.url} alt={alt(current)} className="h-full w-full object-contain" />
      </div>
      {images.length > 1 ? (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Miniaturas">
          {images.map((img, i) => (
            <li key={img.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Ver foto ${i + 1} de ${images.length}`}
                aria-pressed={i === index}
                className={cn(
                  "block h-14 w-14 overflow-hidden rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  i === index ? "border-foreground" : "border-border hover:border-foreground/60",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- foto de catálogo servida por el API */}
                <img src={img.url} alt="" className="h-full w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <ImageIcon aria-hidden className="h-3.5 w-3.5" />
        {images.length === 1 ? "1 foto" : `Foto ${index + 1} de ${images.length}`}
        {current.altText?.trim() ? <span className="truncate"> · {current.altText.trim()}</span> : null}
      </p>
    </div>
  );
}
