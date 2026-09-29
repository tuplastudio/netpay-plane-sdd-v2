"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDebounced } from "./use-debounced";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  BarChart3,
  CheckCircle2,
  Hourglass,
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
import { TablePager } from "@/components/app/table-pager";
import { ConversationsFilters } from "./conversations-filters";
import { ConversationsList } from "./conversations-list";
import { ConversationThread } from "./conversation-thread";
import { ConversationContextPanel } from "./conversation-context-panel";
import { ShortcutsHelp } from "./shortcuts-help";
import { useConversationFilters } from "./use-conversation-filters";
import {
  useAgents,
  useClaim,
  useConversationById,
  useConversations,
  useMe,
  useSetConversationStatus,
  type Conversation,
  type ConversationStats,
  type InboxView,
  type SortFilter,
} from "./use-conversations";
import { cn } from "@/lib/utils";

/** Filas por página del paginado en cliente (ver comentario junto a `page`). */
const PAGE_SIZE = 20;

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

/** Fondo del chip del ícono por tono; a juego con `StatTile`/`ICON_TONE`. */
const STAT_ICON_TONE: Record<"info" | "warning" | "destructive" | "neutral", string> = {
  info: "bg-info-subtle text-info-foreground",
  warning: "bg-warning-subtle text-warning-foreground",
  destructive: "bg-destructive-subtle text-destructive-subtle-foreground",
  neutral: "bg-muted text-muted-foreground",
};
const STAT_VALUE_TONE: Record<"info" | "warning" | "destructive" | "neutral", string> = {
  info: "text-info-foreground",
  warning: "text-warning-foreground",
  destructive: "text-destructive-subtle-foreground",
  neutral: "text-foreground",
};

/**
 * Tira compacta de KPIs en una sola línea, pensada para vivir sobre la tabla.
 * Toma el lugar del `Section > 4 StatTile` antiguo: la bandeja quiere tabla,
 * no mosaicos, así que en vez de tarjetas altas esto es UNA sola barra con
 * los cinco números adentro, separados por líneas divisorias — mismo alto
 * que antes (una línea), pero con el mismo lenguaje visual de ícono-con-tono
 * que `StatTile` usa en el resto de la app (payments, catálogo…).
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
  const queue = stats?.queue ?? 0;
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
      key: "queue",
      label: "En cola",
      value: queue,
      icon: Hourglass,
      tone: (queue > 0 ? "destructive" : "neutral") as "destructive" | "neutral",
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
      className={cn(
        "flex shrink-0 flex-nowrap items-stretch divide-x divide-border overflow-hidden rounded-card border border-border bg-card",
        query.isError && "border-destructive-subtle-foreground/30",
      )}
    >
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div
            key={it.key}
            title={`${it.label}: ${it.value}`}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2 py-1"
          >
            <span
              aria-hidden
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                STAT_ICON_TONE[it.tone],
              )}
            >
              <Icon className="h-3 w-3" />
            </span>
            <span className="flex items-baseline gap-1 tabular-nums leading-none">
              <span className={cn("text-sm font-semibold", STAT_VALUE_TONE[it.tone])}>
                {loading ? "…" : it.value}
              </span>
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                {it.label}
              </span>
            </span>
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const list = useConversations(filters, { page, pageSize });

  // Paginado de servidor (limit/offset). `filters` solo cambia de identidad
  // cuando el usuario cambia algo de verdad (no en el refetch de fondo cada
  // 10s), así que es la señal correcta para volver a la página 1.
  useEffect(() => setPage(1), [filters]);

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
  const inPage = list.data?.data.find((c) => c.id === selectedId) ?? null;
  const byId = useConversationById(selectedId, !inPage && !list.isLoading);
  const current = inPage ?? byId.data ?? null;

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
            className="h-11 px-3 text-body-sm sm:h-8 sm:px-2"
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
            className="h-11 w-11 sm:h-8 sm:w-8"
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
            className="h-11 w-11 sm:h-8 sm:w-8"
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

  const totalRows = list.data?.pageInfo?.total ?? list.data?.data.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const pageRows = list.data?.data;

  // ============== DETALLE (hilo abierto) ==============
  if (current) {
    return (
      <>
        <header className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <h1 className="font-display text-lg font-medium tracking-[-0.02em]">Conversaciones</h1>
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
          <h1 className="font-display text-lg font-medium tracking-[-0.02em]">Conversaciones</h1>
          <p className="hidden text-xs text-muted-foreground xl:block">
            Bandeja de WhatsApp; filtros, orden y vista viven en la URL.
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <StatsStrip query={list} />
          <Button asChild variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs">
            <Link href="/conversations/reporte">
              <BarChart3 aria-hidden className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Reporte</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Fila 2: toolbar. En teléfono las pestañas y los filtros van en dos
          filas (si no, los filtros quedan aplastados y desbordan la
          página); desde `sm` vuelven a una sola línea. */}
      <div className="relative flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          value={view}
          defaultValue="inbox"
          onValueChange={(v) => setFilters({ view: v as InboxView })}
          className="shrink-0"
        >
          <TabsList className="h-11 shrink-0 sm:h-9">
            {INBOX_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="h-11 min-w-11 whitespace-nowrap px-3 text-body-sm sm:h-7 sm:min-w-0 sm:text-xs">
                {t.label}
                {typeof tabCount[t.value] === "number"
                  ? ` (${tabCount[t.value]})`
                  : ""}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Los `Select` ponen el ancho en el <select> pero su envoltorio es
            w-full: el chevron se iba al extremo de la fila y quedaba "encima"
            del control vecino. Cada control va en su propio contenedor con
            ancho fijo; el <select> siempre llena su contenedor. */}
        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
          <div className="relative w-full min-w-0 sm:w-64">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="conversations-q"
              type="search"
              inputMode="tel"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar cliente o teléfono ( / )"
              className="h-11 pl-8 text-base sm:h-9 sm:text-sm"
              aria-label="Buscar conversaciones"
              autoComplete="off"
            />
          </div>
          <div className="min-w-0 flex-1 sm:w-48 sm:flex-none">
            <Select
              aria-label="Ordenar por"
              value={filters.sort}
              onChange={(e) => setFilters({ sort: e.target.value as SortFilter })}
              className="h-11 text-base sm:h-9 sm:text-sm"
            >
              {(Object.keys(SORT_LABELS) as SortFilter[]).map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
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

      {/* Fila 3 (solo view=byAgent): bandeja por agente. Una tarjeta por
          persona (iniciales, nombre, hilos activos) + "Todos"; la tarjeta
          activa filtra la tabla al inbox de ese agente. */}
      {view === "byAgent" && agents.data && agents.data.length > 0 ? (
        <div
          role="group"
          aria-label="Bandeja por agente"
          className="flex shrink-0 items-stretch gap-2 overflow-x-auto pb-1"
        >
          {[{ userId: "", fullName: "Todos los agentes", activeConversations: agents.data.reduce((n, a) => n + a.activeConversations, 0), id: "__all" }, ...agents.data].map((a) => {
            const active = filters.agent === a.userId;
            const initials = a.userId
              ? a.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")
              : "∑";
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilters({ agent: a.userId })}
                className={cn(
                  "flex min-w-[10.5rem] shrink-0 items-center gap-2 rounded-card border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-foreground hover:bg-muted",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    active ? "bg-background/20 text-background" : "bg-muted text-muted-foreground",
                  )}
                >
                  {initials}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{a.fullName}</span>
                  <span className={cn("block text-xs tabular-nums", active ? "text-background/80" : "text-muted-foreground")}>
                    {a.activeConversations} {a.activeConversations === 1 ? "hilo activo" : "hilos activos"}
                  </span>
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
          rows={pageRows}
          pagination={
            <TablePager
              page={clampedPage}
              pageSize={pageSize}
              total={totalRows}
              loading={list.isFetching}
              onPageChange={setPage}
              onPageSizeChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
          }
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
