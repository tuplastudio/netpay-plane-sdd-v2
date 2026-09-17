"use client";

/**
 * Toggle de tema — botón ghost con dropdown para elegir claro / oscuro /
 * sistema. Vive en el Topbar (entre GlobalSearch y TenantSwitcher).
 *
 * El ícono del botón refleja el modo RESUELTO (no el elegido): si el
 * usuario puso "system" y su SO está en claro, ve el sol. La marca de
 * check en el dropdown sí muestra el elegido, así sabe qué tiene seteado.
 *
 * `mounted` evita mismatch de hidratación: hasta que el componente monte en
 * cliente, asumimos "dark" (default del server render) y luego se corrige.
 * Sin el gate veríamos un parpadeo del ícono en la primera carga.
 */
import * as React from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const OPTIONS: Array<{ value: "light" | "dark" | "system"; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Claro", Icon: Sun },
  { value: "dark", label: "Oscuro", Icon: Moon },
  { value: "system", label: "Sistema", Icon: Monitor },
];

export function ThemeToggle() {
  const { theme, setTheme, resolved } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const showResolved = mounted ? resolved : "dark";
  const TriggerIcon = showResolved === "dark" ? Moon : Sun;
  const triggerLabel =
    showResolved === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={triggerLabel} title={triggerLabel}>
          <TriggerIcon className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Apariencia
        </DropdownMenuLabel>
        {OPTIONS.map(({ value, label: optLabel, Icon }) => {
          const selected = theme === value;
          return (
            <DropdownMenuItem
              key={value}
              onClick={() => setTheme(value)}
              className="gap-2"
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span className="flex-1">{optLabel}</span>
              {selected ? (
                <Check className="h-3.5 w-3.5 text-primary-strong" aria-hidden />
              ) : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setTheme(showResolved === "dark" ? "light" : "dark")}
          className="gap-2 text-xs"
        >
          {showResolved === "dark" ? (
            <>
              <Sun className="h-3.5 w-3.5" aria-hidden /> Cambiar a claro
            </>
          ) : (
            <>
              <Moon className="h-3.5 w-3.5" aria-hidden /> Cambiar a oscuro
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
