"use client";

import * as React from "react";
import { Mic, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Redactor del hilo. Va anclado al pie del panel de conversación (fuera del
 * contenedor con scroll), así que nunca se pierde de vista.
 *
 * Semántica de teclado: **Enter envía** — es lo que ya hacía el `<Input>`
 * dentro del `<form>`. Shift+Enter agrega un renglón, algo que antes no era
 * posible porque el control era de una sola línea; no se quitó nada.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onToggleRecording,
  recording,
  busy,
  disabled,
  disabledReason,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onToggleRecording: () => void;
  recording: boolean;
  busy: boolean;
  disabled: boolean;
  disabledReason?: string;
}) {
  const canSend = value.trim().length > 0 && !busy && !disabled;

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // Enter envía; el composer de IME no debe interceptarse a media palabra.
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) onSend();
  }

  return (
    <form
      className="shrink-0 border-t p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      <Label htmlFor="chat-composer" className="sr-only">
        Mensaje para el agente
      </Label>
      <div className="flex items-end gap-2">
        <Textarea
          id="chat-composer"
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-describedby="chat-composer-hint"
          placeholder="Pregunta por un producto, precios o envíos…"
          className="max-h-40 min-h-[2.5rem] flex-1 resize-y py-2"
        />
        <Button
          type="button"
          variant={recording ? "destructive" : "outline"}
          size="icon"
          aria-label={recording ? "Detener la nota de voz" : "Grabar una nota de voz"}
          aria-pressed={recording}
          onClick={onToggleRecording}
          disabled={busy || disabled}
        >
          {recording ? (
            <Square aria-hidden className="h-4 w-4" />
          ) : (
            <Mic aria-hidden className="h-4 w-4" />
          )}
        </Button>
        <Button type="submit" loading={busy} disabled={!canSend}>
          <Send aria-hidden className="h-4 w-4" />
          Enviar
        </Button>
      </div>
      <p id="chat-composer-hint" className="mt-1.5 text-xs text-muted-foreground">
        {disabled && disabledReason
          ? disabledReason
          : "Enter envía · Shift+Enter agrega un renglón"}
      </p>
    </form>
  );
}
