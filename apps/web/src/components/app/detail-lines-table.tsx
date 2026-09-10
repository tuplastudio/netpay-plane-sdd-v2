"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Money } from "@/components/app/money";
import {
  ProductDetailSheet,
  type ProductDetailProduct,
  type ProductDetailVariant,
} from "@/components/app/product-detail-sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface DetailLine {
  /** Identificador único de la línea en la fuente (QuoteLine.id o slot estable). */
  key: string;
  variantId: string;
  sku: string;
  /** Título que se muestra en la tabla. Si el backend ya lo trae con "Variante", se respeta. */
  title: string;
  quantity: string;
  unitPrice: string;
  /** `discountPct` es opcional: solo lo muestra cuando viene en el payload. */
  discountPct?: string;
  lineSubtotal: string;
}

interface CatalogProduct {
  id: string;
  sku: string;
  title: string;
  description: string | null;
  variants: ProductDetailVariant[];
}

function useProductsByVariant() {
  return useQuery({
    queryKey: ["products", { _use: "lookup-by-variant" }],
    queryFn: async (): Promise<CatalogProduct[]> => {
      const res = await api.get<{ data: CatalogProduct[] }>("/catalog/products", {
        params: { status: "ACTIVE" },
      });
      return res.data.data;
    },
    staleTime: 5 * 60_000,
  });
}

interface LinesTableProps {
  lines: DetailLine[];
  /** Total a mostrar en el footer (String decimal del backend). */
  total: string;
  /** Etiqueta del footer. Default "Total". */
  footerLabel?: string;
  /**
   * Mostrar la columna "Desc%". Por defecto true.
   */
  showDiscount?: boolean;
  /** Currency override del componente Money. */
  currency?: string;
}

/**
 * Tabla de líneas clickeable: tocar una fila abre `ProductDetailSheet`
 * con el detalle del producto (descripción, claves SAT si las tiene,
 * todas sus variantes con precio y stock). Reusada por el detalle de
 * cotización y de pedido.
 *
 * El catálogo se carga una vez y se mapea por variantId: si la línea
 * apunta a una variante del catálogo activo, la hoja muestra el producto
 * real; si no (caso raro: catálogo archivado tras venderse), cae a un
 * fallback con los datos que ya trae la línea.
 */
export function DetailLinesTable({
  lines,
  total,
  footerLabel = "Total",
  showDiscount = true,
  currency,
}: LinesTableProps) {
  const products = useProductsByVariant();
  const [selected, setSelected] = useState<DetailLine | null>(null);

  const byVariant = new Map<string, CatalogProduct>();
  for (const p of products.data ?? []) {
    for (const v of p.variants) byVariant.set(v.id, p);
  }

  const selectedProduct: ProductDetailProduct | null = (() => {
    if (!selected) return null;
    const p = byVariant.get(selected.variantId);
    if (p) return p;
    // Fallback: la línea del backend puede no estar en /catalog/products
    // porque el producto se archivó, pero igual mostramos lo que sabemos.
    return {
      sku: selected.sku,
      title: selected.title,
      description: null,
      variants: [
        {
          id: selected.variantId,
          sku: selected.sku,
          title: selected.title,
          price: selected.unitPrice,
          stock: null,
        },
      ],
    };
  })();

  function rowFor(line: DetailLine) {
    return (
      <TableRow
        key={line.key}
        onClick={() => setSelected(line)}
        className="cursor-pointer"
        tabIndex={0}
        role="button"
        aria-label={`Ver detalle de ${line.title}`}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelected(line);
          }
        }}
      >
        <TableCell className="font-mono text-xs">{line.sku}</TableCell>
        <TableCell>
          <span className="font-medium">{line.title}</span>
        </TableCell>
        <TableCell numeric>{line.quantity}</TableCell>
        <TableCell numeric>
          <Money value={line.unitPrice} {...(currency ? { currency } : {})} />
        </TableCell>
        {showDiscount ? (
          <TableCell numeric>{line.discountPct ?? "0"}%</TableCell>
        ) : null}
        <TableCell numeric>
          <Money value={line.lineSubtotal} {...(currency ? { currency } : {})} />
        </TableCell>
      </TableRow>
    );
  }

  const totalColSpan = showDiscount ? 5 : 4;

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow interactive={false}>
            <TableHead>SKU</TableHead>
            <TableHead>Producto</TableHead>
            <TableHead numeric>Cantidad</TableHead>
            <TableHead numeric>Precio</TableHead>
            {showDiscount ? <TableHead numeric>Desc%</TableHead> : null}
            <TableHead numeric>Subtotal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map(rowFor)}
        </TableBody>
        <TableFooter>
          <TableRow interactive={false}>
            <TableCell colSpan={totalColSpan} className="text-right font-semibold">
              {footerLabel}
            </TableCell>
            <TableCell numeric>
              <Money value={total} emphasis {...(currency ? { currency } : {})} />
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>

      <ProductDetailSheet
        product={selectedProduct}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </>
  );
}