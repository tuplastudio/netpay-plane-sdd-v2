"use client";
import { useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Layers, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Section } from "@/components/app/section";
import { Money } from "@/components/app/money";
import {
  CATALOG_STATUS_OPTIONS,
  Field,
  ORIGIN_SYSTEM_OPTIONS,
  ORIGIN_SYSTEM_OTHER_VALUE,
  originSystemToFormValue,
  variantSchema,
  type AddVariantValues,
  type Variant,
  type VariantValues,
} from "../catalog-shared";
import { isOutOfStock } from "./product-helpers";
import { ImageGallery } from "./image-gallery";

export function VariantsSection({
  variants,
  onSaveVariant,
  savingVariantId,
  addForm,
  onAddSubmit,
  adding,
  onImagesChanged,
}: {
  variants: Variant[];
  onSaveVariant: (variant: Variant, values: VariantValues) => void;
  savingVariantId: string | undefined;
  addForm: UseFormReturn<AddVariantValues>;
  onAddSubmit: (e?: React.BaseSyntheticEvent) => Promise<void>;
  adding: boolean;
  /** Refresca el producto tras subir/borrar una foto de variante. */
  onImagesChanged: () => Promise<unknown> | void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const addErrors = addForm.formState.errors;

  const closeAdd = () => {
    addForm.reset();
    setAddOpen(false);
  };

  return (
    <Section
      as="h3"
      density="compact"
      padded={false}
      title="Variantes"
      description="Cada presentación con su precio, claves SAT y estado."
      actions={
        addOpen ? null : (
          <Button type="button" size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus aria-hidden className="h-4 w-4" />
            Agregar
          </Button>
        )
      }
      footer={
        addOpen ? (
          <form onSubmit={onAddSubmit} noValidate className="w-full space-y-4">
            <p className="text-sm font-semibold">Nueva variante</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="SKU" error={addErrors.sku?.message}>
                {(p) => <Input autoFocus placeholder="ej. PINT-MATE-1L-BLA" {...p} {...addForm.register("sku")} />}
              </Field>
              <Field label="Título" error={addErrors.title?.message}>
                {(p) => <Input placeholder="ej. Blanco, 1 L" {...p} {...addForm.register("title")} />}
              </Field>
              <Field label="Precio" hint="Formato 99.00" error={addErrors.price?.message}>
                {(p) => (
                  <Input inputMode="decimal" placeholder="99.00" {...p} {...addForm.register("price")} />
                )}
              </Field>
              <Field label="Clave SAT de producto" error={addErrors.satProductCode?.message}>
                {(p) => (
                  <Input
                    inputMode="numeric"
                    placeholder="01010101"
                    {...p}
                    {...addForm.register("satProductCode")}
                  />
                )}
              </Field>
              <Field label="Clave SAT de unidad" error={addErrors.satUnitCode?.message}>
                {(p) => <Input placeholder="H87" {...p} {...addForm.register("satUnitCode")} />}
              </Field>
              <Field
                label="Existencias"
                hint="Vacío = sin control de inventario. Formato 25 o 25.500."
                error={addErrors.stock?.message}
              >
                {(p) => <Input inputMode="decimal" placeholder="Sin control" {...p} {...addForm.register("stock")} />}
              </Field>
              <Field
                label="Sistema de origen"
                hint="Si este producto viene de una tienda o ERP externo."
                error={addErrors.originSystem?.message}
              >
                {(p) => (
                  <Select {...p} {...addForm.register("originSystem")}>
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
              {addForm.watch("originSystem") === ORIGIN_SYSTEM_OTHER_VALUE ? (
                <Field label="Nombre del sistema" error={addErrors.originSystemOther?.message}>
                  {(p) => (
                    <Input placeholder="Nombre de tu tienda o ERP" {...p} {...addForm.register("originSystemOther")} />
                  )}
                </Field>
              ) : null}
              <Field
                label="ID en el sistema de origen"
                hint="El identificador que usa ese sistema para este producto."
                error={addErrors.originExternalId?.message}
              >
                {(p) => <Input placeholder="12345" {...p} {...addForm.register("originExternalId")} />}
              </Field>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={closeAdd}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" loading={adding}>
                Agregar variante
              </Button>
            </div>
          </form>
        ) : undefined
      }
    >
      {variants.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={<Layers className="h-6 w-6" />}
          title="Sin variantes"
          description="Agrega al menos una para que el producto se pueda vender."
          action={
            addOpen ? undefined : (
              <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
                <Plus aria-hidden className="h-4 w-4" />
                Agregar variante
              </Button>
            )
          }
        />
      ) : (
        <ul className="divide-y">
          {variants.map((variant) => (
            <li key={variant.id}>
              <VariantRow
                variant={variant}
                saving={savingVariantId === variant.id}
                onSave={(values) => onSaveVariant(variant, values)}
                onImagesChanged={onImagesChanged}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function VariantRow({
  variant,
  onSave,
  saving,
  onImagesChanged,
}: {
  variant: Variant;
  onSave: (values: VariantValues) => void;
  saving: boolean;
  onImagesChanged: () => Promise<unknown> | void;
}) {
  const [editing, setEditing] = useState(false);
  const form = useForm<VariantValues>({
    resolver: zodResolver(variantSchema),
    values: {
      title: variant.title,
      price: variant.price,
      stock: variant.stock ?? "",
      satProductCode: variant.satProductCode,
      satUnitCode: variant.satUnitCode,
      status: variant.status,
      ...originSystemToFormValue(variant.originSystem),
      originExternalId: variant.originExternalId ?? "",
    },
  });
  const errors = form.formState.errors;

  if (!editing) {
    return (
      <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {variant.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- foto de catálogo servida por el API
            <img
              src={variant.images[0].url}
              alt=""
              className="h-10 w-10 shrink-0 rounded-md border object-cover"
            />
          ) : null}
          <div className="min-w-0 space-y-0.5">
          <p className="truncate text-sm font-medium">{variant.title}</p>
          <p className="font-mono text-xs text-muted-foreground">{variant.sku}</p>
          <p className="text-xs text-muted-foreground">
            {variant.stock === null ? (
              "Sin control de inventario"
            ) : isOutOfStock(variant) ? (
              <Badge variant="warning" size="sm">
                Sin existencias
              </Badge>
            ) : (
              <>
                Existencias: <span className="tabular-nums">{variant.stock}</span>
              </>
            )}
            {variant.originSystem ? (
              <>
                {" · "}
                {variant.originSystem}
                {variant.originExternalId ? ` #${variant.originExternalId}` : ""}
              </>
            ) : null}
          </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <Money value={variant.price} className="text-sm font-medium" />
          <div className="flex items-center gap-1">
            <StatusBadge status={variant.status} domain="catalog" size="sm" />
            {saving ? (
              <Spinner size="sm" label="Guardando variante…" />
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Editar variante ${variant.sku}`}
                onClick={() => setEditing(true)}
              >
                <Pencil aria-hidden className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-4 bg-muted p-3"
      noValidate
      onSubmit={form.handleSubmit((values) => {
        onSave(values);
        setEditing(false);
      })}
    >
      <p className="text-sm">
        <span className="font-semibold">Editando</span>{" "}
        <span className="font-mono text-xs text-muted-foreground">{variant.sku}</span>
      </p>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Fotos de esta variante</p>
        <ImageGallery
          compact
          images={variant.images}
          uploadUrl={`/catalog/variants/${variant.id}/images`}
          onChanged={onImagesChanged}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Título" className="sm:col-span-2" error={errors.title?.message}>
          {(p) => <Input autoFocus placeholder="ej. Blanco, 1 L" {...p} {...form.register("title")} />}
        </Field>
        <Field label="Precio" hint="Formato 99.00" error={errors.price?.message}>
          {(p) => <Input inputMode="decimal" placeholder="99.00" {...p} {...form.register("price")} />}
        </Field>
        <Field label="Estado" error={errors.status?.message}>
          {(p) => (
            <Select {...p} {...form.register("status")}>
              {CATALOG_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Clave SAT de producto" error={errors.satProductCode?.message}>
          {(p) => <Input inputMode="numeric" placeholder="01010101" {...p} {...form.register("satProductCode")} />}
        </Field>
        <Field label="Clave SAT de unidad" error={errors.satUnitCode?.message}>
          {(p) => <Input placeholder="H87" {...p} {...form.register("satUnitCode")} />}
        </Field>
        <Field
          label="Existencias"
          hint="Vacío = sin control de inventario. Formato 25 o 25.500."
          error={errors.stock?.message}
        >
          {(p) => <Input inputMode="decimal" placeholder="Sin control" {...p} {...form.register("stock")} />}
        </Field>
        <Field
          label="Sistema de origen"
          hint="Si esta variante viene de una tienda o ERP externo."
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
        {form.watch("originSystem") === ORIGIN_SYSTEM_OTHER_VALUE ? (
          <Field label="Nombre del sistema" error={errors.originSystemOther?.message}>
            {(p) => <Input placeholder="Nombre de tu tienda o ERP" {...p} {...form.register("originSystemOther")} />}
          </Field>
        ) : null}
        <Field
          label="ID en el sistema de origen"
          className="sm:col-span-2"
          hint="El identificador que usa ese sistema para este producto."
          error={errors.originExternalId?.message}
        >
          {(p) => <Input placeholder="12345" {...p} {...form.register("originExternalId")} />}
        </Field>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            form.reset();
            setEditing(false);
          }}
        >
          Cancelar
        </Button>
        <Button type="submit" size="sm" loading={saving}>
          Guardar variante
        </Button>
      </div>
    </form>
  );
}
