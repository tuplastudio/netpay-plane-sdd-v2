"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Pencil, Archive, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { PageHeader } from "@/components/app/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";

type CatalogStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

interface Variant {
  id: string;
  sku: string;
  title: string;
  price: string;
  stock: string | null;
  satProductCode: string;
  satUnitCode: string;
  status: CatalogStatus;
  version: number;
}

interface Product {
  id: string;
  sku: string;
  title: string;
  description: string | null;
  status: CatalogStatus;
  version: number;
  updatedAt: string;
  variants: Variant[];
}

// Mismas reglas que apps/commerce-api/src/catalog/catalog.dto.ts: si el
// formulario deja pasar algo que el backend rechaza, el usuario solo ve un
// 400 genérico. Validar acá evita ese viaje redondo.
const SKU_RE = /^[A-Za-z0-9._-]+$/;
const PRICE_RE = /^\d{1,10}\.\d{2}$/;
const SAT_PRODUCT_RE = /^\d{8}$/;
const SAT_UNIT_RE = /^[A-Z0-9]{2,3}$/;

const skuField = z.string().min(1, "requerido").max(64).regex(SKU_RE, "solo letras, números, . _ -");
const titleField = z.string().min(1, "requerido").max(200);
const priceField = z.string().regex(PRICE_RE, "formato NN.NN");
const satProductField = z.string().regex(SAT_PRODUCT_RE, "8 dígitos").optional().or(z.literal(""));
const satUnitField = z.string().regex(SAT_UNIT_RE, "2-3 letras/números").optional().or(z.literal(""));

const createSchema = z.object({
  sku: skuField,
  title: titleField,
  description: z.string().max(2000).optional().or(z.literal("")),
  variantSku: skuField,
  variantTitle: titleField,
  price: priceField,
  satProductCode: satProductField,
  satUnitCode: satUnitField,
});
type CreateValues = z.infer<typeof createSchema>;

const editProductSchema = z.object({
  title: titleField,
  description: z.string().max(2000).optional().or(z.literal("")),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
});
type EditProductValues = z.infer<typeof editProductSchema>;

const variantSchema = z.object({
  title: titleField,
  price: priceField,
  satProductCode: satProductField,
  satUnitCode: satUnitField,
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
});
type VariantValues = z.infer<typeof variantSchema>;

const addVariantSchema = z.object({
  sku: skuField,
  title: titleField,
  price: priceField,
  satProductCode: satProductField,
  satUnitCode: satUnitField,
});
type AddVariantValues = z.infer<typeof addVariantSchema>;

function statusVariant(status: CatalogStatus): "success" | "warning" | "muted" {
  if (status === "ACTIVE") return "success";
  if (status === "DRAFT") return "warning";
  return "muted";
}

function apiErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { message?: string; error?: { message?: string } } } })
    ?.response?.data;
  return detail?.message ?? detail?.error?.message ?? fallback;
}

export default function CatalogPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<CatalogStatus | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

  const list = useQuery({
    queryKey: ["products", { q, status }],
    queryFn: async () => {
      const res = await api.get<{ data: Product[] }>("/catalog/products", {
        params: { q: q || undefined, status: status || undefined },
      });
      return res.data.data;
    },
  });

  const editing = list.data?.find((p) => p.id === editingId) ?? null;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["products"] });

  // ---------------- crear producto ----------------

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      sku: "",
      title: "",
      description: "",
      variantSku: "",
      variantTitle: "",
      price: "",
      satProductCode: "",
      satUnitCode: "",
    },
  });

  const createProduct = useMutation({
    mutationFn: async (v: CreateValues) => {
      const res = await api.post("/catalog/products", {
        sku: v.sku,
        title: v.title,
        description: v.description || undefined,
        variants: [
          {
            sku: v.variantSku,
            title: v.variantTitle,
            price: v.price,
            satProductCode: v.satProductCode || undefined,
            satUnitCode: v.satUnitCode || undefined,
          },
        ],
      });
      return res.data.data as Product;
    },
    onSuccess: async () => {
      toast.success("Producto creado");
      createForm.reset();
      setCreateOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo crear el producto")),
  });

  // ---------------- editar producto ----------------

  const editForm = useForm<EditProductValues>({
    resolver: zodResolver(editProductSchema),
    values: editing
      ? { title: editing.title, description: editing.description ?? "", status: editing.status }
      : undefined,
  });

  const updateProduct = useMutation({
    mutationFn: async (v: EditProductValues) => {
      if (!editing) return;
      const res = await api.patch(`/catalog/products/${editing.id}`, {
        expectedVersion: editing.version,
        title: v.title,
        description: v.description || undefined,
        status: v.status,
      });
      return res.data.data as Product;
    },
    onSuccess: async () => {
      toast.success("Producto actualizado");
      await invalidate();
    },
    onError: (error) => {
      if ((error as { response?: { status?: number } })?.response?.status === 409) {
        toast.error("Alguien más editó este producto. Recargando…");
        void invalidate();
        return;
      }
      toast.error(apiErrorMessage(error, "No se pudo actualizar"));
    },
  });

  const archiveProduct = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/catalog/products/${id}`);
    },
    onSuccess: async () => {
      toast.success("Producto archivado");
      setEditingId(null);
      await invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo archivar")),
  });

  // ---------------- variantes ----------------

  const updateVariant = useMutation({
    mutationFn: async (input: { variant: Variant; values: VariantValues }) => {
      const res = await api.patch(`/catalog/variants/${input.variant.id}`, {
        expectedVersion: input.variant.version,
        title: input.values.title,
        price: input.values.price,
        satProductCode: input.values.satProductCode || undefined,
        satUnitCode: input.values.satUnitCode || undefined,
        status: input.values.status,
      });
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success("Variante actualizada");
      await invalidate();
    },
    onError: (error) => {
      if ((error as { response?: { status?: number } })?.response?.status === 409) {
        toast.error("Alguien más editó esta variante. Recargando…");
        void invalidate();
        return;
      }
      toast.error(apiErrorMessage(error, "No se pudo actualizar la variante"));
    },
  });

  const addVariantForm = useForm<AddVariantValues>({
    resolver: zodResolver(addVariantSchema),
    defaultValues: { sku: "", title: "", price: "", satProductCode: "", satUnitCode: "" },
  });

  const addVariant = useMutation({
    mutationFn: async (v: AddVariantValues) => {
      if (!editing) return;
      const res = await api.post(`/catalog/products/${editing.id}/variants`, {
        sku: v.sku,
        title: v.title,
        price: v.price,
        satProductCode: v.satProductCode || undefined,
        satUnitCode: v.satUnitCode || undefined,
      });
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success("Variante agregada");
      addVariantForm.reset();
      await invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo agregar la variante")),
  });

  const onCreateSubmit = createForm.handleSubmit((v) => createProduct.mutate(v));
  const onEditSubmit = editForm.handleSubmit((v) => updateProduct.mutate(v));
  const onAddVariantSubmit = addVariantForm.handleSubmit((v) => addVariant.mutate(v));

  const priceSummary = useMemo(
    () => (product: Product) => {
      if (product.variants.length === 0) return "—";
      const prices = product.variants.map((v) => Number(v.price)).sort((a, b) => a - b);
      const min = prices[0]!.toFixed(2);
      const max = prices[prices.length - 1]!.toFixed(2);
      return min === max ? `$${min}` : `$${min} – $${max}`;
    },
    [],
  );

  return (
    <div>
      <PageHeader
        title="Catálogo"
        description="Productos, variantes, stock y claves SAT."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Nuevo producto
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por SKU o título…"
          className="sm:max-w-xs"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as CatalogStatus | "")}
          className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm sm:w-48"
        >
          <option value="">Todos los estados</option>
          <option value="DRAFT">Borrador</option>
          <option value="ACTIVE">Activo</option>
          <option value="ARCHIVED">Archivado</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-card border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="p-3">SKU</th>
              <th className="p-3">Título</th>
              <th className="p-3">Estado</th>
              <th className="p-3">Variantes</th>
              <th className="p-3">Precio</th>
              <th className="p-3">Actualizado</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            )}
            {list.data?.map((product) => (
              <tr
                key={product.id}
                className="cursor-pointer border-b hover:bg-accent"
                onClick={() => setEditingId(product.id)}
              >
                <td className="p-3 font-mono text-xs">{product.sku}</td>
                <td className="p-3 font-medium">{product.title}</td>
                <td className="p-3">
                  <Badge variant={statusVariant(product.status)}>{product.status}</Badge>
                </td>
                <td className="p-3 text-muted-foreground">{product.variants.length}</td>
                <td className="p-3 font-mono">{priceSummary(product)}</td>
                <td className="p-3 text-muted-foreground">
                  {new Date(product.updatedAt).toLocaleDateString()}
                </td>
                <td className="p-3 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(product.id)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  No hay productos todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---------------- crear producto ---------------- */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Nuevo producto</SheetTitle>
            <SheetDescription>Se crea como borrador con una variante inicial.</SheetDescription>
          </SheetHeader>
          <form onSubmit={onCreateSubmit} className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="SKU producto" error={createForm.formState.errors.sku?.message}>
                <Input {...createForm.register("sku")} />
              </Field>
              <Field label="Título" error={createForm.formState.errors.title?.message}>
                <Input {...createForm.register("title")} />
              </Field>
            </div>
            <Field label="Descripción" error={createForm.formState.errors.description?.message}>
              <Textarea {...createForm.register("description")} />
            </Field>

            <div className="border-t pt-4">
              <p className="mb-3 text-sm font-medium">Variante inicial</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="SKU variante" error={createForm.formState.errors.variantSku?.message}>
                  <Input {...createForm.register("variantSku")} />
                </Field>
                <Field label="Título variante" error={createForm.formState.errors.variantTitle?.message}>
                  <Input {...createForm.register("variantTitle")} />
                </Field>
                <Field label="Precio (NN.NN)" error={createForm.formState.errors.price?.message}>
                  <Input placeholder="99.00" {...createForm.register("price")} />
                </Field>
                <Field label="Clave SAT producto" error={createForm.formState.errors.satProductCode?.message}>
                  <Input placeholder="01010101" {...createForm.register("satProductCode")} />
                </Field>
                <Field label="Clave SAT unidad" error={createForm.formState.errors.satUnitCode?.message}>
                  <Input placeholder="H87" {...createForm.register("satUnitCode")} />
                </Field>
              </div>
            </div>

            <Button type="submit" disabled={createProduct.isPending} className="w-full">
              {createProduct.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {createProduct.isPending ? "Creando…" : "Crear producto"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      {/* ---------------- editar producto ---------------- */}
      <Sheet open={!!editing} onOpenChange={(open) => !open && setEditingId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {editing && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono">{editing.sku}</SheetTitle>
                <SheetDescription>
                  Versión {editing.version} · última actualización {new Date(editing.updatedAt).toLocaleString()}
                </SheetDescription>
              </SheetHeader>

              <form onSubmit={onEditSubmit} className="mt-6 space-y-4">
                <Field label="Título" error={editForm.formState.errors.title?.message}>
                  <Input {...editForm.register("title")} />
                </Field>
                <Field label="Descripción" error={editForm.formState.errors.description?.message}>
                  <Textarea {...editForm.register("description")} />
                </Field>
                <Field label="Estado" error={editForm.formState.errors.status?.message}>
                  <select
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    {...editForm.register("status")}
                  >
                    <option value="DRAFT">Borrador</option>
                    <option value="ACTIVE">Activo</option>
                    <option value="ARCHIVED">Archivado</option>
                  </select>
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" disabled={updateProduct.isPending}>
                    {updateProduct.isPending ? "Guardando…" : "Guardar cambios"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={archiveProduct.isPending || editing.status === "ARCHIVED"}
                    onClick={() => setArchiveConfirmOpen(true)}
                  >
                    <Archive className="h-4 w-4" />
                    Archivar
                  </Button>
                </div>
              </form>

              <ConfirmDialog
                open={archiveConfirmOpen}
                onOpenChange={setArchiveConfirmOpen}
                title={`¿Archivar "${editing.title}"?`}
                description="Deja de venderse pero no se borra."
                confirmLabel="Archivar"
                pending={archiveProduct.isPending}
                onConfirm={() => {
                  archiveProduct.mutate(editing.id, {
                    onSuccess: () => setArchiveConfirmOpen(false),
                  });
                }}
              />

              <div className="mt-8 border-t pt-4">
                <p className="mb-3 text-sm font-medium">Variantes</p>
                <div className="space-y-3">
                  {editing.variants.map((variant) => (
                    <VariantEditor
                      key={variant.id}
                      variant={variant}
                      onSave={(values) => updateVariant.mutate({ variant, values })}
                      saving={updateVariant.isPending}
                    />
                  ))}
                </div>

                <form onSubmit={onAddVariantSubmit} className="mt-4 space-y-2 rounded-md border border-dashed p-3">
                  <p className="text-xs font-medium text-muted-foreground">Agregar variante</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="SKU" {...addVariantForm.register("sku")} />
                    <Input placeholder="Título" {...addVariantForm.register("title")} />
                    <Input placeholder="Precio NN.NN" {...addVariantForm.register("price")} />
                    <Input placeholder="Clave SAT (opc.)" {...addVariantForm.register("satProductCode")} />
                  </div>
                  {(addVariantForm.formState.errors.sku ||
                    addVariantForm.formState.errors.title ||
                    addVariantForm.formState.errors.price) && (
                    <p className="text-xs text-destructive">Revisa SKU, título y precio (NN.NN).</p>
                  )}
                  <Button type="submit" size="sm" variant="outline" disabled={addVariant.isPending}>
                    <Plus className="h-3.5 w-3.5" />
                    {addVariant.isPending ? "Agregando…" : "Agregar"}
                  </Button>
                </form>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function VariantEditor({
  variant,
  onSave,
  saving,
}: {
  variant: Variant;
  onSave: (values: VariantValues) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const form = useForm<VariantValues>({
    resolver: zodResolver(variantSchema),
    values: {
      title: variant.title,
      price: variant.price,
      satProductCode: variant.satProductCode,
      satUnitCode: variant.satUnitCode,
      status: variant.status,
    },
  });

  if (!editing) {
    return (
      <div className="flex items-center justify-between rounded-md border p-2 text-sm">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{variant.sku}</p>
          <p>
            {variant.title} · <span className="font-mono">${variant.price}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(variant.status)}>{variant.status}</Badge>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-2 rounded-md border p-2"
      onSubmit={form.handleSubmit((values) => {
        onSave(values);
        setEditing(false);
      })}
    >
      <p className="font-mono text-xs text-muted-foreground">{variant.sku}</p>
      <div className="grid grid-cols-2 gap-2">
        <Input {...form.register("title")} />
        <Input {...form.register("price")} />
        <Input {...form.register("satProductCode")} placeholder="Clave SAT" />
        <Input {...form.register("satUnitCode")} placeholder="Unidad SAT" />
        <select
          className="col-span-2 flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          {...form.register("status")}
        >
          <option value="DRAFT">Borrador</option>
          <option value="ACTIVE">Activo</option>
          <option value="ARCHIVED">Archivado</option>
        </select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
