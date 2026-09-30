"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { SCOPE_GROUPS } from "./api-key-helpers";

/**
 * Selector de scopes agrupado por dominio, con la descripción de cada uno.
 * Compartido por el formulario de alta y el de edición de API keys.
 */
export function ScopePicker({
  selected,
  onChange,
  idPrefix,
  error,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  /** Prefijo de los ids de los checkboxes (dos pickers en pantalla no chocan). */
  idPrefix: string;
  error?: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Permisos</legend>
      <p className="text-xs text-muted-foreground">
        Marca los que necesite la integración. Empieza con los mínimos: leer cuando solo consulta,
        escribir solo cuando registra o modifica datos.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SCOPE_GROUPS.map((group) => (
          <div key={group.title} className="rounded-md border bg-card p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </p>
            <div className="space-y-2">
              {group.scopes.map(({ scope, label, description }) => {
                const id = `${idPrefix}-${scope.replace(/\./g, "-")}`;
                const checked = selected.includes(scope);
                return (
                  <label key={scope} htmlFor={id} className="flex cursor-pointer items-start gap-2 text-sm">
                    <Checkbox
                      id={id}
                      checked={checked}
                      onChange={(e) =>
                        onChange(
                          e.currentTarget.checked
                            ? [...selected, scope]
                            : selected.filter((s) => s !== scope),
                        )
                      }
                      className="mt-0.5"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="leading-tight">
                        {label}{" "}
                        <span className="font-mono text-xs text-muted-foreground">{scope}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">{description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </fieldset>
  );
}
