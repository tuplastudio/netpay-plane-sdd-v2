"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  CheckCircle2,
  ChevronRight,
  FilePen,
  Layers,
  MoreHorizontal,
  PackageOpen,
  PackageX,
  Pencil,
  Plus,
  Search,
  SearchX,
  X,
  SlidersHorizontal,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { StatTile } from "@/components/app/stat-tile";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatMoney } from "@/components/app/money";
import {
  CATALOG_STATUS_OPTIONS,
  apiErrorMessage,
  type CatalogStatus,
  type Product,
} from "./catalog-shared";
import { CreateProductSheet } from "./create-product-sheet";
import { EditProductSheet } from "./edit-product-sheet";
import { catalogStats, priceRange, isOutOfStock } from "./_components/product-helpers";
import { useDebounced } from "./_components/use-debounced";

const SEARCH_DEBOUNCE_MS = 250;

type StockFilter = "" | "in" | "out" | "external";
type SortKey = "updated" | "title" | "price-asc" | "price-desc" | "stock";

function minPrice(p: Product): number {
  return priceRange(p) ? Number.parseFloat(priceRange(p)!.min) : Number.POSITIVE_INFINITY;
}

function totalStock(p: Product): number {
  let total = 0;
  for (const v of p.variants) {
    if (v.stock === null) continue;
    const n = Number.parseFloat(v.stock);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

/**
 * Filtros locales sobre la página cargada. Devuelve `undefined` mientras no
 * hay datos para que el render siga distinguiendo "cargando" de "vacío".
 */
function applyLocalFilters(
  products: Product[] | undefined,
  f: { stock: StockFilter; tag: string; priceMin: string; priceMax: string; sort: SortKey },
): Product[] | undefined {
  if (!products) return undefined;
  const min = f.priceMin.trim() === "" ? null : Number.parseFloat(f.priceMin);
  const max = f.priceMax.trim() === "" ? null : Number.parseFloat(f.priceMax);
  const out = products.filter((p) => {
    if (f.tag && !p.tags.includes(f.tag)) return false;
    if (f.stock === "out" && !p.variants.some(isOutOfStock)) return false;
    if (f.stock === "in" && !p.variants.some((v) => v.stock !== null && !isOutOfStock(v))) return false;
    if (f.stock === "external" && !p.variants.some((v) => v.stock === null)) return false;
    const range = priceRange(p);
    if ((min !== null && Number.isFinite(min)) || (max !== null && Number.isFinite(max))) {
      if (!range) return false;
      const lo = Number.parseFloat(range.min);
      const hi = Number.parseFloat(range.max);
      // Coincide si alguna variante cae dentro del rango pedido.
      if (min !== null && Number.isFinite(min) && hi < min) return false;
      if (max !== null && Number.isFinite(max) && lo > max) return false;
    }
    return true;
  });
  const sorted = [...out];
  switch (f.sort) {
    case "title":
      sorted.sort((a, b) => a.title.localeCompare(b.title, "es"));
      break;
    case "price-asc":
      sorted.sort((a, b) => minPrice(a) - minPrice(b));
      break;
    case "price-desc":
      sorted.sort((a, b) => minPrice(b) - minPrice(a));
      break;
    case "stock":
      sorted.sort((a, b) => totalStock(a) - totalStock(b));
      break;
    default:
      sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return sorted;
}

export default function CatalogPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();

  // El filtro de la URL tiene prioridad sobre el estado local: entrar a
  // `/catalog?q=AGL-…` debe abrir la página ya filtrada. La URL se
  // mantiene en sync para que pegar el link funcione y para que el
  // navegador "atrás/adelante" conserve el filtro.
  const urlQ = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(urlQ);
  useEffect(() => {
    setSearch(urlQ);
  }, [urlQ]);
  const q = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);
  useEffect(() => {
    if (q === urlQ) return;
    const next = new URLSearchParams(searchParams.toString());
    if (q) next.set("q", q);
    else next.delete("q");
    router.replace(`/catalog${next.toString() ? `?${next.toString()}` : ""}`, {
      scroll: false,
    });
  }, [q, router, searchParams, urlQ]);

  const [status, setStatus] = useState<CatalogStatus | "">("");
  // Filtros finos sobre la página ya cargada: el API solo entiende `q` y
  // `status`; existencias, tag, rango de precio y orden se resuelven aquí.
  const [stockFilter, setStockFilter] = useState<StockFilter>("");
  const [tag, setTag] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [moreOpen, setMoreOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);

  const list = useQuery({
    queryKey: ["products", { q, status }],
    queryFn: async () => {
      const res = await api.get<{ data: Product[]; pageInfo?: { nextCursor: string | null } }>(
        "/catalog/products",
        {
          params: { q: q || undefined, status: status || undefined },
        },
      );
      return res.data.data;
    },
  });

  const editing = list.data?.find((p) => p.id === editingId) ?? null;
  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: ["products"] }),
    [qc],
  );

  const localFiltered =
    stockFilter !== "" || tag !== "" || priceMin.trim() !== "" || priceMax.trim() !== "";
  const isFiltered = q.length > 0 || status !== "" || localFiltered;
  const clearFilters = () => {
    setSearch("");
    setStatus("");
    setStockFilter("");
    setTag("");
    setPriceMin("");
    setPriceMax("");
    setSort("updated");
  };

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const p of list.data ?? []) for (const t of p.tags) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [list.data]);

  const visible = useMemo(
    () =>
      applyLocalFilters(list.data, {
        stock: stockFilter,
        tag,
        priceMin,
        priceMax,
        sort,
      }),
    [list.data, stockFilter, tag, priceMin, priceMax, sort],
  );

  const stats = useMemo(() => catalogStats(visible), [visible]);

  // Resalta el fragmento de la búsqueda en el título del producto. Útil
  // cuando el catálogo tiene SKUs largos como "AGL-CARBONATO-CALCIO-OMYA-1".
  const highlight = useCallback(
    (text: string) => {
      if (!q) return text;
      const i = text.toLowerCase().indexOf(q.toLowerCase());
      if (i < 0) return text;
      const before = text.slice(0, i);
      const match = text.slice(i, i + q.length);
      const after = text.slice(i + q.length);
      return (
        <>
          {before}
          <mark className="rounded bg-warning-subtle px-0.5 text-warning-foreground">
            {match}
          </mark>
          {after}
        </>
      );
    },
    [q],
  );

  const setProductStatus = useMutation({
    mutationFn: async (input: { product: Product; status: CatalogStatus }) => {
      const res = await api.patch(`/catalog/products/${input.product.id}`, {
        expectedVersion: input.product.version,
        status: input.status,
      });
      return res.data.data as Product;
    },
    onSuccess: async (_data, input) => {
      toast.success(input.status === "ACTIVE" ? "Producto activado" : "Producto en borrador");
      await invalidate();
    },
    onError: (error) => {
      if ((error as { response?: { status?: number } })?.response?.status === 409) {
        toast.error("Alguien más editó este producto. Recargando…");
        void invalidate();
        return;
      }
      toast.error(apiErrorMessage(error, "No se pudo cambiar el estado"));
    },
  });

  const archiveProduct = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/catalog/products/${id}`);
    },
    onSuccess: async () => {
      toast.success("Producto archivado");
      setArchiveTarget(null);
      await invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo archivar")),
  });

  const listCount = visible?.length;

  return (
    <div>
      <PageHeader
        title="Catálogo"
        description="Productos, variantes, precios y claves SAT que el agente puede cotizar."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden className="h-4 w-4" />
            Nuevo producto
          </Button>
        }
      />

      <div className="space-y-6">
        <div
          aria-label={isFiltered ? "Resumen según los filtros aplicados" : "Resumen del catálogo"}
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          <StatTile
            size="compact"
            label="Activos"
            value={stats.active}
            tone={stats.active > 0 ? "success" : "neutral"}
            icon={<CheckCircle2 className="h-4 w-4" />}
            hint={`de ${stats.total} ${stats.total === 1 ? "producto" : "productos"}`}
            isLoading={list.isLoading}
            isError={list.isError}
            onRetry={() => void list.refetch()}
          />
          <StatTile
            size="compact"
            label="Borradores"
            value={stats.draft}
            tone={stats.draft > 0 ? "warning" : "neutral"}
            icon={<FilePen className="h-4 w-4" />}
            hint="Aún no se ofrecen al cliente"
            isLoading={list.isLoading}
            isError={list.isError}
            onRetry={() => void list.refetch()}
          />
          <StatTile
            size="compact"
            label="Variantes"
            value={stats.variants}
            icon={<Layers className="h-4 w-4" />}
            hint="Presentaciones con precio"
            isLoading={list.isLoading}
            isError={list.isError}
            onRetry={() => void list.refetch()}
          />
          <StatTile
            size="compact"
            label="Sin existencias"
            value={stats.outOfStock}
            tone={stats.outOfStock > 0 ? "destructive" : "neutral"}
            icon={<PackageX className="h-4 w-4" />}
            hint="Variantes con inventario en cero"
            isLoading={list.isLoading}
            isError={list.isError}
            onRetry={() => void list.refetch()}
          />
        </div>

        <Section>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="catalog-q">Buscar</Label>
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="catalog-q"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nombre, SKU, tag o sinónimo…"
                  autoComplete="off"
                  className="pl-9"
                />
                {q ? (
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
            <div className="space-y-1.5 sm:w-52">
              <Label htmlFor="catalog-status">Estado</Label>
              <Select
                id="catalog-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as CatalogStatus | "")}
              >
                <option value="">Todos los estados</option>
                {CATALOG_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              type="button"
              variant={moreOpen || localFiltered ? "secondary" : "outline"}
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-controls="catalog-more-filters"
              className="sm:shrink-0"
            >
              <SlidersHorizontal aria-hidden className="h-4 w-4" />
              Más filtros
              {localFiltered ? (
                <span className="ml-1 rounded-pill bg-primary-strong px-1.5 text-[10px] font-semibold text-primary-foreground">
                  {[stockFilter, tag, priceMin.trim(), priceMax.trim()].filter(Boolean).length}
                </span>
              ) : null}
            </Button>
            {isFiltered ? (
              <Button
                type="button"
                variant="ghost"
                onClick={clearFilters}
                className="sm:shrink-0"
              >
                <X aria-hidden className="h-4 w-4" />
                Limpiar filtros
              </Button>
            ) : null}
          </div>

          {moreOpen ? (
            <div
              id="catalog-more-filters"
              className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-5"
            >
              <div className="space-y-1.5">
                <Label htmlFor="catalog-stock">Existencias</Label>
                <Select
                  id="catalog-stock"
                  value={stockFilter}
                  onChange={(e) => setStockFilter(e.target.value as StockFilter)}
                >
                  <option value="">Todas</option>
                  <option value="in">Con existencias</option>
                  <option value="out">Sin existencias</option>
                  <option value="external">Sin control de inventario</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="catalog-tag">Tag</Label>
                <Select
                  id="catalog-tag"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  disabled={availableTags.length === 0}
                >
                  <option value="">
                    {availableTags.length === 0 ? "Sin tags en el catálogo" : "Todos los tags"}
                  </option>
                  {availableTags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="catalog-price-min">Precio desde</Label>
                <Input
                  id="catalog-price-min"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={priceMin}
                  onChange={(e) => setPriceMin(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="catalog-price-max">Precio hasta</Label>
                <Input
                  id="catalog-price-max"
                  inputMode="decimal"
                  placeholder="Sin límite"
                  value={priceMax}
                  onChange={(e) => setPriceMax(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="catalog-sort">Ordenar por</Label>
                <Select
                  id="catalog-sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                >
                  <option value="updated">Última actualización</option>
                  <option value="title">Nombre (A–Z)</option>
                  <option value="price-asc">Precio: menor a mayor</option>
                  <option value="price-desc">Precio: mayor a menor</option>
                  <option value="stock">Menos existencias primero</option>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">
                Estos filtros aplican sobre los productos ya cargados; el precio se compara con
                el rango de sus variantes.
              </p>
            </div>
          ) : null}
        </Section>

        <Section
          title="Productos"
          description={
            listCount !== undefined
              ? listCount > 0
                ? `${listCount} ${listCount === 1 ? "producto" : "productos"} ${isFiltered ? "coinciden" : "en el catálogo"}.`
                : isFiltered
                  ? "Ningún producto coincide con los filtros."
                  : "Aún no hay productos."
              : "Cargando…"
          }
          padded={false}
        >
          <div className="p-4 sm:p-6">
            {list.isLoading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    role="status"
                    aria-label="Cargando producto…"
                    className="h-32 animate-pulse rounded-lg border bg-card"
                  />
                ))}
              </div>
            ) : list.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive-subtle p-4 text-sm text-destructive-subtle-foreground">
                <p className="font-semibold">No se pudo cargar el catálogo.</p>
                <p className="mt-1 text-xs">
                  {apiErrorMessage(list.error, "Revisa tu conexión.")}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => void list.refetch()}
                >
                  Reintentar
                </Button>
              </div>
            ) : !visible || visible.length === 0 ? (
              <EmptyCatalog
                isFiltered={isFiltered}
                onCreate={() => setCreateOpen(true)}
                onClear={clearFilters}
                searchTerm={q}
              />
            ) : (
              <ul
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                aria-label="Productos del catálogo"
              >
                {visible.map((p) => (
                  <li key={p.id}>
                    <ProductCard
                      product={p}
                      highlight={highlight}
                      onEdit={() => setEditingId(p.id)}
                      onActivate={() =>
                        setProductStatus.mutate({ product: p, status: "ACTIVE" })
                      }
                      onDraft={() =>
                        setProductStatus.mutate({ product: p, status: "DRAFT" })
                      }
                      onArchive={() => setArchiveTarget(p)}
                      activating={setProductStatus.isPending}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      </div>

      <CreateProductSheet open={createOpen} onOpenChange={setCreateOpen} onCreated={invalidate} />

      <EditProductSheet
        product={editing}
        onClose={() => setEditingId(null)}
        onChanged={invalidate}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        title={archiveTarget ? `¿Archivar "${archiveTarget.title}"?` : "¿Archivar el producto?"}
        description="Deja de venderse y el agente ya no lo ofrece. No se borra: podrás reactivarlo cambiando su estado."
        confirmLabel="Archivar"
        pending={archiveProduct.isPending}
        onConfirm={() => {
          if (archiveTarget) archiveProduct.mutate(archiveTarget.id);
        }}
      />
    </div>
  );
}

function EmptyCatalog({
  isFiltered,
  onCreate,
  onClear,
  searchTerm,
}: {
  isFiltered: boolean;
  onCreate: () => void;
  onClear: () => void;
  searchTerm: string;
}) {
  if (isFiltered) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center">
        <SearchX aria-hidden className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Sin coincidencias</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {searchTerm ? (
            <>
              Nada en el catálogo coincide con{" "}
              <code className="rounded bg-muted px-1 font-mono text-xs">
                {searchTerm}
              </code>
              . Prueba con un fragmento más corto o revisa el SKU.
            </>
          ) : (
            "Ningún producto coincide con el filtro de estado."
          )}
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={onClear}>
          <X aria-hidden className="h-3.5 w-3.5" />
          Limpiar filtros
        </Button>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center">
      <PackageOpen aria-hidden className="mx-auto h-8 w-8 text-muted-foreground" />
      <p className="mt-3 font-medium">Aún no hay productos</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Crea el primero con su variante y precio para que el agente pueda cotizarlo.
      </p>
      <Button size="sm" className="mt-4" onClick={onCreate}>
        <Plus aria-hidden className="h-3.5 w-3.5" />
        Crear producto
      </Button>
    </div>
  );
}

function ProductCard({
  product,
  highlight,
  onEdit,
  onActivate,
  onDraft,
  onArchive,
  activating,
}: {
  product: Product;
  highlight: (text: string) => React.ReactNode;
  onEdit: () => void;
  onActivate: () => void;
  onDraft: () => void;
  onArchive: () => void;
  activating: boolean;
}) {
  const range = priceRange(product);
  const outOfStock = product.variants.some(isOutOfStock);
  const totalStock = product.variants.reduce((acc, v) => {
    if (v.stock === null) return acc;
    return acc + Number.parseFloat(v.stock);
  }, 0);

  return (
    <article
      className="group flex h-full flex-col gap-2 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/40 focus-within:border-foreground/60"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-medium leading-tight">
            {highlight(product.title)}
          </h3>
          <p className="mt-0.5 truncate font-mono text-[10px] uppercase text-muted-foreground">
            {highlight(product.sku)}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Acciones de ${product.title}`}
              className="h-7 w-7 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil aria-hidden className="h-4 w-4" />
              Editar
            </DropdownMenuItem>
            {product.status !== "ACTIVE" ? (
              <DropdownMenuItem onSelect={onActivate} disabled={activating}>
                <CheckCircle2 aria-hidden className="h-4 w-4" />
                Activar
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={onDraft} disabled={activating}>
                <FilePen aria-hidden className="h-4 w-4" />
                Pasar a borrador
              </DropdownMenuItem>
            )}
            {product.status !== "ARCHIVED" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={onArchive}
                >
                  <Archive aria-hidden className="h-4 w-4" />
                  Archivar
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex items-center gap-2">
        <StatusBadge status={product.status} domain="catalog" />
        {outOfStock && product.status === "ACTIVE" ? (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <PackageX aria-hidden className="h-3.5 w-3.5" />
            Sin stock
          </span>
        ) : null}
      </div>

      <dl className="mt-auto space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Precio</dt>
          <dd className="font-semibold tabular-nums">
            {range ? (
              range.min === range.max ? (
                formatMoney(range.min)
              ) : (
                <>
                  {formatMoney(range.min)} – {formatMoney(range.max)}
                </>
              )
            ) : (
              <span className="text-muted-foreground">Sin precio</span>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Variantes</dt>
          <dd className="tabular-nums">{product.variants.length}</dd>
        </div>
        {Number.isFinite(totalStock) ? (
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Stock total</dt>
            <dd className="tabular-nums">{totalStock.toFixed(2)}</dd>
          </div>
        ) : null}
      </dl>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-mx-1 mt-1 justify-between"
        onClick={onEdit}
        aria-label={`Editar ${product.title}`}
      >
        Editar
        <ChevronRight aria-hidden className="h-3.5 w-3.5" />
      </Button>
    </article>
  );
}