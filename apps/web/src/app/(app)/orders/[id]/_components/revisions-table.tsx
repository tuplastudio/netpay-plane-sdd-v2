"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DELIVERY_MODE_LABELS, StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DateTime } from "@/components/app/date-time";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { DetailLinesTable } from "@/components/app/detail-lines-table";
import { Money } from "@/components/app/money";

export interface RevisionLine {
  variantId: string;
  quantity: string;
  sku: string | null;
  title: string | null;
  productTitle: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
}

export interface OrderRevision {
  id: string;
  revisionNumber: number;
  status: string;
  total: string;
  deliveryMode: string;
  addressId: string | null;
  acceptedAt: string | null;
  createdAt: string;
  expiresAt: string;
  lines: RevisionLine[];
}

/**
 * Historial de revisiones del pedido. Cada fila se expande para ver las
 * líneas exactas que se reservaron en esa propuesta y sus fechas: la vigente
 * (`currentRevisionId`) queda marcada para distinguirla de las que ya
 * vencieron o se cancelaron al renegociar.
 */
export function RevisionsTable({
  revisions,
  currentRevisionId,
}: {
  revisions: OrderRevision[];
  currentRevisionId: string | null;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (revisions.length === 0) {
    return (
      <EmptyState
        icon={<History className="h-6 w-6" />}
        title="Sin revisiones"
        description="Cuando se renegocie el pedido, cada propuesta enviada al cliente quedará listada aquí."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow interactive={false}>
          <TableHead className="w-8">
            <span className="sr-only">Expandir</span>
          </TableHead>
          <TableHead>#</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Entrega</TableHead>
          <TableHead numeric>Líneas</TableHead>
          <TableHead numeric>Total</TableHead>
          <TableHead>Creada</TableHead>
          <TableHead>Vence</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {revisions.map((r) => {
          const expanded = open.has(r.id);
          const isCurrent = r.id === currentRevisionId;
          const panelId = `revision-${r.id}`;
          return (
            <Fragment key={r.id}>
              <TableRow
                className={cn("cursor-pointer", isCurrent && "bg-primary-subtle/40")}
                onClick={() => toggle(r.id)}
              >
                <TableCell className="pr-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    aria-label={`${expanded ? "Ocultar" : "Ver"} detalle de la revisión ${r.revisionNumber}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(r.id);
                    }}
                  >
                    {expanded ? (
                      <ChevronDown aria-hidden className="h-4 w-4" />
                    ) : (
                      <ChevronRight aria-hidden className="h-4 w-4" />
                    )}
                  </Button>
                </TableCell>
                <TableCell className="tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    {r.revisionNumber}
                    {isCurrent ? (
                      <span className="rounded bg-primary-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-strong">
                        Vigente
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.status} domain="revision" />
                </TableCell>
                <TableCell>{DELIVERY_MODE_LABELS[r.deliveryMode] ?? r.deliveryMode}</TableCell>
                <TableCell numeric>{r.lines.length}</TableCell>
                <TableCell numeric>
                  <Money value={r.total} />
                </TableCell>
                <TableCell>
                  <DateTime value={r.createdAt} className="text-xs text-muted-foreground" />
                </TableCell>
                <TableCell>
                  <DateTime value={r.expiresAt} className="text-xs text-muted-foreground" />
                </TableCell>
              </TableRow>
              {expanded ? (
                <TableRow interactive={false} id={panelId}>
                  <TableCell colSpan={8} className="bg-muted/40 p-0">
                    <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_16rem]">
                      <div className="overflow-hidden rounded-card border bg-card">
                        {r.lines.length === 0 ? (
                          <p className="p-4 text-sm text-muted-foreground">
                            Esta revisión no registró líneas: se creó al aceptar la cotización y el
                            checkout todavía no se había iniciado.
                          </p>
                        ) : (
                          <DetailLinesTable
                            lines={r.lines.map((l) => ({
                              key: `${r.id}-${l.variantId}`,
                              variantId: l.variantId,
                              sku: l.sku ?? "—",
                              title: l.productTitle
                                ? `${l.productTitle} — ${l.title ?? l.variantId.slice(0, 8)}`
                                : (l.title ?? l.variantId.slice(0, 8)),
                              quantity: l.quantity,
                              unitPrice: l.unitPrice ?? "0",
                              lineSubtotal: l.lineTotal ?? "0",
                            }))}
                            total={r.total}
                            footerLabel="Total de la revisión"
                            showDiscount={false}
                          />
                        )}
                      </div>
                      <DescriptionList divided>
                        <FieldRow label="ID" mono>
                          <span className="break-all text-xs">{r.id}</span>
                        </FieldRow>
                        <FieldRow label="Aceptada">
                          <DateTime value={r.acceptedAt} />
                        </FieldRow>
                        <FieldRow label="Dirección" mono>
                          {r.addressId ? r.addressId.slice(0, 8) : null}
                        </FieldRow>
                      </DescriptionList>
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
