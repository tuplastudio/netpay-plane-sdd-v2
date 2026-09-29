"use client";
import { CalendarRange, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { providerLabel, useAgents } from "../../_components/use-conversations";
import { PRESETS, type Preset, type Provider, type ReportFilters } from "./use-report-filters";

interface Props {
  filters: ReportFilters;
  onChange: (patch: Partial<ReportFilters>) => void;
  onClear: () => void;
  isFiltered: boolean;
  error: string | null;
}

/** Barra de filtros del reporte: periodo (+ personalizado), agente y canal. Todo viaja en la URL. */
export function ReportFilterBar({ filters, onChange, onClear, isFiltered, error }: Props) {
  const agents = useAgents();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-2 rounded-card border border-border bg-card p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="rep-preset" className="text-xs">
            Periodo
          </Label>
          <Select
            id="rep-preset"
            value={filters.preset}
            onChange={(e) => onChange({ preset: e.target.value as Preset })}
            className="h-9 w-48 text-sm"
          >
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value="custom">Rango personalizado…</option>
          </Select>
        </div>

        {filters.preset === "custom" ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="rep-from" className="text-xs">
                Desde
              </Label>
              <Input
                id="rep-from"
                type="date"
                max={filters.to || today}
                value={filters.from}
                onChange={(e) => onChange({ from: e.target.value })}
                className="h-9 w-40 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rep-to" className="text-xs">
                Hasta
              </Label>
              <Input
                id="rep-to"
                type="date"
                min={filters.from || undefined}
                max={today}
                value={filters.to}
                onChange={(e) => onChange({ to: e.target.value })}
                className="h-9 w-40 text-sm"
              />
            </div>
          </>
        ) : null}

        <div className="space-y-1">
          <Label htmlFor="rep-agent" className="text-xs">
            Agente
          </Label>
          <Select
            id="rep-agent"
            value={filters.agent}
            onChange={(e) => onChange({ agent: e.target.value })}
            className="h-9 w-52 text-sm"
          >
            <option value="">Todo el equipo</option>
            {(agents.data ?? []).map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.fullName}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="rep-provider" className="text-xs">
            Canal
          </Label>
          <Select
            id="rep-provider"
            value={filters.provider}
            onChange={(e) => onChange({ provider: e.target.value as "" | Provider })}
            className="h-9 w-40 text-sm"
          >
            <option value="">Todos</option>
            <option value="META">{providerLabel("META")}</option>
            <option value="EVOLUTION">{providerLabel("EVOLUTION")}</option>
          </Select>
        </div>

        {isFiltered ? (
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={onClear}>
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
            Limpiar
          </Button>
        ) : null}
        <CalendarRange aria-hidden className="ml-auto hidden h-4 w-4 text-muted-foreground lg:block" />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
