"use client";
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Field,
  TagsInput,
  apiErrorMessage,
  createSchema,
  type CreateValues,
  type Product,
} from "./catalog-shared";
import { SHEET_FRAME_CLASS, SheetBody, SheetFooterBar, SheetFrameHeader } from "./_components/sheet-frame";

export function CreateProductSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<unknown> | void;
}) {
  const formId = useId();
  const [discardOpen, setDiscardOpen] = useState(false);

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      sku: "",
      title: "",
      description: "",
      tags: [],
      synonyms: [],
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
        tags: v.tags,
        synonyms: v.synonyms,
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
      form.reset();
      onOpenChange(false);
      await onCreated();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo crear el producto")),
  });

  const errors = form.formState.errors;
  // formState es un Proxy: hay que leer `isDirty` durante el render para que
  // RHF se suscriba; leerlo solo dentro del handler lo dejaría desactualizado.
  const isDirty = form.formState.isDirty;
  const onSubmit = form.handleSubmit((v) => createProduct.mutate(v));

  // Cerrar con cambios sin guardar pide confirmación: Escape, clic fuera y
  // "Cancelar" pasan todos por aquí.
  const requestClose = () => {
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  };
  const discard = () => {
    form.reset();
    createProduct.reset();
    setDiscardOpen(false);
    onOpenChange(false);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
        <SheetContent className={SHEET_FRAME_CLASS}>
          <SheetFrameHeader>
            <SheetTitle>Nuevo producto</SheetTitle>
            <SheetDescription>
              Se crea como borrador con una variante inicial. Podrás activarlo cuando esté listo.
            </SheetDescription>
          </SheetFrameHeader>

          <SheetBody>
            <form id={formId} onSubmit={onSubmit} noValidate className="space-y-6">
              {createProduct.isError ? (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>No se pudo crear el producto</AlertTitle>
                  <AlertDescription>
                    <p>{apiErrorMessage(createProduct.error, "Revisa los campos marcados.")}</p>
                  </AlertDescription>
                </Alert>
              ) : null}

              <fieldset className="min-w-0">
                <legend className="text-sm font-semibold">Producto</legend>
                <div className="mt-3 space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="SKU" error={errors.sku?.message}>
                      {(p) => (
                        <Input
                          autoFocus
                          className="font-mono"
                          placeholder="ej. PINT-MATE-1L"
                          {...p}
                          {...form.register("sku")}
                        />
                      )}
                    </Field>
                    <Field label="Título" error={errors.title?.message}>
                      {(p) => <Input placeholder="ej. Pintura vinílica mate" {...p} {...form.register("title")} />}
                    </Field>
                  </div>
                  <Field label="Descripción" error={errors.description?.message}>
                    {(p) => (
                      <Textarea
                        rows={3}
                        placeholder="Detalle visible para el agente y en la ficha del producto."
                        {...p}
                        {...form.register("description")}
                      />
                    )}
                  </Field>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field
                      label="Tags"
                      hint="Categorización, visible en filtros. Enter o coma para agregar."
                      error={errors.tags?.message}
                    >
                      {(p) => (
                        <TagsInput
                          {...p}
                          value={form.watch("tags")}
                          onChange={(next) => form.setValue("tags", next, { shouldDirty: true })}
                          placeholder="ej. pintura mate"
                        />
                      )}
                    </Field>
                    <Field
                      label="Sinónimos"
                      hint="Términos que el agente debe reconocer; el cliente no los ve."
                      error={errors.synonyms?.message}
                    >
                      {(p) => (
                        <TagsInput
                          {...p}
                          value={form.watch("synonyms")}
                          onChange={(next) => form.setValue("synonyms", next, { shouldDirty: true })}
                          placeholder="ej. cubeta grande"
                        />
                      )}
                    </Field>
                  </div>
                </div>
              </fieldset>

              <fieldset className="min-w-0">
                <legend className="text-sm font-semibold">Variante inicial</legend>
                <p className="mt-1 text-xs text-muted-foreground">
                  La presentación que se venderá. Podrás agregar más después.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="SKU de la variante" error={errors.variantSku?.message}>
                    {(p) => (
                      <Input
                        className="font-mono"
                        placeholder="ej. PINT-MATE-1L-BLA"
                        {...p}
                        {...form.register("variantSku")}
                      />
                    )}
                  </Field>
                  <Field label="Título de la variante" error={errors.variantTitle?.message}>
                    {(p) => <Input placeholder="ej. Blanco, 1 L" {...p} {...form.register("variantTitle")} />}
                  </Field>
                  <Field label="Precio" hint="Formato 99.00" error={errors.price?.message}>
                    {(p) => (
                      <Input inputMode="decimal" placeholder="99.00" {...p} {...form.register("price")} />
                    )}
                  </Field>
                  <Field label="Clave SAT de producto" error={errors.satProductCode?.message}>
                    {(p) => (
                      <Input
                        inputMode="numeric"
                        placeholder="01010101"
                        {...p}
                        {...form.register("satProductCode")}
                      />
                    )}
                  </Field>
                  <Field label="Clave SAT de unidad" error={errors.satUnitCode?.message}>
                    {(p) => <Input placeholder="H87" {...p} {...form.register("satUnitCode")} />}
                  </Field>
                </div>
              </fieldset>
            </form>
          </SheetBody>

          <SheetFooterBar>
            <Button type="button" variant="outline" onClick={requestClose}>
              Cancelar
            </Button>
            <Button type="submit" form={formId} loading={createProduct.isPending}>
              Crear producto
            </Button>
          </SheetFooterBar>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="¿Descartar el producto?"
        description="Perderás lo que capturaste en este formulario."
        confirmLabel="Descartar"
        cancelLabel="Seguir editando"
        onConfirm={discard}
      />
    </>
  );
}
