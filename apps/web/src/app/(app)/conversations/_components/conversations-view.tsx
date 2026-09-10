"use client";
import { useState } from "react";
import { ConversationsSummary } from "./conversations-summary";
import { ConversationsFilters } from "./conversations-filters";
import { ConversationsTable } from "./conversations-table";
import { ConversationSheet } from "./conversation-sheet";
import { useConversationFilters } from "./use-conversation-filters";
import { useConversations, useMe, type Conversation } from "./use-conversations";

/**
 * Cuerpo de la bandeja: KPIs, filtros (en la URL), tabla y panel del hilo.
 * Va separado de la página porque `useSearchParams` exige un `Suspense`.
 */
export function ConversationsView() {
  const me = useMe();
  const { filters, setFilters, clearFilters, filtered } = useConversationFilters();
  const list = useConversations(filters);

  // La fila que abre el panel es una copia; tras transferir/devolver, el
  // estado fresco vive en la lista cacheada. Si la fila dejó de coincidir con
  // los filtros (p. ej. se transfirió estando en "Con el agente"), se conserva
  // la copia para que el panel no se cierre solo.
  const [active, setActive] = useState<Conversation | null>(null);
  const current = active ? (list.data?.data.find((c) => c.id === active.id) ?? active) : null;

  return (
    <>
      <div className="space-y-6">
        <ConversationsSummary query={list} />
        <ConversationsFilters
          filters={filters}
          filtered={filtered}
          onChange={setFilters}
          onClear={clearFilters}
        />
        <ConversationsTable
          query={list}
          filtered={filtered}
          userId={me.data?.id}
          onOpenConversation={setActive}
          onClearFilters={clearFilters}
        />
      </div>
      <ConversationSheet
        conversation={current}
        userId={me.data?.id}
        onOpenChange={(open) => !open && setActive(null)}
      />
    </>
  );
}
