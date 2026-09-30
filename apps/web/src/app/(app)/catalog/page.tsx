"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Copy,
  Eye,
  FilePen,
  ImageIcon,
  Images,
  LayoutGrid,
  Layers,
  List,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
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
import { InfoTip, Tip } from "@/components/app/info-tip";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { PageHeader } from "@/components/app/page-header";
import { ProductDetailSheet } from "@/components/app/product-detail-sheet";
import { Section } from "@/components/app/section";
import { TablePager } from "@/components/app/table-pager";
import { usePagedQuery } from "@/components/app/use-paged-query";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatMoney } from "@/components/app/money";
import { cn } from "@/lib/utils";
import {
  CATALOG_FIELD_HELP,
  CATALOG_STATUS_OPTIONS,
  apiErrorMessage,
  type CatalogStatus,
  type Product,
} from "./catalog-shared";
import { CreateProductSheet } from "./create-product-sheet";
import { EditProductSheet } from "./edit-product-sheet";
import {
  EMPTY_LOCAL_FILTERS,
  applyLocalFilters,
  catalogStats,
  collectTags,
  countLocalFilters,
  hasLocalFilters,
  isOutOfStock,
  priceRange,
  totalStock,
  type LocalFilters,
  type SortKey,
  type StockFilter,
} from "./_components/product-helpers";
import { imageAlt, primaryImage } from "./_components/image-helpers";
import { PriceSummary } from "./_components/price-summary";
import { useDebounced } from "./_components/use-debounced";
import { usePermissions } from "@/components/app/use-permissions";

const SEARCH_DEBOUNCE_MS = 250;

type ViewMode = "grid" | "list";

/**
 * KPIs en una sola línea de píldoras para vivir junto al título sin comerse
 * el alto del catálogo. Mismo patrón que la bandeja de conversaciones: se
 * lee de un vistazo, los cuatro números juntos, y deja respirar a la rejilla
 * de productos.
 */
function CatalogStatsStrip({
  stats,
  loading,
  isError,
}: {
  stats: { total: number; active: number; draft: number; variants: number; outOfStock: number };
  loading: boolean;
  isError: boolean;
}) {
  const items = [
    {
      key: "active",
      label: "Activos",
      value: stats.active,
      icon: CheckCircle2,
      tone: stats.active > 0 ? "text-success-foreground" : "text-muted-foreground",
    },
    {
      key: "draft",
      label: "Borradores",
      value: stats.draft,
      icon: FilePen,
      tone: stats.draft > 0 ? "text-warning-foreground" : "text-muted-foreground",
    },
    {
      key: "variants",
      label: "Variantes",
      value: stats.variants,
      icon: Layers,
      tone: "text-muted-foreground",
    },
    {
      key: "out",
      label: "Sin existencias",
      value: stats.outOfStock,
      icon: PackageX,
      tone: stats.outOfStock > 0 ? "text-destructive-subtle-foreground" : "text-muted-foreground",
    },
  ];
  return (
    <div
      aria-label="Resumen del catálogo"
      className={cn(
        "flex shrink-0 flex-nowrap items-center gap-1.5 whitespace-nowrap text-xs",
        isError && "text-destructive",
      )}
    >
      <span className="text-muted-foreground">Esta página:</span>
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div
            key={it.key}
            title={`${it.label}: ${it.value}`}
            className="flex shrink-0 items-center gap-1 rounded-pill border border-border bg-card px-2 py-0.5 tabular-nums"
          >
            <Icon aria-hidden className={cn("h-3 w-3 shrink-0", it.tone)} />
            <span className="font-semibold leading-none text-foreground">
              {loading ? "…" : it.value}
            </span>
            <span className="hidden text-muted-foreground sm:inline">{it.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Miniatura de la portada con marcador cuando el producto no tiene fotos. */
function ProductThumb({
  product,
  className,
  iconClassName = "h-4 w-4",
}: {
  product: Product;
  className?: string;
  iconClassName?: string;
}) {
  const cover = primaryImage(product.images);
  if (!cover) {
    return (
      <div
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground",
          className,
        )}
      >
        <ImageIcon className={iconClassName} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- foto de catálogo servida por el API
    <img
      src={cover.url}
      alt={imageAlt(cover, product.title)}
      loading="lazy"
      className={cn("shrink-0 rounded-md border object-cover", className)}
    />
  );
}

export default function CatalogPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();

  // El filtro de la URL tiene prioridad sobre el estado local: entrar a
  // `/catalog?q=…` debe abrir la página ya filtrada. La URL se mantiene en
  // sync para que pegar el link funcione y para que el navegador
  // "atrás/adelante" conserve el filtro.
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

  // Rejilla o lista, también en la URL (`?view=list`) para que se conserve al
  // volver y al compartir el link.
  const view: ViewMode = searchParams.get("view") === "list" ? "list" : "grid";
  const setView = (next: ViewMode) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "list") params.set("view", "list");
    else params.delete("view");
    router.replace(`/catalog${params.toString() ? `?${params.toString()}` : ""}`, { scroll: false });
  };

  const [status, setStatus] = useState<CatalogStatus | "">("");
  // Filtros finos sobre la página ya cargada: el API solo entiende `q` y
  // `status`; existencias, tag, rango de precio y orden se resuelven aquí.
  const [local, setLocal] = useState<LocalFilters>(EMPTY_LOCAL_FILTERS);
  const patchLocal = (patch: Partial<LocalFilters>) => setLocal((prev) => ({ ...prev, ...patch }));
  const [moreOpen, setMoreOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // Solo lectura para quien no tiene `catalog.write` (VENDOR, FINANCE,
  // SUPPORT, VIEWER): se ve el catálogo, sin botones que acabarían en 403.
  const canWrite = usePermissions().can("catalog.write");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);

  // Paginado en el servidor (`limit`/`offset`): antes solo se veían los primeros
  // 25 productos y el resto del catálogo era inalcanzable.
  const list = usePagedQuery<Product>({
    key: ["products"],
    path: "/catalog/products",
    params: { q, status },
  });

  const editing = list.rows?.find((p) => p.id === editingId) ?? null;
  const detail = list.rows?.find((p) => p.id === detailId) ?? null;
  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: ["products"] }),
    [qc],
  );

  const localFiltered = hasLocalFilters(local);
  const isFiltered = q.length > 0 || status !== "" || localFiltered;
  const clearFilters = () => {
    setSearch("");
    setStatus("");
    setLocal(EMPTY_LOCAL_FILTERS);
  };

  const availableTags = useMemo(() => collectTags(list.rows), [list.rows]);
  const visible = useMemo(() => applyLocalFilters(list.rows, local), [list.rows, local]);
  const stats = useMemo(() => catalogStats(visible), [visible]);

  // Resalta el fragmento de la búsqueda en el título y el SKU del producto.
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

  const duplicateProduct = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/catalog/products/${id}/duplicate`);
      return res.data.data as Product;
    },
    onSuccess: async (copy) => {
      toast.success(`Copia creada como borrador: ${copy.sku}`, {
        description: "Las fotos no se copian; súbelas desde Editar.",
      });
      // La copia es la más reciente: tras recargar queda en la primera página
      // y se abre a editar para renombrarla.
      setEditingId(null);
      setDetailId(null);
      await invalidate();
      setEditingId(copy.id);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo duplicar el producto")),
  });

  const listCount = visible?.length;

  const actionsFor = (p: Product) => ({
    onView: () => setDetailId(p.id),
    onEdit: () => setEditingId(p.id),
    onActivate: () => setProductStatus.mutate({ product: p, status: "ACTIVE" }),
    onDraft: () => setProductStatus.mutate({ product: p, status: "DRAFT" }),
    onDuplicate: () => duplicateProduct.mutate(p.id),
    onArchive: () => setArchiveTarget(p),
    busy: setProductStatus.isPending || duplicateProduct.isPending,
    canEdit: canWrite,
  });

  const columns: Array<DataTableColumn<Product>> = [
    {
      key: "photo",
      header: <span className="sr-only">Foto</span>,
      width: "3.5rem",
      cell: (p) => <ProductThumb product={p} className="h-10 w-10" />,
    },
    {
      key: "product",
      header: "Producto",
      cell: (p) => (
        <div className="min-w-0">
          <p className="line-clamp-1 text-sm font-medium">{highlight(p.title)}</p>
          <p className="truncate font-mono text-[10px] uppercase text-muted-foreground">{highlight(p.sku)}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Estado",
      width: "8rem",
      cell: (p) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={p.status} domain="catalog" size="sm" />
          {p.status === "ACTIVE" && p.variants.some(isOutOfStock) ? (
            <span className="inline-flex items-center gap-1 text-xs text-destructive">
              <PackageX aria-hidden className="h-3.5 w-3.5" />
              Sin stock
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "price",
      header: "Precio",
      numeric: true,
      width: "9rem",
      cell: (p) => <PriceSummary product={p} />,
    },
    {
      key: "variants",
      header: "Variantes",
      numeric: true,
      width: "6rem",
      cell: (p) => p.variants.length,
    },
    {
      key: "stock",
      header: "Existencias",
      numeric: true,
      width: "7rem",
      cell: (p) =>
        p.variants.every((v) => v.stock === null) ? (
          <span className="text-muted-foreground">Sin control</span>
        ) : (
          totalStock(p).toFixed(2)
        ),
    },
    {
      key: "photos",
      header: "Fotos",
      numeric: true,
      width: "5rem",
      cell: (p) => (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Images aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          {p.images.length}
        </span>
      ),
    },
    {
      key: "updated",
      header: "Actualizado",
      width: "10rem",
      cell: (p) => <DateTime value={p.updatedAt} className="text-muted-foreground" />,
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      width: "3rem",
      className: "text-right",
      cell: (p) => <ProductActionsMenu product={p} {...actionsFor(p)} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Catálogo"
        description="Productos, variantes, precios, fotos y claves SAT que el agente puede cotizar."
        actions={
          canWrite ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden className="h-4 w-4" />
              Nuevo producto
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-3">
        <CatalogStatsStrip stats={stats} loading={list.isLoading} isError={list.isError} />

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
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Limpiar búsqueda"
                  >
                    <X aria-hidden className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="space-y-1.5 sm:w-52">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="catalog-status">Estado</Label>
                <InfoTip label="Estado" text={CATALOG_FIELD_HELP.status} />
              </div>
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
                  {countLocalFilters(local)}
                </span>
              ) : null}
            </Button>
            {isFiltered ? (
              <Button type="button" variant="ghost" onClick={clearFilters} className="sm:shrink-0">
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
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="catalog-stock">Existencias</Label>
                  <InfoTip
                    label="Existencias"
                    text="«Sin control de inventario» son variantes con existencias vacías: se venden siempre y no descuentan stock."
                  />
                </div>
                <Select
                  id="catalog-stock"
                  value={local.stock}
                  onChange={(e) => patchLocal({ stock: e.target.value as StockFilter })}
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
                  value={local.tag}
                  onChange={(e) => patchLocal({ tag: e.target.value })}
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
                  value={local.priceMin}
                  onChange={(e) => patchLocal({ priceMin: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="catalog-price-max">Precio hasta</Label>
                <Input
                  id="catalog-price-max"
                  inputMode="decimal"
                  placeholder="Sin límite"
                  value={local.priceMax}
                  onChange={(e) => patchLocal({ priceMax: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="catalog-sort">Ordenar por</Label>
                <Select
                  id="catalog-sort"
                  value={local.sort}
                  onChange={(e) => patchLocal({ sort: e.target.value as SortKey })}
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
                ? `${listCount} ${listCount === 1 ? "producto" : "productos"} ${isFiltered ? "coinciden" : "en esta página"}.`
                : isFiltered
                  ? "Ningún producto coincide con los filtros."
                  : "Aún no hay productos."
              : "Cargando…"
          }
          actions={
            <div
              role="group"
              aria-label="Vista"
              className="inline-flex rounded-pill border bg-card p-0.5"
            >
              <Tip label="Rejilla">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8 sm:h-8 sm:w-8", view === "grid" && "bg-secondary")}
                  aria-label="Ver como rejilla"
                  aria-pressed={view === "grid"}
                  onClick={() => setView("grid")}
                >
                  <LayoutGrid aria-hidden className="h-4 w-4" />
                </Button>
              </Tip>
              <Tip label="Lista">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8 sm:h-8 sm:w-8", view === "list" && "bg-secondary")}
                  aria-label="Ver como lista"
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                >
                  <List aria-hidden className="h-4 w-4" />
                </Button>
              </Tip>
            </div>
          }
          padded={false}
        >
          {view === "list" ? (
            <DataTable
              columns={columns}
              rows={visible}
              isLoading={list.isLoading}
              isError={list.isError}
              error={list.error}
              onRetry={() => void list.refetch()}
              onRowClick={(p) => setDetailId(p.id)}
              getRowActionLabel={(p) => `Ver ${p.title}`}
              caption="Productos del catálogo"
              skeletonRows={8}
              empty={{
                icon: isFiltered ? <SearchX className="h-6 w-6" /> : <PackageOpen className="h-6 w-6" />,
                title: isFiltered ? "Sin coincidencias" : "Aún no hay productos",
                description: isFiltered
                  ? "Ningún producto coincide con los filtros activos."
                  : canWrite
                    ? "Crea el primero con su variante y precio para que el agente pueda cotizarlo."
                    : "Cuando alguien con permiso de catálogo los dé de alta, aparecerán aquí.",
                action: isFiltered ? (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    <X aria-hidden className="h-3.5 w-3.5" />
                    Limpiar filtros
                  </Button>
                ) : canWrite ? (
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus aria-hidden className="h-3.5 w-3.5" />
                    Crear producto
                  </Button>
                ) : undefined,
              }}
              pagination={list.paged ? <TablePager {...list.pagerProps} /> : undefined}
            />
          ) : (
            <>
              <div className="p-4 sm:p-6">
                {list.isLoading ? (
                  <SkeletonRegion label="Cargando catálogo…">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="space-y-2 rounded-lg border bg-card p-3">
                          <Skeleton className="aspect-[4/3] w-full rounded-md" />
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/3" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                      ))}
                    </div>
                  </SkeletonRegion>
                ) : list.isError ? (
                  <Alert variant="destructive">
                    <AlertCircle />
                    <AlertTitle>No se pudo cargar el catálogo</AlertTitle>
                    <AlertDescription>
                      <p>{apiErrorMessage(list.error, "Revisa tu conexión.")}</p>
                      <Button size="sm" variant="outline" className="mt-3" onClick={() => void list.refetch()}>
                        Reintentar
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : !visible || visible.length === 0 ? (
                  <EmptyCatalog
                    isFiltered={isFiltered}
                    onCreate={canWrite ? () => setCreateOpen(true) : undefined}
                    onClear={clearFilters}
                    searchTerm={q}
                  />
                ) : (
                  <>
                    {localFiltered ? (
                      <p className="mb-3 text-xs text-muted-foreground">
                        Existencias, etiqueta, precio y orden filtran dentro de la página actual; la
                        búsqueda y el estado sí recorren todo el catálogo.
                      </p>
                    ) : null}
                    <ul
                      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                      aria-label="Productos del catálogo"
                    >
                      {visible.map((p) => (
                        <li key={p.id}>
                          <ProductCard product={p} highlight={highlight} {...actionsFor(p)} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              {list.paged ? <TablePager {...list.pagerProps} /> : null}
            </>
          )}
        </Section>
      </div>

      <CreateProductSheet open={createOpen} onOpenChange={setCreateOpen} onCreated={invalidate} />

      <EditProductSheet
        product={editing}
        onClose={() => setEditingId(null)}
        onChanged={invalidate}
        onDuplicate={canWrite ? (p) => duplicateProduct.mutate(p.id) : undefined}
      />

      <ProductDetailSheet
        product={detail}
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        footer={
          detail ? (
            <>
              <StatusBadge status={detail.status} domain="catalog" withDot />
              <span className="hidden flex-1 sm:block" />
              {canWrite ? (
                <Button
                  type="button"
                  onClick={() => {
                    setDetailId(null);
                    setEditingId(detail.id);
                  }}
                >
                  <Pencil aria-hidden className="h-4 w-4" />
                  Editar
                </Button>
              ) : null}
            </>
          ) : undefined
        }
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
  onCreate?: () => void;
  onClear: () => void;
  searchTerm: string;
}) {
  if (isFiltered) {
    return (
      <EmptyState
        className="py-8"
        icon={<SearchX className="h-6 w-6" />}
        title="Sin coincidencias"
        description={
          searchTerm ? (
            <>
              Nada en el catálogo coincide con{" "}
              <code className="rounded bg-muted px-1 font-mono text-xs">{searchTerm}</code>. Prueba
              con un fragmento más corto o revisa el SKU.
            </>
          ) : (
            "Ningún producto coincide con los filtros activos."
          )
        }
        action={
          <Button variant="outline" size="sm" onClick={onClear}>
            <X aria-hidden className="h-3.5 w-3.5" />
            Limpiar filtros
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      className="py-8"
      icon={<PackageOpen className="h-6 w-6" />}
      title="Aún no hay productos"
      description={
        onCreate
          ? "Crea el primero con su variante, precio y fotos para que el agente pueda cotizarlo."
          : "Cuando alguien con permiso de catálogo los dé de alta, aparecerán aquí."
      }
      action={
        onCreate ? (
          <Button size="sm" onClick={onCreate}>
            <Plus aria-hidden className="h-3.5 w-3.5" />
            Crear producto
          </Button>
        ) : undefined
      }
    />
  );
}

interface ProductActions {
  onView: () => void;
  onEdit: () => void;
  onActivate: () => void;
  onDraft: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  busy: boolean;
  canEdit: boolean;
}

/** Menú de acciones rápidas, compartido por la tarjeta y la fila de la lista. */
function ProductActionsMenu({
  product,
  onView,
  onEdit,
  onActivate,
  onDraft,
  onDuplicate,
  onArchive,
  busy,
  canEdit,
}: ProductActions & { product: Product }) {
  return (
    <DropdownMenu>
      <Tip label="Más acciones">
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Acciones de ${product.title}`}
            className="h-11 w-11 shrink-0 sm:h-8 sm:w-8"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={onView}>
          <Eye aria-hidden className="h-4 w-4" />
          Ver detalle
        </DropdownMenuItem>
        {canEdit ? (
          <>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil aria-hidden className="h-4 w-4" />
              Editar
            </DropdownMenuItem>
            {product.status !== "ACTIVE" ? (
              <DropdownMenuItem onSelect={onActivate} disabled={busy}>
                <CheckCircle2 aria-hidden className="h-4 w-4" />
                Activar
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={onDraft} disabled={busy}>
                <FilePen aria-hidden className="h-4 w-4" />
                Pasar a borrador
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onDuplicate} disabled={busy}>
              <Copy aria-hidden className="h-4 w-4" />
              Duplicar
            </DropdownMenuItem>
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
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProductCard({
  product,
  highlight,
  ...actions
}: ProductActions & {
  product: Product;
  highlight: (text: string) => React.ReactNode;
}) {
  const range = priceRange(product);
  const outOfStock = product.variants.some(isOutOfStock);
  const stock = totalStock(product);
  const controlsStock = product.variants.some((v) => v.stock !== null);

  return (
    <article className="group flex h-full flex-col gap-2 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/40 focus-within:border-foreground/60">
      <button
        type="button"
        onClick={actions.onView}
        aria-label={`Ver ${product.title}`}
        className="relative block w-full overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ProductThumb product={product} className="aspect-[4/3] w-full" iconClassName="h-6 w-6" />
        {product.images.length > 1 ? (
          <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 rounded-pill bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
            <Images aria-hidden className="h-3 w-3" />
            {product.images.length}
          </span>
        ) : null}
      </button>

      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-medium leading-tight">
            {highlight(product.title)}
          </h3>
          <p className="mt-0.5 truncate font-mono text-[10px] uppercase text-muted-foreground">
            {highlight(product.sku)}
          </p>
        </div>
        <ProductActionsMenu product={product} {...actions} />
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
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Existencias</dt>
          <dd className="tabular-nums">
            {controlsStock ? stock.toFixed(2) : <span className="text-muted-foreground">Sin control</span>}
          </dd>
        </div>
      </dl>

      <div className="-mx-1 mt-1 flex items-center justify-between gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={actions.onView}>
          <Eye aria-hidden className="h-3.5 w-3.5" />
          Ver
        </Button>
        {actions.canEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={actions.onEdit}
            aria-label={`Editar ${product.title}`}
          >
            <Pencil aria-hidden className="h-3.5 w-3.5" />
            Editar
          </Button>
        ) : null}
      </div>
    </article>
  );
}
