"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoTip, Tip } from "@/components/app/info-tip";
import { Select } from "@/components/ui/select";
import { CONVERSATION_STATUS_LABELS } from "@/components/ui/status-badge";
import { PRIORITY_LABELS } from "./ticket";
import {
  CONVERSATION_PRIORITIES,
  DEFAULT_FILTERS,
  providerLabel,
  type Conversation,
  type ConversationFilters,
  type ConversationPriority,
  type ConversationStatus,
  type HandoffFilter,
  type RangeFilter,
} from "./use-conversations";

const HANDOFF_OPTIONS: Array<{ value: HandoffFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "agent", label: "Con el bot" },
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

/** Claves de "Más filtros" (las que no viven en la barra principal). */
const MORE_KEYS = ["handoff", "provider", "range", "tag", "priority", "unanswered"] as const;

/**
 * Selectores restantes (handoff / canal / periodo / etiqueta / prioridad /
 * sin responder + estado). El estado y el botón "Más filtros" ya viven en la
 * **toolbar principal** de la bandeja — este componente solo se ocupa del
 * dropdown que abre "Más filtros".
 *
 * El contenido del dropdown se pinta **debajo** de la barra (no dentro de una
 * card), porque la página es compacta: la sección "Resumen" original ya no
 * existe y meter una card solo para esto haría crecer la altura libre de la
 * tabla. Se ve como una continuación natural.
 */
export function ConversationsFilters({
  filters,
  filtered,
  conversations,
  onChange,
  onClear,
}: {
  filters: ConversationFilters;
  filtered: boolean;
  /** Página visible: alimenta las sugerencias de etiqueta. */
  conversations?: Conversation[] | undefined;
  onChange: (patch: Partial<ConversationFilters>) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [tagDraft, setTagDraft] = useState(filters.tag);
  useEffect(() => setTagDraft(filters.tag), [filters.tag]);

  const moreFilteredCount = MORE_KEYS.filter((k) => filters[k] !== DEFAULT_FILTERS[k]).length;

  // Etiquetas conocidas (de la página visible) como sugerencias del campo.
  const knownTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations ?? []) for (const t of c.tags) set.add(t);
    return Array.from(set).sort();
  }, [conversations]);

  // Cerrar con clic afuera o Escape: el panel no vive en un <Popover> con
  // portal, es un div absoluto propio de esta página compacta, así que el
  // cierre hay que resolverlo aquí.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const commitTag = () => {
    const tag = tagDraft.trim().toLowerCase();
    if (tag !== filters.tag) onChange({ tag });
  };

  return (
    <div ref={rootRef} className="flex min-w-0 flex-wrap items-center gap-1.5">
      <div className="min-w-0 flex-1 sm:w-40 sm:flex-none">
        <Select
          id="conversations-status"
          aria-label="Estado de la conversación"
          value={filters.status}
          onChange={(e) => onChange({ status: e.target.value as ConversationStatus | "" })}
          className="h-11 text-base sm:h-9 sm:text-sm"
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
        className="h-11 px-3 sm:h-9 sm:px-2"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="conversations-more-filters"
      >
        <SlidersHorizontal aria-hidden className="h-3.5 w-3.5" />
        Más filtros
        {moreFilteredCount > 0 ? (
          <span className="ml-1 rounded-pill bg-primary-strong px-1.5 text-micro font-semibold text-primary-foreground">
            {moreFilteredCount}
          </span>
        ) : null}
        <ChevronDown
          aria-hidden
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </Button>

      {filtered ? (
        <Tip label="Quitar todos los filtros">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 w-11 px-0 sm:h-9 sm:w-9"
            aria-label="Quitar todos los filtros"
            onClick={() => {
              setOpen(false);
              onClear();
            }}
          >
            <X aria-hidden className="h-3 w-3" />
          </Button>
        </Tip>
      ) : null}

      {open ? (
        <div
          id="conversations-more-filters"
          className="absolute right-2 top-full z-20 mt-1 w-[min(720px,calc(100vw-1rem))] rounded-card border border-border bg-card p-3 shadow-airbnb-lg"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">Más filtros</p>
            {moreFilteredCount > 0 ? (
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() =>
                  onChange({
                    handoff: "all",
                    provider: "",
                    range: "all",
                    tag: "",
                    priority: "",
                    unanswered: false,
                  })
                }
              >
                Limpiar estos filtros
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="conversations-handoff" className="text-xs">
                  Atiende
                </Label>
                <InfoTip label="Atiende" text="Quién lleva el hilo ahora: el bot responde solo, o ya se transfirió a una persona del equipo." />
              </div>
              <Select
                id="conversations-handoff"
                value={filters.handoff}
                onChange={(e) => onChange({ handoff: e.target.value as HandoffFilter })}
                className="h-11 text-base sm:h-9 sm:text-sm"
              >
                {HANDOFF_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="conversations-priority" className="text-xs">
                  Prioridad
                </Label>
                <InfoTip label="Prioridad" text="Se calcula por tiempo de espera y por escalamiento: urgente si el cliente lleva más de 1 h sin respuesta." />
              </div>
              <Select
                id="conversations-priority"
                value={filters.priority}
                onChange={(e) => onChange({ priority: e.target.value as ConversationPriority | "" })}
                className="h-11 text-base sm:h-9 sm:text-sm"
              >
                <option value="">Todas</option>
                {CONVERSATION_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="conversations-provider" className="text-xs">
                  Canal
                </Label>
                <InfoTip label="Canal" text="Número conectado por WhatsApp Cloud (Meta) o por Evolution API. Lo ves en Canales." />
              </div>
              <Select
                id="conversations-provider"
                value={filters.provider}
                onChange={(e) => onChange({ provider: e.target.value })}
                className="h-11 text-base sm:h-9 sm:text-sm"
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
              <div className="flex items-center gap-1">
                <Label htmlFor="conversations-range" className="text-xs">
                  Periodo
                </Label>
                <InfoTip label="Periodo" text="Filtra por la fecha del último mensaje del hilo, no por cuándo se creó." />
              </div>
              <Select
                id="conversations-range"
                value={filters.range}
                onChange={(e) => onChange({ range: e.target.value as RangeFilter })}
                className="h-11 text-base sm:h-9 sm:text-sm"
              >
                {(Object.keys(RANGE_LABELS) as RangeFilter[]).map((r) => (
                  <option key={r} value={r}>
                    {RANGE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="conversations-tag" className="text-xs">
                  Etiqueta
                </Label>
                <InfoTip label="Etiqueta" text="Etiquetas puestas a mano desde el hilo (p. ej. mayoreo, garantía). Una sola por búsqueda." />
              </div>
              <Input
                id="conversations-tag"
                list="conversations-tag-options"
                value={tagDraft}
                placeholder="p. ej. mayoreo"
                autoComplete="off"
                onChange={(e) => setTagDraft(e.target.value)}
                onBlur={commitTag}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitTag();
                  }
                }}
                className="h-11 text-base sm:h-9 sm:text-sm"
              />
              <datalist id="conversations-tag-options">
                {knownTags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Checkbox
              id="conversations-unanswered"
              checked={filters.unanswered}
              onChange={(e) => onChange({ unanswered: e.target.checked })}
            />
            <Label htmlFor="conversations-unanswered" className="text-xs">
              Solo sin responder (el último mensaje es del cliente)
            </Label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Chips con los filtros activos, cada uno con su "×". Es la forma Zendesk de
 * ver de un vistazo POR QUÉ la lista se ve como se ve, sin abrir "Más
 * filtros"; la vista guardada y el orden no salen aquí (son navegación).
 */
export function ActiveFilterChips({
  filters,
  agentName,
  onChange,
}: {
  filters: ConversationFilters;
  /** Nombre de la persona elegida en "Por agente", si aplica. */
  agentName?: string;
  onChange: (patch: Partial<ConversationFilters>) => void;
}) {
  const chips: Array<{ key: string; label: string; clear: Partial<ConversationFilters> }> = [];
  if (filters.q) chips.push({ key: "q", label: `Busca: ${filters.q}`, clear: { q: "" } });
  if (filters.status) {
    chips.push({
      key: "status",
      label: `Estado: ${CONVERSATION_STATUS_LABELS[filters.status] ?? filters.status}`,
      clear: { status: "" },
    });
  }
  if (filters.priority) {
    chips.push({
      key: "priority",
      label: `Prioridad: ${PRIORITY_LABELS[filters.priority]}`,
      clear: { priority: "" },
    });
  }
  if (filters.handoff !== "all") {
    chips.push({
      key: "handoff",
      label: HANDOFF_OPTIONS.find((o) => o.value === filters.handoff)?.label ?? filters.handoff,
      clear: { handoff: "all" },
    });
  }
  if (filters.unanswered) chips.push({ key: "unanswered", label: "Sin responder", clear: { unanswered: false } });
  if (filters.tag) chips.push({ key: "tag", label: `Etiqueta: ${filters.tag}`, clear: { tag: "" } });
  if (filters.provider) {
    chips.push({ key: "provider", label: `Canal: ${providerLabel(filters.provider)}`, clear: { provider: "" } });
  }
  if (filters.range !== "all") chips.push({ key: "range", label: RANGE_LABELS[filters.range], clear: { range: "all" } });
  if (filters.view === "byAgent" && filters.agent) {
    chips.push({ key: "agent", label: `Agente: ${agentName ?? "…"}`, clear: { agent: "" } });
  }
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Filtros activos" className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <li key={c.key}>
          <Badge variant="secondary" size="sm" className="gap-1 pr-1">
            {c.label}
            <button
              type="button"
              aria-label={`Quitar filtro: ${c.label}`}
              className="rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onChange(c.clear)}
            >
              <X aria-hidden className="h-2.5 w-2.5" />
            </button>
          </Badge>
        </li>
      ))}
    </ul>
  );
}
