"use client";
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CONVERSATION_STATUS_LABELS } from "@/components/ui/status-badge";
import { Section } from "@/components/app/section";
import { useDebounced } from "./use-debounced";
import {
  providerLabel,
  type ConversationFilters,
  type ConversationStatus,
  type HandoffFilter,
  type RangeFilter,
} from "./use-conversations";

const SEARCH_DEBOUNCE_MS = 250;

const HANDOFF_OPTIONS: Array<{ value: HandoffFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "agent", label: "Con el agente" },
  { value: "human", label: "Con una persona" },
];

const STATUS_OPTIONS: ConversationStatus[] = ["OPEN", "HANDED_OFF", "CLOSED"];
const PROVIDER_OPTIONS = ["META", "EVOLUTION"];

export const RANGE_LABELS: Record<RangeFilter, string> = {
  all: "Todo el tiempo",
  today: "Hoy",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
};

/**
 * Barra de filtros de la bandeja. No guarda estado propio salvo el texto de
 * búsqueda (para que el input responda al instante y la URL se actualice al
 * soltar); todo lo demás va directo a la URL vía `onChange`.
 */
export function ConversationsFilters({
  filters,
  filtered,
  onChange,
  onClear,
}: {
  filters: ConversationFilters;
  filtered: boolean;
  onChange: (patch: Partial<ConversationFilters>) => void;
  onClear: () => void;
}) {
  // La URL manda: entrar a `/conversations?q=52…` debe abrir el input ya lleno.
  const [search, setSearch] = useState(filters.q);
  useEffect(() => {
    setSearch(filters.q);
  }, [filters.q]);
  const q = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);
  useEffect(() => {
    if (q !== filters.q) onChange({ q });
  }, [q, filters.q, onChange]);

  return (
    <Section>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="conversations-q">Buscar</Label>
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="conversations-q"
                type="search"
                inputMode="tel"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Teléfono del cliente…"
                autoComplete="off"
                className="pl-9"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                  aria-label="Limpiar búsqueda"
                >
                  <X aria-hidden className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="block text-sm font-medium leading-none">Atención</span>
            <Tabs
              value={filters.handoff}
              onValueChange={(v) => onChange({ handoff: v as HandoffFilter })}
              defaultValue="all"
            >
              <TabsList aria-label="Filtrar por quién atiende">
                {HANDOFF_OPTIONS.map((o) => (
                  <TabsTrigger key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="conversations-status">Estado</Label>
            <Select
              id="conversations-status"
              value={filters.status}
              onChange={(e) => onChange({ status: e.target.value as ConversationStatus | "" })}
            >
              <option value="">Todos los estados</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {CONVERSATION_STATUS_LABELS[s] ?? s}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conversations-provider">Canal</Label>
            <Select
              id="conversations-provider"
              value={filters.provider}
              onChange={(e) => onChange({ provider: e.target.value })}
            >
              <option value="">Todos los canales</option>
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {providerLabel(p)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="conversations-range">Periodo</Label>
              <Select
                id="conversations-range"
                value={filters.range}
                onChange={(e) => onChange({ range: e.target.value as RangeFilter })}
              >
                {(Object.keys(RANGE_LABELS) as RangeFilter[]).map((r) => (
                  <option key={r} value={r}>
                    {RANGE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </div>
            {filtered ? (
              <Button variant="ghost" onClick={onClear} className="shrink-0">
                <X aria-hidden className="h-4 w-4" />
                Limpiar
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </Section>
  );
}
