"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDebounced } from "./use-debounced";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  Inbox,
  MessagesSquare,
  RotateCcw,
  Search,
  SearchX,
  UserCog,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ConversationsFilters } from "./conversations-filters";
import { ConversationsList } from "./conversations-list";
import { ConversationThread } from "./conversation-thread";
import { ConversationContextPanel } from "./conversation-context-panel";
import { ShortcutsHelp } from "./shortcuts-help";
import { useConversationFilters } from "./use-conversation-filters";
import {
  useAgents,
  useClaim,
  useConversations,
  useMe,
  useSetConversationStatus,
  type Conversation,
  type ConversationStats,
  type InboxView,
  type SortFilter,
} from "./use-conversations";
import { cn } from "@/lib/utils";

const LIST_SHORTCUTS = [
  { keys: "↑ / ↓", label: "Moverse entre conversaciones" },
  { keys: "Enter", label: "Abrir la conversación enfocada" },
  { keys: "Inicio / Fin", label: "Ir a la primera / última" },
  { keys: "/ o Ctrl/Cmd+K", label: "Buscar" },
];

const SORT_LABELS: Record<SortFilter, string> = {
  recent: "Más reciente",
  oldest: "Más antiguo esperando",
};

const INBOX_TABS: Array<{ value: InboxView; label: string }> = [
  { value: "inbox", label: "Bandeja" },
  { value: "queue", label: "Cola" },
  { value: "byAgent", label: "Por agente" },
];

const EMPTY_BY_VIEW: Record<InboxView, { title: string; description: string }> = {
  inbox: {
    title: "Sin conversaciones todavía",
    description: "En cuanto alguien escriba al número conectado, el hilo aparecerá aquí.",
  },
  queue: {
    title: "Sin hilos en espera",
    description: "Ningún hilo transferido está sin asignar ahora mismo.",
  },
  byAgent: {
    title: "Sin conversaciones asignadas",
    description: "Ningún hilo transferido tiene un agente asignado todavía.",
  },
};

/**
 * Tira compacta de KPIs en una sola línea, pensada para vivir sobre la tabla.
 * Toma el lugar del `Section > 4 StatTile` antiguo: la bandeja quiere tabla,
 * no mosaicos; los cuatro números viven en una línea de píldoras que se leen
 * de un vistazo y dejan respirar al listado.
 */
function StatsStrip({
  query,
}: {
  query: { data?: { stats?: ConversationStats }; isLoading: boolean; isError: boolean };
}) {
  const stats = query.data?.stats;
  const open = stats?.open ?? 0;
  const handedOff = stats?.handedOff ?? 0;
  const unanswered = stats?.unanswered ?? 0;
  const today = stats?.today ?? 0;
  const loading = query.isLoading;

  const items = [
    { key: "open", label: "Abiertas", value: open, icon: MessagesSquare, tone: "info" as const },
    {
      key: "person",
      label: "Con persona",
      value: handedOff,
      icon: UserCog,
      tone: (handedOff > 0 ? "warning" : "neutral") as "warning" | "neutral",
    },
    {
      key: "unans",
      label: "Sin responder",
      value: unanswered,
      icon: Inbox,
      tone: (unanswered > 0 ? "destructive" : "neutral") as "destructive" | "neutral",
    },
    { key: "today", label: "Hoy", value: today, icon: CalendarDays, tone: "neutral" as const },
  ];

  return (
    <div
      aria-label="Resumen de conversaciones"
      className="flex shrink-0 flex-nowrap items-center gap-1.5 whitespace-nowrap text-xs"
    >
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div
            key={it.key}
            title={`${it.label}: ${it.value}`}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-pill border border-border bg-card px-2 py-0.5 tabular-nums",
              query.isError && "text-destructive",
            )}
          >
            <Icon aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="font-semibold leading-none text-foreground">
              {loading ? "…" : it.value}
            </span>
            <span className="hidden text-muted-foreground sm:inline">{it.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Bandeja **compacta**: la tabla come el ~80 % del alto, el resto vive en una
 * barra de herramientas de tres filas que se ve completa sin scrollear la página.
 *
 *   Fila 1 — título + atajos + tira de KPIs (chips).
 *   Fila 2 — pestañas + buscador + orden + estado + "Más filtros" + "Limpiar".
 *   Fila 3 — "Más filtros" desplegado (sin card propio, en línea).
 *   Resto  — la tabla: scroll propio, encabezado pegado, vista del 80 % del alto.
 *
 * Al abrir un hilo (`?id=…`) el panel central y la columna de contexto ocupan
 * la página completa: ese modo NO entra en la barra compacta.
 */
export function ConversationsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const me = useMe();
  const { filters, setFilters, clearFilters, filtered } = useConversationFilters();
  const list = useConversations(filters);

  /** Buffer local del input de búsqueda para no pegar a la API en cada tecla. */
  const [searchInput, setSearchInput] = useState(filters.q);
  const debouncedSearch = useDebounced(searchInput.trim(), 250);
  useEffect(() => {
    if (debouncedSearch !== filters.q) setFilters({ q: debouncedSearch });
    // Solo nos importa el debounced; si cambia filters.q por otra vía (URL)
    // y no coincide con el input que tenemos en pantalla, lo reflejamos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);
  useEffect(() => {
    setSearchInput(filters.q);
  }, [filters.q]);

  const selectedId = searchParams.get("id") ?? undefined;
  const current = list.data?.data.find((c) => c.id === selectedId) ?? null;

  const selectConversation = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (id) next.set("id", id);
      else next.delete("id");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const [customerSheetOpen, setCustomerSheetOpen] = useState(false);

  const view = filters.view;
  const agents = useAgents();
  const claim = useClaim();
  const setStatus = useSetConversationStatus();
  const [confirmClose, setConfirmClose] = useState<Conversation | null>(null);

  const stats = list.data?.stats;

  // `/` o Cmd/Ctrl+K enfocan la búsqueda desde cualquier parte de la página
  // mientras no se esté escribiendo en un input/textarea: si el hilo está
  // abierto, primero vuelve al listado para que el buscador exista y enfocarlo
  // tenga sentido.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isShortcut = e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k");
      if (!isShortcut) return;
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      e.preventDefault();
      if (current) selectConversation(null);
      requestAnimationFrame(() => {
        const input = document.getElementById("conversations-q") as HTMLInputElement | null;
        input?.focus();
        input?.select();
      });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [current, selectConversation]);

  const renderTrailingAction = useCallback(
    (c: Conversation) => (
      <div className="flex items-center justify-end gap-1">
        {!c.handoffUserId && c.status !== "CLOSED" ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            loading={claim.isPending && claim.variables === c.id}
            onClick={(e) => {
              e.stopPropagation();
              claim.mutate(c.id);
            }}
          >
            Tomar
          </Button>
        ) : null}
        {c.status === "CLOSED" ? (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label={`Reabrir la conversación con ${c.customer?.fullName ?? c.externalPhone}`}
            title="Reabrir"
            loading={setStatus.isPending && setStatus.variables?.id === c.id}
            onClick={(e) => {
              e.stopPropagation();
              setStatus.mutate({ id: c.id, status: "OPEN" });
            }}
          >
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label={`Cerrar la conversación con ${c.customer?.fullName ?? c.externalPhone}`}
            title="Cerrar"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmClose(c);
            }}
          >
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    ),
    [claim, setStatus],
  );

  // Contadores que viven en cada `TabsTrigger` (los "(N)" al final).
  const tabCount = useMemo(
    () => ({
      inbox: stats ? stats.open + stats.handedOff : undefined,
      queue: stats?.queue,
      byAgent: stats?.assigned,
    }),
    [stats],
  );

  // ============== DETALLE (hilo abierto) ==============
  if (current) {
    return (
      <>
        <header className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <h1 className="text-base font-semibold tracking-tight">Conversaciones</h1>
          <p className="text-xs text-muted-foreground">
            Hilo seleccionado. Vuelve a la bandeja con Esc.
          </p>
        </header>
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-card border bg-card shadow-airbnb">
            <div className="flex items-center justify-end border-b border-border p-2 lg:hidden">
              <Button variant="outline" size="sm" onClick={() => setCustomerSheetOpen(true)}>
                <UserRound aria-hidden className="h-3.5 w-3.5" />
                Cliente
              </Button>
            </div>
            <ConversationThread
              conversation={current}
              userId={me.data?.id}
              onBack={() => selectConversation(null)}
            />
          </div>
          <aside
            aria-label="Contexto del cliente"
            className="hidden min-h-0 overflow-y-auto rounded-card border bg-card shadow-airbnb lg:block"
          >
            <ConversationContextPanel conversation={current} />
          </aside>
          <Sheet open={customerSheetOpen} onOpenChange={setCustomerSheetOpen}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Cliente</SheetTitle>
              </SheetHeader>
              <div className="-mx-6 mt-2">
                <ConversationContextPanel conversation={current} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </>
    );
  }

  // ============== LISTADO (vista central) ==============
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Fila 1: título + chips de KPIs (una sola línea, sin wrap). */}
      <div className="flex shrink-0 flex-nowrap items-center justify-between gap-3">
        <div className="flex min-w-0 shrink items-baseline gap-2 whitespace-nowrap">
          <h1 className="text-base font-semibold tracking-tight">Conversaciones</h1>
          <p className="hidden text-xs text-muted-foreground xl:block">
            Bandeja de WhatsApp; filtros, orden y vista viven en la URL.
          </p>
        </div>
        <StatsStrip query={list} />
      </div>

      {/* Fila 2: toolbar de una sola línea. nowrap + shrink-0 en cada botón
          para que la barra no se rompa en varias filas en pantallas más
          estrechas (las dos mitades pueden ceder ancho pero no envolver). */}
      <div className="relative flex shrink-0 flex-nowrap items-center justify-between gap-2">
        <Tabs
          value={view}
          defaultValue="inbox"
          onValueChange={(v) => setFilters({ view: v as InboxView })}
        >
          <TabsList className="h-9 shrink-0">
            {INBOX_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="h-7 whitespace-nowrap text-xs">
                {t.label}
                {typeof tabCount[t.value] === "number"
                  ? ` (${tabCount[t.value]})`
                  : ""}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
          <div className="relative w-44 shrink-0">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="conversations-q"
              type="search"
              inputMode="tel"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar… ( / )"
              className="h-8 pl-7 text-xs"
              aria-label="Buscar conversaciones"
              autoComplete="off"
            />
          </div>
          <Select
            aria-label="Ordenar por"
            value={filters.sort}
            onChange={(e) => setFilters({ sort: e.target.value as SortFilter })}
            className="h-8 w-32 shrink-0 text-xs"
          >
            {(Object.keys(SORT_LABELS) as SortFilter[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </Select>
          <ConversationsFilters
            filters={filters}
            filtered={filtered}
            conversations={list.data?.data}
            onChange={setFilters}
            onClear={clearFilters}
          />
          <ShortcutsHelp items={LIST_SHORTCUTS} label="Atajos de la bandeja" />
        </div>
      </div>

      {/* Fila 3 (opcional): chips de agentes solo cuando view=byAgent. Cuesta
          solo ~30 px (un renglón) en vez de los ~120 px del StatTile. */}
      {view === "byAgent" && agents.data && agents.data.length > 0 ? (
        <div className="flex shrink-0 flex-nowrap items-center gap-1.5 whitespace-nowrap text-xs">
          <span className="text-muted-foreground">Agente:</span>
          {agents.data.map((a) => {
            const active = filters.agent === a.userId;
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilters({ agent: active ? "" : a.userId })}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-pill border px-2 py-0.5 tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-foreground hover:bg-muted",
                )}
              >
                <span className="font-semibold">{a.activeConversations}</span>
                <span className={active ? "text-background/80" : "text-muted-foreground"}>
                  {a.fullName}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* ~80 % del alto: tabla con su propio scroll y encabezado pegado.
          `min-h-0` es obligatorio: sin él el flex-1 ignora el alto disponible
          y la página scrollea en vez de la tabla. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border bg-card shadow-airbnb">
        <ConversationsList
          query={list}
          filtered={filtered}
          selectedId={selectedId}
          onSelect={(c) => selectConversation(c.id)}
          onClearFilters={clearFilters}
          emptyTitle={filtered ? undefined : EMPTY_BY_VIEW[view].title}
          emptyDescription={filtered ? undefined : EMPTY_BY_VIEW[view].description}
          renderTrailingAction={renderTrailingAction}
          emptyIcon={
            filtered ? <SearchX className="h-6 w-6" /> : <MessagesSquare className="h-6 w-6" />
          }
        />
      </div>

      <ConfirmDialog
        open={!!confirmClose}
        onOpenChange={(open) => {
          if (!open) setConfirmClose(null);
        }}
        title="¿Cerrar la conversación?"
        description="El hilo sale de los pendientes y se libera la asignación. Si el cliente vuelve a escribir, se reabre solo."
        confirmLabel="Cerrar conversación"
        variant="default"
        pending={setStatus.isPending}
        onConfirm={() => {
          if (!confirmClose) return;
          setStatus.mutate(
            { id: confirmClose.id, status: "CLOSED" },
            { onSuccess: () => setConfirmClose(null) },
          );
        }}
      />
    </div>
  );
}
