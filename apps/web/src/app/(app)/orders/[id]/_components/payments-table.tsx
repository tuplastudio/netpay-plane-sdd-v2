"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, CreditCard, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
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
import { Money } from "@/components/app/money";

export interface LedgerEntry {
  id: string;
  entryType: string;
  amount: string;
  balanceAfter: string;
  description: string;
  recordedAt: string;
}

export interface OrderPayment {
  id: string;
  status: string;
  amount: string;
  refundedTotal: string;
  currency: string;
  livemode: boolean;
  createdAt: string;
  expiresAt: string;
  capturedAt: string | null;
  failedAt: string | null;
  ledger: LedgerEntry[];
}

function netOf(p: OrderPayment): string {
  const net = Number(p.amount) - Number(p.refundedTotal ?? 0);
  return Number.isFinite(net) ? net.toFixed(2) : p.amount;
}

/**
 * Sesiones de cobro del pedido con su ledger desplegable. El detalle
 * completo (reembolsos, líneas cobradas) sigue viviendo en `/payments/:id`;
 * aquí se muestra lo necesario para entender qué pasó con cada intento sin
 * salir de la venta.
 */
export function PaymentsTable({ payments }: { payments: OrderPayment[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (payments.length === 0) {
    return (
      <EmptyState
        icon={<CreditCard className="h-6 w-6" />}
        title="Sin sesiones de pago"
        description="Al abrir el checkout se crea la sesión de cobro y aparecerá aquí con su estado."
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
          <TableHead>Sesión</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead numeric>Monto</TableHead>
          <TableHead numeric>Reembolsado</TableHead>
          <TableHead>Creada</TableHead>
          <TableHead>Capturado</TableHead>
          <TableHead>
            <span className="sr-only">Acciones</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.map((p) => {
          const expanded = open.has(p.id);
          const panelId = `payment-${p.id}`;
          const refunded = Number(p.refundedTotal ?? 0) > 0;
          return (
            <Fragment key={p.id}>
              <TableRow className="cursor-pointer" onClick={() => toggle(p.id)}>
                <TableCell className="pr-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    aria-label={`${expanded ? "Ocultar" : "Ver"} movimientos de la sesión ${p.id.slice(0, 8)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(p.id);
                    }}
                  >
                    {expanded ? (
                      <ChevronDown aria-hidden className="h-4 w-4" />
                    ) : (
                      <ChevronRight aria-hidden className="h-4 w-4" />
                    )}
                  </Button>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs" title={p.id}>
                    {p.id.slice(0, 8)}…
                  </span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={p.status} domain="payment" withDot />
                </TableCell>
                <TableCell numeric>
                  <Money value={p.amount} currency={p.currency} />
                </TableCell>
                <TableCell numeric>
                  {refunded ? (
                    <Money value={p.refundedTotal} currency={p.currency} className="text-warning-foreground" />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <DateTime value={p.createdAt} className="text-xs text-muted-foreground" />
                </TableCell>
                <TableCell>
                  <DateTime value={p.capturedAt} className="text-xs text-muted-foreground" />
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
                    <Link href={`/payments/${p.id}`} aria-label={`Abrir pago ${p.id.slice(0, 8)}`}>
                      <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                      Abrir
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
              {expanded ? (
                <TableRow interactive={false} id={panelId}>
                  <TableCell colSpan={8} className="bg-muted/40 p-0">
                    <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_16rem]">
                      <div className="overflow-hidden rounded-card border bg-card">
                        {p.ledger.length === 0 ? (
                          <p className="p-4 text-sm text-muted-foreground">
                            Sin movimientos todavía. El cargo se asienta cuando el gateway confirma
                            la captura.
                          </p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow interactive={false}>
                                <TableHead>Movimiento</TableHead>
                                <TableHead numeric>Monto</TableHead>
                                <TableHead numeric>Saldo</TableHead>
                                <TableHead>Descripción</TableHead>
                                <TableHead>Fecha</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {p.ledger.map((l) => (
                                <TableRow key={l.id} interactive={false}>
                                  <TableCell>
                                    <StatusBadge status={l.entryType} domain="ledger" />
                                  </TableCell>
                                  <TableCell numeric>
                                    <Money value={l.amount} currency={p.currency} />
                                  </TableCell>
                                  <TableCell numeric>
                                    <Money
                                      value={l.balanceAfter}
                                      currency={p.currency}
                                      className="text-muted-foreground"
                                    />
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {l.description}
                                  </TableCell>
                                  <TableCell>
                                    <DateTime
                                      value={l.recordedAt}
                                      className="text-xs text-muted-foreground"
                                    />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                      <DescriptionList divided>
                        <FieldRow label="Neto cobrado" numeric emphasis>
                          <Money value={netOf(p)} currency={p.currency} emphasis />
                        </FieldRow>
                        <FieldRow label="Modo">{p.livemode ? "Producción" : "Simulado"}</FieldRow>
                        <FieldRow label="Vence">
                          <DateTime value={p.expiresAt} />
                        </FieldRow>
                        <FieldRow label="Falló">
                          <DateTime value={p.failedAt} />
                        </FieldRow>
                        <FieldRow label="ID" mono>
                          <span className="break-all text-xs">{p.id}</span>
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
