"use client";
import { useEffect, useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { AlertCircle, Boxes, Images, Info, Layers, Plug } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { InfoTip } from "@/components/app/info-tip";
import {
  CATALOG_FIELD_HELP,
  Field,
  ORIGIN_SYSTEM_OPTIONS,
  ORIGIN_SYSTEM_OTHER_VALUE,
  TagsInput,
  apiErrorMessage,
  createSchema,
  type CreateValues,
  type Product,
} from "./catalog-shared";
import { SHEET_FRAME_CLASS, SheetBody, SheetFooterBar, SheetFrameHeader } from "./_components/sheet-frame";
import { FormSection } from "./_components/form-section";
import { ImageDropzone, UploadQueueList, useImageUploadQueue } from "./_components/image-upload";
import { suggestVariantSku, toCreateProductPayload } from "./_components/product-form";

const EMPTY_VALUES: CreateValues = {
  sku: "",
  title: "",
  description: "",
  tags: [],
  synonyms: [],
  variantSku: "",
  variantTitle: "",
  price: "",
  stock: "",
  satProductCode: "",
  satUnitCode: "",
  originSystem: "",
  originSystemOther: "",
  originExternalId: "",
};

/**
 * Alta de producto en un solo panel: básicos, precio e inventario, variante
 * inicial, origen y fotos. Las fotos se eligen aquí pero se suben justo
 * después de crear el producto (necesitan su id); si alguna falla, el
 * producto ya existe y se puede completar desde "Editar".
 */
export function CreateProductSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Recibe el producto creado (para abrirlo a editar, p. ej.). */
  onCreated: (product: Product) => Promise<unknown> | void;
}) {
  const formId = useId();
  const [discardOpen, setDiscardOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "creating" | "uploading">("idle");

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: EMPTY_VALUES,
  });
  const queue = useImageUploadQueue();

  // Sugerencia de SKU de variante mientras el usuario no escriba uno propio.
  const sku = form.watch("sku");
  useEffect(() => {
    if (form.getFieldState("variantSku").isDirty) return;
    form.setValue("variantSku", suggestVariantSku(sku), { shouldDirty: false });
  }, [sku, form]);

  const createProduct = useMutation({
    mutationFn: async (v: CreateValues) => {
      setPhase("creating");
      const res = await api.post("/catalog/products", toCreateProductPayload(v));
      return res.data.data as Product;
    },
    onSuccess: async (product) => {
      let uploads = { done: 0, failed: 0 };
      if (queue.queuedCount > 0) {
        setPhase("uploading");
        uploads = await queue.uploadAll(`/catalog/products/${product.id}/images`);
      }
      setPhase("idle");
      if (uploads.failed > 0) {
        toast.warning(
          `Producto creado; ${uploads.failed} ${uploads.failed === 1 ? "foto no se pudo subir" : "fotos no se pudieron subir"}. Puedes reintentarlo desde Editar.`,
        );
      } else if (uploads.done > 0) {
        toast.success(`Producto creado con ${uploads.done} ${uploads.done === 1 ? "foto" : "fotos"}`);
      } else {
        toast.success("Producto creado");
      }
      form.reset(EMPTY_VALUES);
      queue.reset();
      onOpenChange(false);
      await onCreated(product);
    },
    onError: (error) => {
      setPhase("idle");
      toast.error(apiErrorMessage(error, "No se pudo crear el producto"));
    },
  });

  const errors = form.formState.errors;
  // formState es un Proxy: hay que leer `isDirty` durante el render para que
  // RHF se suscriba; leerlo solo dentro del handler lo dejaría desactualizado.
  const isDirty = form.formState.isDirty || queue.items.length > 0;
  const onSubmit = form.handleSubmit((v) => createProduct.mutate(v));
  const pending = phase !== "idle";

  // Cerrar con cambios sin guardar pide confirmación: Escape, clic fuera y
  // "Cancelar" pasan todos por aquí. Mientras se crea/sube no se cierra.
  const requestClose = () => {
    if (pending) return;
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  };
  const discard = () => {
    form.reset(EMPTY_VALUES);
    queue.reset();
    createProduct.reset();
    setDiscardOpen(false);
    onOpenChange(false);
  };

  const originSystem = form.watch("originSystem");

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

              <FormSection
                icon={<Info className="h-4 w-4" />}
                title="Básicos"
                description="Cómo se identifica y cómo lo encuentra el agente."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    label="SKU"
                    labelExtra={<InfoTip label="SKU" text={CATALOG_FIELD_HELP.sku} />}
                    error={errors.sku?.message}
                  >
                    {(p) => (
                      <Input
                        autoFocus
                        className="font-mono"
                        placeholder="ej. PINT-MATE-1L"
                        autoComplete="off"
                        {...p}
                        {...form.register("sku")}
                      />
                    )}
                  </Field>
                  <Field label="Título" error={errors.title?.message}>
                    {(p) => <Input placeholder="ej. Pintura vinílica mate" {...p} {...form.register("title")} />}
                  </Field>
                </div>
                <Field
                  label="Descripción"
                  hint="Opcional. El agente la usa para responder dudas del cliente."
                  error={errors.description?.message}
                >
                  {(p) => (
                    <Textarea
                      rows={3}
                      placeholder="Material, usos, presentación, qué incluye…"
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
                        placeholder="ej. pintura, interiores"
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
              </FormSection>

              <FormSection
                icon={<Boxes className="h-4 w-4" />}
                title="Precio e inventario"
                description="De la variante inicial. Cada variante tiene el suyo."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Precio" hint="Formato 99.00, en MXN." error={errors.price?.message}>
                    {(p) => <Input inputMode="decimal" placeholder="99.00" {...p} {...form.register("price")} />}
                  </Field>
                  <Field
                    label="Existencias"
                    labelExtra={<InfoTip label="Existencias" text={CATALOG_FIELD_HELP.stock} />}
                    hint="Vacío = sin control de inventario. Formato 25 o 25.500."
                    error={errors.stock?.message}
                  >
                    {(p) => <Input inputMode="decimal" placeholder="Sin control" {...p} {...form.register("stock")} />}
                  </Field>
                  <Field
                    label="Clave SAT de producto"
                    labelExtra={<InfoTip label="Clave SAT de producto" text={CATALOG_FIELD_HELP.satProductCode} />}
                    hint="Opcional; si se omite se usa 01010101."
                    error={errors.satProductCode?.message}
                  >
                    {(p) => (
                      <Input inputMode="numeric" placeholder="01010101" {...p} {...form.register("satProductCode")} />
                    )}
                  </Field>
                  <Field
                    label="Clave SAT de unidad"
                    labelExtra={<InfoTip label="Clave SAT de unidad" text={CATALOG_FIELD_HELP.satUnitCode} />}
                    hint="Opcional; si se omite se usa H87 (pieza)."
                    error={errors.satUnitCode?.message}
                  >
                    {(p) => <Input placeholder="H87" {...p} {...form.register("satUnitCode")} />}
                  </Field>
                </div>
              </FormSection>

              <FormSection
                icon={<Layers className="h-4 w-4" />}
                title="Variante inicial"
                description="La presentación que se venderá. Podrás agregar más después."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    label="SKU de la variante"
                    hint="Se sugiere a partir del SKU del producto; puedes cambiarlo."
                    error={errors.variantSku?.message}
                  >
                    {(p) => (
                      <Input
                        className="font-mono"
                        placeholder="ej. PINT-MATE-1L-BLA"
                        autoComplete="off"
                        {...p}
                        {...form.register("variantSku")}
                      />
                    )}
                  </Field>
                  <Field label="Título de la variante" error={errors.variantTitle?.message}>
                    {(p) => <Input placeholder="ej. Blanco, 1 L" {...p} {...form.register("variantTitle")} />}
                  </Field>
                </div>
              </FormSection>

              <FormSection
                icon={<Plug className="h-4 w-4" />}
                title="Origen"
                description="Solo si el producto viene de una tienda o ERP externo."
                collapsible
                defaultOpen={false}
                hasError={!!(errors.originSystem || errors.originSystemOther || errors.originExternalId)}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    label="Sistema de origen"
                    labelExtra={<InfoTip label="Sistema de origen" text={CATALOG_FIELD_HELP.originSystem} />}
                    error={errors.originSystem?.message}
                  >
                    {(p) => (
                      <Select {...p} {...form.register("originSystem")}>
                        <option value="">Sin sistema de origen</option>
                        {ORIGIN_SYSTEM_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                        <option value={ORIGIN_SYSTEM_OTHER_VALUE}>Otro…</option>
                      </Select>
                    )}
                  </Field>
                  {originSystem === ORIGIN_SYSTEM_OTHER_VALUE ? (
                    <Field label="Nombre del sistema" error={errors.originSystemOther?.message}>
                      {(p) => (
                        <Input placeholder="Nombre de tu tienda o ERP" {...p} {...form.register("originSystemOther")} />
                      )}
                    </Field>
                  ) : null}
                  <Field
                    label="ID en el sistema de origen"
                    hint="El identificador que usa ese sistema para este producto."
                    error={errors.originExternalId?.message}
                  >
                    {(p) => <Input placeholder="12345" {...p} {...form.register("originExternalId")} />}
                  </Field>
                </div>
              </FormSection>

              <FormSection
                icon={<Images className="h-4 w-4" />}
                title="Fotos"
                description="Se suben al crear el producto. La primera de la lista será la portada."
              >
                <ImageDropzone onFiles={queue.addFiles} disabled={pending} />
                <UploadQueueList queue={queue} />
              </FormSection>
            </form>
          </SheetBody>

          <SheetFooterBar>
            <Button type="button" variant="outline" onClick={requestClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              {phase === "uploading"
                ? "Subiendo fotos…"
                : queue.queuedCount > 0
                  ? `Crear producto y subir ${queue.queuedCount} ${queue.queuedCount === 1 ? "foto" : "fotos"}`
                  : "Crear producto"}
            </Button>
          </SheetFooterBar>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="¿Descartar el producto?"
        description="Perderás lo que capturaste en este formulario, fotos incluidas."
        confirmLabel="Descartar"
        cancelLabel="Seguir editando"
        onConfirm={discard}
      />
    </>
  );
}
