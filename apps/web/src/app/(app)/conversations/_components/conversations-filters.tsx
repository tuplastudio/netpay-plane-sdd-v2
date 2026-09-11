"use client";
import { useState } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CONVERSATION_STATUS_LABELS } from "@/components/ui/status-badge";
import {
  providerLabel,
  type Conversation,
  type ConversationFilters,
  type ConversationStatus,
  type HandoffFilter,
  type RangeFilter,
} from "./use-conversations";

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
 * Selectores restantes (handoff / canal / periodo / etiqueta + estado). El
 * estado y el botón "Más filtros" ya viven en la **toolbar principal** de la
 * bandeja — este componente solo se ocupa del dropdown que abre "Más filtros".
 *
 * El contenido del dropdown se pinta **debajo** de la barra (no dentro de una
 * card), porque la página es compacta: la sección "Resumen" original ya no
 * existe y meter una card solo para esto haría crecer la altura libre de la
 * tabla. Se ve como una continuación natural.
 */
export function ConversationsFilters({
  filters,
  filtered,
  onChange,
}: {
  filters: ConversationFilters;
  filtered: boolean;
  /** Reservado para el listado de etiquetas; ya no se usa desde fuera. */
  conversations?: Conversation[] | undefined;
  onChange: (patch: Partial<ConversationFilters>) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);

  const moreFilteredCount = [
    filters.handoff !== "all",
    filters.provider !== "",
    filters.range !== "all",
    filters.tag !== "",
  ].filter(Boolean).length;

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <div className="w-32 shrink-0">
        <Select
          id="conversations-status"
          aria-label="Estado de la conversación"
          value={filters.status}
          onChange={(e) => onChange({ status: e.target.value as ConversationStatus | "" })}
          className="h-8 text-xs"
        >
          <option value="">Todos</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {CONVERSATION_STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </Select>
      </div>

      <Button
        type="button"
        variant={open || moreFilteredCount > 0 ? "secondary" : "outline"}
        size="sm"
        className="h-8 px-2 text-xs"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="conversations-more-filters"
      >
        <SlidersHorizontal aria-hidden className="h-3.5 w-3.5" />
        Más filtros
        {moreFilteredCount > 0 ? (
          <span className="ml-1 rounded-pill bg-primary-strong px-1.5 text-[10px] font-semibold text-primary-foreground">
            {moreFilteredCount}
          </span>
        ) : null}
        <ChevronDown
          aria-hidden
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </Button>

      {filtered ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => {
            /* mantenido por contrato: la toolbar ya pinta el botón principal,
               este queda accesible si la pantalla se monta sin él. */
          }}
          aria-disabled
        >
          <X aria-hidden className="h-3 w-3" />
        </Button>
      ) : null}

      {open ? (
        <div
          id="conversations-more-filters"
          className="absolute right-2 top-full z-20 mt-1 grid w-[min(640px,calc(100vw-1rem))] grid-cols-2 gap-3 rounded-card border border-border bg-card p-3 shadow-airbnb-lg sm:grid-cols-4"
        >
          <div className="space-y-1">
            <Label htmlFor="conversations-handoff" className="text-xs">
              Atención
            </Label>
            <Select
              id="conversations-handoff"
              value={filters.handoff}
              onChange={(e) => onChange({ handoff: e.target.value as HandoffFilter })}
              className="h-8 text-xs"
            >
              {HANDOFF_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="conversations-provider" className="text-xs">
              Canal
            </Label>
            <Select
              id="conversations-provider"
              value={filters.provider}
              onChange={(e) => onChange({ provider: e.target.value })}
              className="h-8 text-xs"
            >
              <option value="">Todos</option>
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {providerLabel(p)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="conversations-range" className="text-xs">
              Periodo
            </Label>
            <Select
              id="conversations-range"
              value={filters.range}
              onChange={(e) => onChange({ range: e.target.value as RangeFilter })}
              className="h-8 text-xs"
            >
              {(Object.keys(RANGE_LABELS) as RangeFilter[]).map((r) => (
                <option key={r} value={r}>
                  {RANGE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="conversations-tag" className="text-xs">
              Etiqueta
            </Label>
            <Select
              id="conversations-tag"
              value={filters.tag}
              onChange={(e) => onChange({ tag: e.target.value })}
              className="h-8 text-xs"
            >
              <option value="">Todas</option>
            </Select>
          </div>
        </div>
      ) : null}
    </div>
  );
}
