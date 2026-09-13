"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, ExternalLink, RefreshCw, ShoppingCart } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonText } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Section } from "@/components/app/section";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { Money } from "@/components/app/money";
import type { AgentCart, AgentHealth, AgentResponse, CartLine, ChatMessage } from "./types";

export function ContextPanels({
  cart,
  carts = [],
  quote,
  checkout,
  messages,
  health,
  catalogError,
  onRetryHealth,
  onRetryCatalog,
  retryingHealth,
  retryingCatalog,
}: {
  cart: CartLine[];
  /** Todos los pedidos abiertos; se pintan aparte solo cuando hay más de uno. */
  carts?: AgentCart[];
  quote: AgentResponse["quote"];
  checkout: AgentResponse["checkout"];
  messages: ChatMessage[];
  health: {
    data: AgentHealth | undefined;
    isLoading: boolean;
    isError: boolean;
    isFetching: boolean;
  };
  catalogError: boolean;
  onRetryHealth: () => void;
  onRetryCatalog: () => void;
  retryingHealth: boolean;
  retryingCatalog: boolean;
}) {
  const [showTrace, setShowTrace] = React.useState(false);
  const traceCalls = messages.flatMap((message) => message.meta?.tools ?? []).slice(-8);

  const engineLabel = health.data?.llm?.live
    ? `${health.data.llm.model}${health.data.llm.toolCalling ? " · tools" : ""}`
    : "Motor determinista (sin OPENROUTER_KEY)";

  return (
    <div className="space-y-4">
      {catalogError ? (
        <Alert variant="warning">
          <AlertCircle aria-hidden />
          <AlertTitle>Catálogo no cargado</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              No pude leer el catálogo del portal. Si el agente tampoco tiene su propia llave, va a
              responder sin productos.
            </p>
            <Button variant="outline" size="sm" loading={retryingCatalog} onClick={onRetryCatalog}>
              <RefreshCw aria-hidden className="h-3.5 w-3.5" />
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {carts.length > 1 ? (
        <Section
          title={`Pedidos abiertos (${carts.length})`}
          contentClassName="space-y-3 text-sm"
        >
          <p className="text-xs text-muted-foreground">
            El cliente lleva varios pedidos a la vez. Cada uno tiene su propio carrito, total,
            cotización y enlace de pago; el agente no los mezcla.
          </p>
          <ul className="space-y-3">
            {carts.map((entry) => {
              const total = (entry.totals as { totals?: { total?: string } } | null)?.totals?.total
                ?? (entry.totals as { total?: string } | null)?.total;
              return (
                <li key={entry.cartId} className="rounded-md border p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">[{entry.cartId}]</span>
                    <StatusBadge status={entry.stage ?? "ARMANDO_CARRITO"} />
                  </div>
                  <ul className="space-y-1 text-xs">
                    {entry.lines.map((line) => (
                      <li key={line.variantId} className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate">
                          <span className="tabular-nums">{line.quantity}</span> × {line.title}
                        </span>
                        <span className="shrink-0 font-mono text-muted-foreground">{line.sku}</span>
                      </li>
                    ))}
                  </ul>
                  {total ? (
                    <div className="mt-1 text-xs">
                      Total: <Money value={total} />
                    </div>
                  ) : null}
                  {entry.quote ? (
                    <a
                      className="mt-1 block text-xs underline"
                      href={entry.quote.linkRef}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Cotización {entry.quote.quoteId.slice(0, 8)}
                    </a>
                  ) : null}
                  {entry.checkout ? (
                    <a
                      className="mt-1 block text-xs underline"
                      href={entry.checkout.linkRef}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Enlace de pago
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      <Section title={carts.length > 1 ? "Carrito activo" : "Carrito en borrador"} contentClassName="text-sm">
        {cart.length === 0 ? (
          <EmptyState
            className="px-0 py-6"
            icon={<ShoppingCart className="h-5 w-5" />}
            title="Todavía sin líneas"
            description="Cuando el agente agregue productos aparecen aquí."
          />
        ) : (
          <ul className="space-y-1.5 text-xs">
            {cart.map((line) => (
              <li key={line.variantId} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className="tabular-nums">{line.quantity}</span> × {line.title}
                </span>
                <span className="shrink-0 font-mono text-muted-foreground">{line.sku}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {quote && (
        <Section title="Cotización emitida" contentClassName="space-y-3 text-sm">
          <DescriptionList>
            <FieldRow label="Total" numeric emphasis>
              {quote.total ? <Money value={quote.total} /> : <span className="text-muted-foreground">—</span>}
            </FieldRow>
          </DescriptionList>
          <Button asChild variant="outline" size="sm" className="w-full">
            <a href={quote.linkRef} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              Ver cotización pública
            </a>
          </Button>
        </Section>
      )}

      {checkout && (
        <Section title="Enlace de pago" contentClassName="text-sm">
          <Button asChild size="sm" className="w-full">
            <a href={checkout.linkRef} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              Abrir checkout
            </a>
          </Button>
        </Section>
      )}

      <Section title="Motor" contentClassName="space-y-3 text-sm">
        {health.isError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertTitle>Agente no disponible</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>No respondió el healthcheck. El chat no va a contestar hasta que vuelva.</p>
              <Button variant="outline" size="sm" loading={retryingHealth} onClick={onRetryHealth}>
                <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        ) : health.isLoading ? (
          <SkeletonText lines={3} label="Cargando el estado del agente…" />
        ) : (
          <>
            <p className="break-words text-xs text-muted-foreground">{engineLabel}</p>
            <p className="text-xs text-muted-foreground">
              <span className="tabular-nums">{health.data?.knowledge?.docs ?? 0}</span> documentos ·{" "}
              <span className="tabular-nums">{health.data?.knowledge?.chunks ?? 0}</span> secciones
              del negocio
            </p>
          </>
        )}

        <div className="flex flex-col items-start gap-1">
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            aria-expanded={showTrace}
            aria-controls={showTrace ? "agent-trace" : undefined}
            onClick={() => setShowTrace((value) => !value)}
          >
            {showTrace ? "Ocultar" : "Ver"} herramientas usadas
          </Button>
          <Button variant="link" size="sm" className="h-auto p-0" asChild>
            <Link href="/admin">Editar conocimiento del negocio</Link>
          </Button>
        </div>
      </Section>

      {showTrace && (
        <Section id="agent-trace" title="Traza" contentClassName="text-sm">
          {traceCalls.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              El agente todavía no ejecutó herramientas en este hilo.
            </p>
          ) : (
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {traceCalls.map((call, index) => (
                <li key={`${call.tool}-${index}`} className="flex items-center gap-2">
                  <StatusBadge
                    status={call.ok ? "SUCCEEDED" : "FAILED"}
                    domain="job"
                    size="sm"
                    label={call.ok ? "ok" : "falló"}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono">{call.tool}</span>
                  <span className="shrink-0 tabular-nums">{call.latencyMs} ms</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}
