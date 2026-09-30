"use client";
import * as React from "react";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

// ---------------------------------------------------------------------------
// Tipos del dominio de catálogo (CatalogStatus: DRAFT | ACTIVE | ARCHIVED)
// ---------------------------------------------------------------------------

export type CatalogStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface ProductImage {
  id: string;
  url: string;
  position: number;
  width: number | null;
  height: number | null;
  variantId: string | null;
  /** Texto alternativo opcional; null = usar el título del producto. */
  altText: string | null;
}

export interface Variant {
  id: string;
  sku: string;
  title: string;
  price: string;
  stock: string | null;
  satProductCode: string;
  satUnitCode: string;
  status: CatalogStatus;
  version: number;
  /** Ecommerce/ERP de origen (Shopify, SAP, ...) o null si es nativa de este catálogo. */
  originSystem: string | null;
  /** ID de este producto/variante en ese sistema de origen. */
  originExternalId: string | null;
  /** Fotos propias de esta variante (además de las generales del producto). */
  images: ProductImage[];
}

export {
  ORIGIN_SYSTEM_OPTIONS,
  ORIGIN_SYSTEM_OTHER_VALUE,
  originSystemToFormValue,
  resolveOriginSystem,
} from "./_components/origin-system";

export interface Product {
  id: string;
  sku: string;
  title: string;
  description: string | null;
  tags: string[];
  synonyms: string[];
  status: CatalogStatus;
  version: number;
  updatedAt: string;
  variants: Variant[];
  /** Galería general del producto (portada = position 0). */
  images: ProductImage[];
}

// ---------------------------------------------------------------------------
// Validación — mismas reglas que apps/commerce-api/src/catalog/catalog.dto.ts:
// si el formulario deja pasar algo que el backend rechaza, el usuario solo ve
// un 400 genérico. Validar acá evita ese viaje redondo.
// ---------------------------------------------------------------------------

const SKU_RE = /^[A-Za-z0-9._-]+$/;
const PRICE_RE = /^\d{1,10}\.\d{2}$/;
const SAT_PRODUCT_RE = /^\d{8}$/;
const SAT_UNIT_RE = /^[A-Z0-9]{2,3}$/;

const skuField = z
  .string()
  .min(1, "El SKU es obligatorio")
  .max(64, "Máximo 64 caracteres")
  .regex(SKU_RE, "Solo letras, números y los signos . _ -");
const titleField = z.string().min(1, "El título es obligatorio").max(200, "Máximo 200 caracteres");
const priceField = z.string().regex(PRICE_RE, "Usa el formato 99.00 (dos decimales)");
const satProductField = z
  .string()
  .regex(SAT_PRODUCT_RE, "La clave SAT de producto son 8 dígitos")
  .optional()
  .or(z.literal(""));
const satUnitField = z
  .string()
  .regex(SAT_UNIT_RE, "La clave SAT de unidad son 2 o 3 letras o números en mayúscula")
  .optional()
  .or(z.literal(""));
const descriptionField = z.string().max(2000, "Máximo 2000 caracteres").optional().or(z.literal(""));
const statusField = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"], {
  required_error: "Elige un estado",
});
const keywordListField = z.array(z.string().min(1).max(64)).max(50).default([]);
const STOCK_RE = /^\d{1,15}(\.\d{1,3})?$/;
/** Vacío = sin control de inventario cuando el toggle de "controlar existencias" está apagado. */
const stockField = z
  .string()
  .refine((v) => v === "" || STOCK_RE.test(v), "Cantidad inválida (ej. 25 o 25.500)");
const originSystemField = z.string().max(80, "Máximo 80 caracteres").optional().or(z.literal(""));
const originSystemOtherField = z
  .string()
  .max(80, "Máximo 80 caracteres")
  .optional()
  .or(z.literal(""));
const originExternalIdField = z
  .string()
  .max(120, "Máximo 120 caracteres")
  .optional()
  .or(z.literal(""));

export const createSchema = z.object({
  sku: skuField,
  title: titleField,
  description: descriptionField,
  tags: keywordListField,
  synonyms: keywordListField,
  variantSku: skuField,
  variantTitle: titleField,
  price: priceField,
  stock: stockField,
  satProductCode: satProductField,
  satUnitCode: satUnitField,
  originSystem: originSystemField,
  originSystemOther: originSystemOtherField,
  originExternalId: originExternalIdField,
});
export type CreateValues = z.infer<typeof createSchema>;

export const editProductSchema = z.object({
  title: titleField,
  description: descriptionField,
  tags: keywordListField,
  synonyms: keywordListField,
  status: statusField,
});
export type EditProductValues = z.infer<typeof editProductSchema>;

export const variantSchema = z.object({
  title: titleField,
  price: priceField,
  stock: stockField,
  satProductCode: satProductField,
  satUnitCode: satUnitField,
  status: statusField,
  originSystem: originSystemField,
  originSystemOther: originSystemOtherField,
  originExternalId: originExternalIdField,
});
export type VariantValues = z.infer<typeof variantSchema>;

export const addVariantSchema = z.object({
  sku: skuField,
  title: titleField,
  price: priceField,
  stock: stockField,
  satProductCode: satProductField,
  satUnitCode: satUnitField,
  originSystem: originSystemField,
  originSystemOther: originSystemOtherField,
  originExternalId: originExternalIdField,
});
export type AddVariantValues = z.infer<typeof addVariantSchema>;

export function apiErrorMessage(error: unknown, fallback: string): string {
  const detail = (
    error as { response?: { data?: { message?: string; error?: { message?: string } } } }
  )?.response?.data;
  return detail?.message ?? detail?.error?.message ?? fallback;
}

// ---------------------------------------------------------------------------
// Campo de formulario
// ---------------------------------------------------------------------------

export interface FieldRenderProps {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}

/**
 * Par etiqueta/control con el cableado accesible completo: `htmlFor` real,
 * `aria-invalid` cuando hay error y `aria-describedby` apuntando al mensaje de
 * error y/o a la ayuda. El control se recibe como función para que el `id`
 * generado llegue al input sin que cada pantalla lo invente.
 */
export function Field({
  label,
  labelExtra,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  /** Hermano de la etiqueta (p. ej. un `InfoTip`); fuera del `<label>` para que un clic no enfoque el control. */
  labelExtra?: React.ReactNode;
  error?: string;
  hint?: string;
  className?: string;
  children: (props: FieldRenderProps) => React.ReactNode;
}) {
  const reactId = React.useId();
  const id = `f${reactId}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={className ? `space-y-1.5 ${className}` : "space-y-1.5"}>
      {labelExtra ? (
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id}>{label}</Label>
          {labelExtra}
        </div>
      ) : (
        <Label htmlFor={id}>{label}</Label>
      )}
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Chip-input: Enter/coma agrega, click en la × quita. Sin librería nueva —
 * mismo patrón de Badge + Input que el resto del catálogo.
 */
export function TagsInput({
  id,
  value,
  onChange,
  placeholder,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  "aria-invalid"?: true | undefined;
  "aria-describedby"?: string | undefined;
}) {
  const [draft, setDraft] = React.useState("");

  const commit = () => {
    const term = draft.trim();
    setDraft("");
    if (!term) return;
    if (value.includes(term)) return;
    onChange([...value, term]);
  };

  return (
    // Mismo límite de control que `Input` (border-input, rounded-lg, h-10) y el
    // mismo foco (borde a 2px en foreground), vía focus-within porque el foco
    // real vive en el <input> interno. El estado inválido va en el <input>
    // (aria-invalid en un div no significa nada para el lector) y aquí solo
    // se pinta el borde.
    <div
      className={cn(
        "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5",
        "focus-within:border-2 focus-within:border-foreground",
        ariaInvalid && "border-destructive focus-within:border-destructive",
      )}
    >
      {value.map((term) => (
        <Badge key={term} variant="secondary" className="gap-1 pr-1">
          {term}
          <button
            type="button"
            onClick={() => onChange(value.filter((t) => t !== term))}
            aria-label={`Quitar ${term}`}
            className="rounded-full p-0.5 transition-colors hover:bg-neutral-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <input
        id={id}
        value={draft}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={value.length === 0 ? placeholder : undefined}
        className="min-w-[8ch] flex-1 border-0 bg-transparent p-0.5 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export const CATALOG_STATUS_OPTIONS: Array<{ value: CatalogStatus; label: string }> = [
  { value: "DRAFT", label: "Borrador" },
  { value: "ACTIVE", label: "Activo" },
  { value: "ARCHIVED", label: "Archivado" },
];

/** Textos de ayuda de los campos no obvios del catálogo (compartidos por alta, edición y variantes). */
export const CATALOG_FIELD_HELP = {
  sku: "Clave única del producto. Solo letras, números y . _ - ; se usa para buscar y para importar/exportar.",
  satProductCode:
    "Clave de producto o servicio del catálogo del SAT (8 dígitos). Se usa al facturar; si no facturas, puedes dejarla vacía.",
  satUnitCode:
    "Clave de unidad del SAT (p. ej. H87 = pieza, KGM = kilogramo). Necesaria para el CFDI.",
  stock:
    "Existencias disponibles. Vacío = sin control de inventario: el producto se vende siempre y no se descuenta nada.",
  status:
    "Borrador: no se ofrece. Activo: el agente lo cotiza y se vende. Archivado: oculto, pero conserva su historial.",
  originSystem:
    "Tienda o ERP de donde viene el producto (Shopify, SAP…). Sirve para conciliar cuando sincronizas catálogos.",
} as const;
