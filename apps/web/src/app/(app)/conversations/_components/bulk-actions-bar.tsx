"use client";
import { useState } from "react";
import { Bot, CheckCircle2, Flag, Hourglass, RotateCcw, Tag, UserCog, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PRIORITY_LABELS } from "./ticket";
import {
  CONVERSATION_PRIORITIES,
  useAgents,
  useBulkAction,
  type BulkAction,
  type ConversationPriority,
} from "./use-conversations";

/**
 * Barra de acciones masivas: aparece en lugar de la fila de vistas cuando hay
 * filas marcadas (mismo lugar, así la barra no empuja la tabla). Todas las
 * acciones pegan a `POST conversations/bulk`; las que sacan hilos de la vista
 * (resolver, devolver al bot) piden confirmación, el resto no.
 */
export function BulkActionsBar({
  ids,
  onClear,
}: {
  ids: string[];
  onClear: () => void;
}) {
  const bulk = useBulkAction();
  const agents = useAgents();
  const [confirm, setConfirm] = useState<"resolve" | "return" | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");

  const run = (action: BulkAction, extra: Partial<{ userId: string; tags: string[]; priority: ConversationPriority }> = {}) =>
    bulk.mutate({ ids, action, ...extra }, { onSuccess: onClear });

  const count = ids.length;
  const busy = bulk.isPending;
  const targets = [...(agents.data ?? [])].sort((a, b) => a.activeConversations - b.activeConversations);

  return (
    <div
      role="toolbar"
      aria-label="Acciones sobre las conversaciones marcadas"
      className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-card border border-border bg-secondary px-2 py-1.5"
    >
      <span className="mr-1 text-xs font-medium text-foreground tabular-nums">
        {count} {count === 1 ? "marcada" : "marcadas"}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy || targets.length === 0}>
            <UserCog aria-hidden className="h-3.5 w-3.5" />
            Asignar
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Asignar a…</DropdownMenuLabel>
          {targets.map((a) => (
            <DropdownMenuItem key={a.userId} onSelect={() => run("assign", { userId: a.userId })}>
              <span className="min-w-0 flex-1 truncate">{a.fullName}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{a.activeConversations}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy}>
            <Flag aria-hidden className="h-3.5 w-3.5" />
            Prioridad
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {CONVERSATION_PRIORITIES.map((p) => (
            <DropdownMenuItem key={p} onSelect={() => run("priority", { priority: p })}>
              {PRIORITY_LABELS[p]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {tagOpen ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const tag = tagDraft.trim().toLowerCase();
            if (!tag) return;
            run("tag", { tags: [tag] });
            setTagDraft("");
            setTagOpen(false);
          }}
        >
          <Input
            autoFocus
            aria-label="Etiqueta a agregar"
            placeholder="etiqueta…"
            maxLength={30}
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setTagOpen(false);
              }
            }}
            className="h-8 w-32 text-xs sm:h-8 sm:text-xs"
          />
          <Button type="submit" size="sm" className="h-8 text-xs" disabled={!tagDraft.trim() || busy}>
            Agregar
          </Button>
        </form>
      ) : (
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={() => setTagOpen(true)}>
          <Tag aria-hidden className="h-3.5 w-3.5" />
          Etiquetar
        </Button>
      )}

      <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={() => run("pending")}>
        <Hourglass aria-hidden className="h-3.5 w-3.5" />
        Pendiente
      </Button>
      <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={() => setConfirm("resolve")}>
        <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
        Resolver
      </Button>
      <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={() => run("reopen")}>
        <RotateCcw aria-hidden className="h-3.5 w-3.5" />
        Reabrir
      </Button>
      <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" disabled={busy} onClick={() => setConfirm("return")}>
        <Bot aria-hidden className="h-3.5 w-3.5" />
        Devolver al bot
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="ml-auto h-8 text-xs"
        onClick={onClear}
        aria-label="Quitar la selección (Esc)"
      >
        <X aria-hidden className="h-3.5 w-3.5" />
        Quitar selección
      </Button>

      <ConfirmDialog
        open={confirm === "resolve"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`¿Resolver ${count} ${count === 1 ? "conversación" : "conversaciones"}?`}
        description="Salen de los pendientes y se libera la asignación. Si el cliente vuelve a escribir, se reabren solas."
        confirmLabel="Resolver"
        variant="default"
        pending={busy}
        onConfirm={() => {
          bulk.mutate({ ids, action: "resolve" }, { onSuccess: () => { setConfirm(null); onClear(); } });
        }}
      />
      <ConfirmDialog
        open={confirm === "return"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`¿Devolver ${count} ${count === 1 ? "conversación" : "conversaciones"} al bot?`}
        description="El bot vuelve a contestar en esos hilos y se suelta la asignación."
        confirmLabel="Devolver al bot"
        variant="default"
        pending={busy}
        onConfirm={() => {
          bulk.mutate({ ids, action: "return" }, { onSuccess: () => { setConfirm(null); onClear(); } });
        }}
      />
    </div>
  );
}
