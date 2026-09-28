"use client";

/**
 * ThemeProvider — alterna entre modo claro y oscuro.
 *
 * Estrategia:
 *   1. Script anti-flash en <head> (ver ThemeScript en layout.tsx) lee
 *      `localStorage["easysell-theme"]` y aplica `dark` o `light` al
 *      `<html>` ANTES del primer render — sin FOUC.
 *   2. El Provider hidrata con ese mismo valor y expone `useTheme()` para
 *      que el toggle (y quien más lo quiera) lea/mude el modo.
 *
 * Valores:
 *   - "light":  clase `.light` en <html>
 *   - "dark":   clase `.dark` en <html> (default histórico del sistema)
 *   - "system": sigue `prefers-color-scheme` del SO y reacciona a cambios.
 *
 * Persistencia: localStorage con clave `easysell-theme`; si nunca se
 * seteó, "system" hasta que el usuario haga una elección explícita.
 */
import * as React from "react";

export type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";

const STORAGE_KEY = "easysell-theme";
const DARK_CLASS = "dark";
const LIGHT_CLASS = "light";

interface ThemeContextValue {
  /** Modo elegido por el usuario (incluye "system"). */
  theme: Theme;
  /** Modo efectivo después de resolver "system". */
  resolved: Resolved;
  /** Cambia el modo y persiste en localStorage. */
  setTheme: (next: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

function applyResolved(resolved: Resolved): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove(DARK_CLASS, LIGHT_CLASS);
  root.classList.add(resolved === "dark" ? DARK_CLASS : LIGHT_CLASS);
  // color-scheme: para que el form-control nativo del navegador (scrollbars,
  // inputs en user-agent shadow) también cambie.
  root.style.colorScheme = resolved;
}

function resolveTheme(theme: Theme): Resolved {
  if (theme === "light" || theme === "dark") return theme;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(() => readStoredTheme());
  const [resolved, setResolved] = React.useState<Resolved>(() =>
    resolveTheme(theme),
  );

  // Aplica la clase cuando cambia `theme`. Solo aplica también a "system" si
  // la preferencia del SO cambia (otro effect más abajo).
  React.useEffect(() => {
    const next = resolveTheme(theme);
    setResolved(next);
    applyResolved(next);
  }, [theme]);

  // Sigue cambios del SO cuando theme === "system".
  React.useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      const next: Resolved = mq.matches ? "light" : "dark";
      setResolved(next);
      applyResolved(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const value = React.useMemo(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme debe usarse dentro de <ThemeProvider>");
  return ctx;
}

/**
 * Script anti-flash. Se inyecta en <head> y corre antes del primer render.
 * Lee localStorage, resuelve `system` contra matchMedia, y aplica la clase
 * al <html>. Sin esto, la primera pintura mostraría el modo equivocado
 * durante ~un frame.
 */
export const themeScript = `(function(){
  try {
    var k = "easysell-theme";
    var v = localStorage.getItem(k);
    var t = (v === "light" || v === "dark" || v === "system") ? v : "system";
    var r = t;
    if (t === "system") {
      r = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    var root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(r === "dark" ? "dark" : "light");
    root.style.colorScheme = r;
  } catch (e) {}
})();`;
