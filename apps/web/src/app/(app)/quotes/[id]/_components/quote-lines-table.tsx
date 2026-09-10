"use client";

import { DetailLinesTable, type DetailLine } from "@/components/app/detail-lines-table";

interface QuoteLine {
  id: string;
  variantId: string;
  sku: string;
  title: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  lineSubtotal: string;
}

export function QuoteLinesTable({
  lines,
  total,
}: {
  lines: QuoteLine[];
  total: string;
}) {
  const normalized: DetailLine[] = lines.map((l) => ({
    key: l.id,
    variantId: l.variantId,
    sku: l.sku,
    title: l.title,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountPct: l.discountPct,
    lineSubtotal: l.lineSubtotal,
  }));

  return (
    <DetailLinesTable
      lines={normalized}
      total={total}
      footerLabel="Total de la cotización"
    />
  );
}
