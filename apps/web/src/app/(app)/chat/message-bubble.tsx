"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { DateTime } from "@/components/app/date-time";
import { Money } from "@/components/app/money";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "./types";

/**
 * Una burbuja del hilo. El sentido del mensaje se comunica por tres vías a la
 * vez —alineación, color y una etiqueta textual— para que no dependa solo del
 * color: `user` es saliente (OUTBOUND) y `assistant` entrante (INBOUND).
 */
export function MessageBubble({
  message,
  onPick,
  disabled,
}: {
  message: ChatMessage;
  onPick: (text: string) => void;
  disabled: boolean;
}) {
  const isOutbound = message.role === "user";
  const author = isOutbound ? "Tú" : "Agente";

  return (
    <li className={cn("flex flex-col gap-1", isOutbound ? "items-end" : "items-start")}>
      <div className="flex max-w-[85%] flex-col gap-2 sm:max-w-[75%]">
        <div
          className={cn(
            "flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground",
            isOutbound && "justify-end",
          )}
        >
          <span className="font-medium text-foreground">{author}</span>
          <DateTime value={message.createdAt} className="text-xs" />
          {message.status && message.status !== "DELIVERED" ? (
            <StatusBadge status={message.status} domain="message" size="sm" />
          ) : null}
        </div>

        <div
          className={cn(
            "overflow-hidden whitespace-pre-line break-words rounded-card px-3 py-2 text-sm",
            isOutbound
              ? "rounded-br-sm bg-primary-strong text-primary-foreground"
              : "rounded-bl-sm bg-muted text-foreground",
            message.status === "FAILED" && "opacity-60",
          )}
        >
          {message.content}
        </div>

        {message.meta?.candidates && message.meta.candidates.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {message.meta.candidates.slice(0, 3).map((candidate, index) => (
              <Button
                key={candidate.variantId}
                variant="outline"
                disabled={disabled}
                onClick={() => onPick(`opción ${index + 1}`)}
                className="h-auto w-full flex-col items-start gap-0.5 whitespace-normal p-2 text-left text-xs font-normal"
              >
                <span className="font-medium">
                  {candidate.variant?.productTitle ? `${candidate.variant.productTitle} — ` : ""}
                  {candidate.variant?.title}
                </span>
                <span className="text-muted-foreground">
                  {candidate.variant?.sku} · <Money value={candidate.variant?.price} />
                </span>
                {candidate.conflicts.length > 0 && (
                  <span className="text-warning-foreground">{candidate.conflicts.join(", ")}</span>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {candidate.reasons.slice(0, 2).join(" · ")}
                </span>
              </Button>
            ))}
          </div>
        )}

        {!isOutbound && message.meta?.suggestions && message.meta.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {message.meta.suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onPick(suggestion)}
                className="h-8 rounded-pill px-3 text-xs font-normal"
              >
                {suggestion}
              </Button>
            ))}
          </div>
        )}

        {!isOutbound && message.meta?.knowledgeRefs && message.meta.knowledgeRefs.length > 0 && (
          <p className="break-words text-[11px] text-muted-foreground">
            Fuente: {message.meta.knowledgeRefs.join(" · ")}
          </p>
        )}

        {!isOutbound && message.meta?.checkout?.linkRef ? (
          <Button asChild size="sm" className="w-fit">
            <a href={message.meta.checkout.linkRef} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              Abrir enlace de pago
              {message.meta.quote?.total ? (
                <>
                  {" · "}
                  <Money value={message.meta.quote.total} />
                </>
              ) : null}
            </a>
          </Button>
        ) : null}

        {!isOutbound && message.meta?.quote?.linkRef && !message.meta?.checkout?.linkRef ? (
          <Button asChild size="sm" variant="outline" className="w-fit">
            <a href={message.meta.quote.linkRef} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              Ver cotización · <Money value={message.meta.quote.total} />
            </a>
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Indicador de "el agente está escribiendo". Decorativo: el anuncio lo da el
 *  `role="log"` del hilo cuando llega el mensaje real. */
export function TypingBubble() {
  return (
    <li className="flex items-start">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Agente</span>
        <div className="flex gap-1 rounded-card rounded-bl-sm bg-muted px-3 py-3">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              aria-hidden
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
          <span className="sr-only">El agente está escribiendo…</span>
        </div>
      </div>
    </li>
  );
}
