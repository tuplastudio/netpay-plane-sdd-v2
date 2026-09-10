"use client";
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Archive } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DateTime } from "@/components/app/date-time";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  CATALOG_STATUS_OPTIONS,
  Field,
  TagsInput,
  addVariantSchema,
  apiErrorMessage,
  editProductSchema,
  type AddVariantValues,
  type EditProductValues,
  type Product,
  type Variant,
  type VariantValues,
} from "./catalog-shared";
import { SHEET_FRAME_CLASS, SheetBody, SheetFooterBar, SheetFrameHeader } from "./_components/sheet-frame";
import { VariantsSection } from "./_components/variants-editor";

function isConflict(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 409;
}

export function EditProductSheet({
  product,
  onClose,
  onChanged,
}: {
  product: Product | null;
  onClose: () => void;
  onChanged: () => Promise<unknown> | void;
}) {
  const formId = useId();
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const invalidate = () => onChanged();

  const editForm = useForm<EditProductValues>({
    resolver: zodResolver(editProductSchema),
    values: product
      ? {
          title: product.title,
          description: product.description ?? "",
          tags: product.tags ?? [],
          synonyms: product.synonyms ?? [],
          status: product.status,
        }
      : undefined,
  });

  const updateProduct = useMutation({
    mutationFn: async (v: EditProductValues) => {
      if (!product) return;
      const res = await api.patch(`/catalog/products/${product.id}`, {
        expectedVersion: product.version,
        title: v.title,
        description: v.description || undefined,
        tags: v.tags,
        synonyms: v.synonyms,
        status: v.status,
      });
      return res.data.data as Product;
    },
    onSuccess: async () => {
      toast.success("Producto actualizado");
      await invalidate();
    },
    onError: (error) => {
      if (isConflict(error)) {
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
      onClose();
      await invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo archivar")),
  });

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
      if (isConflict(error)) {
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
      if (!product) return;
      const res = await api.post(`/catalog/products/${product.id}/variants`, {
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

  const onEditSubmit = editForm.handleSubmit((v) => updateProduct.mutate(v));
  const onAddVariantSubmit = addVariantForm.handleSubmit((v) => addVariant.mutate(v));
  const editErrors = editForm.formState.errors;
  // formState es un Proxy: leer `isDirty` en el render activa la suscripción.
  const isDirty = editForm.formState.isDirty;

  // Cerrar con cambios sin guardar en el producto pide confirmación.
  const requestClose = () => {
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };
  const discard = () => {
    editForm.reset();
    setDiscardOpen(false);
    onClose();
  };

  return (
    <>
      <Sheet open={!!product} onOpenChange={(open) => !open && requestClose()}>
        <SheetContent className={SHEET_FRAME_CLASS}>
          {product && (
            <>
              <SheetFrameHeader>
                <SheetTitle className="truncate">{product.title}</SheetTitle>
                <SheetDescription>
                  <span className="font-mono text-xs">{product.sku}</span> · versión{" "}
                  <span className="tabular-nums">{product.version}</span> · actualizado{" "}
                  <DateTime value={product.updatedAt} />
                </SheetDescription>
                <div>
                  <StatusBadge status={product.status} domain="catalog" withDot />
                </div>
              </SheetFrameHeader>

              <SheetBody className="space-y-6">
                <form id={formId} onSubmit={onEditSubmit} noValidate className="space-y-4">
                  <Field label="Título" error={editErrors.title?.message}>
                    {(p) => <Input {...p} {...editForm.register("title")} />}
                  </Field>
                  <Field label="Descripción" error={editErrors.description?.message}>
                    {(p) => <Textarea rows={3} {...p} {...editForm.register("description")} />}
                  </Field>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field
                      label="Tags"
                      hint="Categorización, visible en filtros. Enter o coma para agregar."
                      error={editErrors.tags?.message}
                    >
                      {(p) => (
                        <TagsInput
                          {...p}
                          value={editForm.watch("tags")}
                          onChange={(next) => editForm.setValue("tags", next, { shouldDirty: true })}
                          placeholder="ej. pintura mate"
                        />
                      )}
                    </Field>
                    <Field
                      label="Sinónimos"
                      hint="Términos que el agente debe reconocer; el cliente no los ve."
                      error={editErrors.synonyms?.message}
                    >
                      {(p) => (
                        <TagsInput
                          {...p}
                          value={editForm.watch("synonyms")}
                          onChange={(next) =>
                            editForm.setValue("synonyms", next, { shouldDirty: true })
                          }
                          placeholder="ej. cubeta grande"
                        />
                      )}
                    </Field>
                  </div>
                  <Field
                    label="Estado"
                    hint="Solo los productos activos se ofrecen al cliente."
                    error={editErrors.status?.message}
                  >
                    {(p) => (
                      <Select {...p} {...editForm.register("status")}>
                        {CATALOG_STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </form>

                <VariantsSection
                  variants={product.variants}
                  onSaveVariant={(variant, values) => updateVariant.mutate({ variant, values })}
                  savingVariantId={
                    updateVariant.isPending ? updateVariant.variables?.variant.id : undefined
                  }
                  addForm={addVariantForm}
                  onAddSubmit={onAddVariantSubmit}
                  adding={addVariant.isPending}
                />
              </SheetBody>

              <SheetFooterBar
                start={
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={archiveProduct.isPending || product.status === "ARCHIVED"}
                    onClick={() => setArchiveConfirmOpen(true)}
                  >
                    <Archive aria-hidden className="h-4 w-4" />
                    Archivar
                  </Button>
                }
              >
                <Button type="button" variant="outline" onClick={requestClose}>
                  Cancelar
                </Button>
                <Button type="submit" form={formId} loading={updateProduct.isPending}>
                  Guardar cambios
                </Button>
              </SheetFooterBar>
            </>
          )}
        </SheetContent>
      </Sheet>

      {product ? (
        <ConfirmDialog
          open={archiveConfirmOpen}
          onOpenChange={setArchiveConfirmOpen}
          title={`¿Archivar "${product.title}"?`}
          description="Deja de venderse y el agente ya no lo ofrece. No se borra: podrás reactivarlo cambiando su estado."
          confirmLabel="Archivar"
          pending={archiveProduct.isPending}
          onConfirm={() => {
            archiveProduct.mutate(product.id, {
              onSuccess: () => setArchiveConfirmOpen(false),
            });
          }}
        />
      ) : null}

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="¿Descartar los cambios?"
        description="Los cambios en el producto no se han guardado."
        confirmLabel="Descartar"
        cancelLabel="Seguir editando"
        onConfirm={discard}
      />
    </>
  );
}
