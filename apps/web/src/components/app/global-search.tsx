"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Package, Search, TriangleAlert, Users, X } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * Búsqueda global de la Topbar.
 *
 * ## Alcance — honesto, no aspiracional
 *
 * El backend solo acepta `q` en dos listados: `GET /catalog/products`
 * (`catalog.service.ts#listProducts` → título, SKU de producto y SKU de
 * variante) y `GET /customers` (`customer.service.ts#list` → nombre, correo,
 * teléfono y RFC). Pedidos, cotizaciones y pagos **solo** filtran por `status`,
 * así que no se buscan aquí: inventar un `?q=` que el servidor ignora daría
 * "sin resultados" a búsquedas correctas. El placeholder y el panel vacío dicen
 * exactamente eso.
 *
 * ## Sin recargas
 *
 * La versión anterior hacía `window.location.assign("/catalog?q=…")`: una
 * recarga completa en una SPA, que tira la caché entera de TanStack Query en
 * cada búsqueda. Aquí se navega con `router.push`.
 *
 * ## Respuestas viejas
 *
 * Dos defensas, no una:
 *
 * 1. El término va **en la clave** de la query, así que TanStack Query nunca
 *    pinta la respuesta de un término que ya no es el actual: cada término es
 *    otra entrada de caché, no un `setState` que pueda llegar tarde.
 * 2. Se pasa el `signal` del `queryFn` a axios, así que al cambiar de término
 *    la petición anterior se **aborta** de verdad y no ocupa conexión.
 *
 * ## ARIA — combobox con listbox (patrón APG)
 *
 * `role="combobox"` en el `<input>` (`aria-expanded`, `aria-controls`,
 * `aria-activedescendant`, `aria-autocomplete="list"`), `role="listbox"` en el
 * panel, `role="group"` por entidad y `role="option"` por resultado. Las
 * opciones no son focusables: el foco no se mueve del input y el "foco visual"
 * viaja por `aria-activedescendant`. El conteo se anuncia en una única región
 * viva `role="status"`.
 */

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;
/** Tope por grupo: el panel es un atajo, no un listado. */
const MAX_PER_GROUP = 6;

interface ProductHit {
  id: string;
  sku: string;
  title: string;
  status: string;
}

interface CustomerHit {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
}

type GroupId = "catalog" | "customers";

interface Option {
  key: string;
  group: GroupId;
  href: string;
  label: string;
  /** Segunda línea: SKU, correo o teléfono. */
  meta?: string;
}

interface Group {
  id: GroupId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  options: Option[];
  isError: boolean;
  truncated: boolean;
  retry: () => void;
}

/** Valor retrasado: una tecla no es una petición. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function GlobalSearch({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);

  const term = useDebounced(query.trim(), DEBOUNCE_MS);
  const enabled = term.length >= MIN_CHARS;

  const baseId = React.useId();
  const listboxId = `${baseId}-listbox`;
  const hintId = `${baseId}-hint`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  const products = useQuery({
    queryKey: ["global-search", "products", term],
    enabled,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const res = await api.get<{ data: ProductHit[] }>("/catalog/products", {
        params: { q: term },
        signal,
      });
      return res.data.data;
    },
  });

  const customers = useQuery({
    queryKey: ["global-search", "customers", term],
    enabled,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const res = await api.get<{ data: CustomerHit[] }>("/customers", {
        params: { q: term },
        signal,
      });
      return res.data.data;
    },
  });

  // `refetch` es estable en TanStack v5 (vive en el observer), así que sirve de
  // dependencia sin recalcular los grupos en cada render.
  const refetchProducts = products.refetch;
  const refetchCustomers = customers.refetch;

  const groups: Group[] = React.useMemo(() => {
    const productRows = enabled ? (products.data ?? []) : [];
    const customerRows = enabled ? (customers.data ?? []) : [];
    return [
      {
        id: "catalog" as const,
        label: "Catálogo",
        icon: Package,
        isError: products.isError,
        truncated: productRows.length > MAX_PER_GROUP,
        retry: () => void refetchProducts(),
        options: productRows.slice(0, MAX_PER_GROUP).map((p) => ({
          key: `catalog:${p.id}`,
          group: "catalog" as const,
          // El catálogo no tiene ruta de detalle (`/catalog/[id]` no existe: el
          // detalle es un Sheet dentro del listado), así que el resultado
          // aterriza en el listado filtrado por su SKU, que sí es una ruta real.
          href: `/catalog?q=${encodeURIComponent(p.sku)}`,
          label: p.title,
          meta: p.sku,
        })),
      },
      {
        id: "customers" as const,
        label: "Clientes",
        icon: Users,
        isError: customers.isError,
        truncated: customerRows.length > MAX_PER_GROUP,
        retry: () => void refetchCustomers(),
        options: customerRows.slice(0, MAX_PER_GROUP).map((c) => ({
          key: `customers:${c.id}`,
          group: "customers" as const,
          href: `/customers/${c.id}`,
          label: c.fullName,
          meta: c.email ?? c.phone ?? undefined,
        })),
      },
    ];
  }, [
    enabled,
    products.data,
    products.isError,
    customers.data,
    customers.isError,
    refetchProducts,
    refetchCustomers,
  ]);

  // Lista plana: las flechas cruzan de un grupo al otro sin saltos raros.
  const options = React.useMemo(() => groups.flatMap((g) => g.options), [groups]);

  const isLoading = enabled && (products.isFetching || customers.isFetching);
  const allFailed = enabled && products.isError && customers.isError;
  const someFailed = enabled && (products.isError || customers.isError);
  const isEmpty =
    enabled && !isLoading && !someFailed && options.length === 0;
  const truncated = groups.some((g) => g.truncated);

  // Al cambiar el conjunto de resultados el resalte vuelve a "ninguno": dejarlo
  // en el índice viejo apuntaría a otra fila.
  React.useEffect(() => {
    setActiveIndex(-1);
  }, [term, options.length]);

  // Navegar cierra el panel (también al volver atrás).
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const close = React.useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const choose = React.useCallback(
    (option: Option) => {
      close();
      router.push(option.href);
    },
    [close, router],
  );

  const move = React.useCallback(
    (delta: number) => {
      if (options.length === 0) return;
      setOpen(true);
      setActiveIndex((current) => {
        const next = current + delta;
        if (next < 0) return options.length - 1;
        if (next >= options.length) return 0;
        return next;
      });
    },
    [options.length],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) setOpen(true);
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) setOpen(true);
        move(-1);
        break;
      case "Home":
        if (open && options.length > 0) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End":
        if (open && options.length > 0) {
          event.preventDefault();
          setActiveIndex(options.length - 1);
        }
        break;
      case "Enter": {
        // Sin resalte, Enter abre el primer resultado: es lo que espera quien
        // escribe y pulsa Enter sin mirar. Nunca recarga la página.
        const target = options[activeIndex] ?? options[0];
        if (target) {
          event.preventDefault();
          choose(target);
        }
        break;
      }
      case "Escape":
        event.preventDefault();
        if (open) {
          close();
        } else if (query) {
          setQuery("");
        }
        // El foco nunca salió del input: es el propio combobox.
        inputRef.current?.focus();
        break;
      case "Tab":
        close();
        break;
      default:
        break;
    }
  };

  // Atajos: "/" y ⌘K / Ctrl+K. "/" solo cuando no se está escribiendo, para no
  // secuestrar la tecla dentro de un input, textarea o contenteditable.
  React.useEffect(() => {
    function onDocumentKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");

      if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, []);

  const announcement = React.useMemo(() => {
    if (!enabled) return "";
    if (isLoading) return "Buscando…";
    if (allFailed) return "No se pudo buscar. Vuelve a intentarlo.";
    if (options.length === 0) return `Sin resultados para ${term}.`;
    const parts = groups
      .filter((g) => g.options.length > 0)
      .map((g) => `${g.options.length} en ${g.label}`);
    const total = options.length;
    return `${total} ${total === 1 ? "resultado" : "resultados"}: ${parts.join(", ")}.`;
  }, [enabled, isLoading, allFailed, options.length, term, groups]);

  const activeDescendant =
    open && activeIndex >= 0 && activeIndex < options.length ? optionId(activeIndex) : undefined;

  let flatIndex = -1;

  return (
    <div
      ref={wrapperRef}
      role="search"
      aria-label="Búsqueda global"
      className={cn("relative", className)}
      onBlur={(event) => {
        // Los resultados no roban el foco (mousedown preventDefault), pero el
        // botón de reintentar sí es focusable: no cerrar si el foco sigue dentro.
        if (!wrapperRef.current?.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id="topbar-search"
          ref={inputRef}
          // `type="search"` pintaría su propia "x" nativa encima del atajo y del
          // botón de limpiar. El rol de combobox ya describe el control.
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendant}
          aria-describedby={hintId}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Buscar producto o cliente…"
          aria-label="Buscar producto o cliente"
          className="h-9 w-32 rounded-pill pl-8 pr-9 focus-visible:border-2 sm:w-52 md:w-64"
        />
        <span id={hintId} className="sr-only">
          Busca en el catálogo y en clientes. Atajo: la tecla barra diagonal o Control K. Usa las
          flechas para recorrer los resultados y Enter para abrir el resaltado.
        </span>

        {query ? (
          <button
            type="button"
            aria-label="Limpiar búsqueda"
            onClick={() => {
              setQuery("");
              setActiveIndex(-1);
              inputRef.current?.focus();
            }}
            className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        ) : (
          // Pista visible del atajo: descubrible sin documentación. Es
          // decorativa; el texto equivalente va en el `aria-describedby`.
          <kbd
            aria-hidden
            className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-md border border-hairline bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:block"
          >
            /
          </kbd>
        )}
      </div>

      {/* Una sola región viva para toda la búsqueda. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-card border bg-popover text-popover-foreground shadow-airbnb-lg">
          <div className="max-h-[min(24rem,60dvh)] overflow-y-auto py-1">
            {/* El listbox contiene solo grupos y opciones: los estados
                (vacío, error, carga) van fuera para no meter nodos inválidos
                dentro del árbol del listbox. */}
            <div id={listboxId} role="listbox" aria-label="Resultados de búsqueda">
              {groups.map((group) => {
                if (group.options.length === 0) return null;
                const groupLabelId = `${baseId}-g-${group.id}`;
                const GroupIcon = group.icon;
                return (
                  <div key={group.id} role="group" aria-labelledby={groupLabelId}>
                    <p
                      id={groupLabelId}
                      role="presentation"
                      className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      <GroupIcon aria-hidden className="h-3 w-3" />
                      {group.label}
                    </p>
                    {group.options.map((option) => {
                      flatIndex += 1;
                      const index = flatIndex;
                      const active = index === activeIndex;
                      return (
                        <div
                          key={option.key}
                          id={optionId(index)}
                          role="option"
                          aria-selected={active}
                          onMouseEnter={() => setActiveIndex(index)}
                          // El foco se queda en el input: es el combobox quien
                          // lo tiene, según el patrón APG.
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => choose(option)}
                          className={cn(
                            "flex cursor-pointer flex-col gap-0.5 px-3 py-2 text-sm",
                            active && "bg-muted",
                          )}
                        >
                          <span className="truncate font-medium">{option.label}</span>
                          {option.meta ? (
                            <span className="truncate font-mono text-xs text-muted-foreground">
                              {option.meta}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {!enabled ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                Escribe al menos {MIN_CHARS} caracteres. Se busca en el{" "}
                <span className="font-medium text-foreground">catálogo</span> (título y SKU) y en{" "}
                <span className="font-medium text-foreground">clientes</span> (nombre, correo,
                teléfono y RFC).
              </p>
            ) : null}

            {isLoading ? (
              <p className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                <Spinner size="sm" label={null} />
                Buscando…
              </p>
            ) : null}

            {isEmpty ? (
              <div className="px-3 py-3">
                <p className="text-sm font-medium">Sin resultados</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  No hay productos ni clientes que coincidan con «{term}». Pedidos, cotizaciones y
                  pagos no se buscan por texto.
                </p>
              </div>
            ) : null}

            {someFailed && !isLoading
              ? groups
                  .filter((group) => group.isError)
                  .map((group) => (
                    <div
                      key={`err-${group.id}`}
                      className="flex items-start gap-2 px-3 py-3 text-xs text-muted-foreground"
                    >
                      <TriangleAlert
                        aria-hidden
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
                      />
                      <span className="flex-1">No se pudo buscar en {group.label}.</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={group.retry}
                      >
                        Reintentar
                      </Button>
                    </div>
                  ))
              : null}
          </div>

          <p
            aria-hidden
            className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-[11px] text-muted-foreground"
          >
            <span>↑↓ moverse · ↵ abrir · esc cerrar</span>
            {truncated ? <span>Primeros {MAX_PER_GROUP} por grupo</span> : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}
