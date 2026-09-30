import type {
  AddVariantValues,
  CreateValues,
  EditProductValues,
  VariantValues,
} from "../catalog-shared";
import { resolveOriginSystem } from "./origin-system";

/**
 * Del formulario (strings, vacíos = "no aplica") al cuerpo que espera
 * commerce-api. Separado del componente para que la traducción se pueda
 * probar: aquí se decide qué campo va como `undefined` (no mandar), cuál va
 * como `null` (borrar) y cuál se recorta.
 */

const blank = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

export interface VariantPayload {
  sku: string;
  title: string;
  price: string;
  stock?: string;
  satProductCode?: string;
  satUnitCode?: string;
  originSystem?: string;
  originExternalId?: string;
}

export interface CreateProductPayload {
  sku: string;
  title: string;
  description?: string;
  tags: string[];
  synonyms: string[];
  variants: VariantPayload[];
}

/** POST /catalog/products. Una sola variante inicial (la del formulario). */
export function toCreateProductPayload(v: CreateValues): CreateProductPayload {
  return {
    sku: v.sku.trim(),
    title: v.title.trim(),
    description: blank(v.description),
    tags: v.tags,
    synonyms: v.synonyms,
    variants: [
      toAddVariantPayload({
        sku: v.variantSku,
        title: v.variantTitle,
        price: v.price,
        stock: v.stock,
        satProductCode: v.satProductCode,
        satUnitCode: v.satUnitCode,
        originSystem: v.originSystem,
        originSystemOther: v.originSystemOther,
        originExternalId: v.originExternalId,
      }),
    ],
  };
}

/** POST /catalog/products/:id/variants. */
export function toAddVariantPayload(v: AddVariantValues): VariantPayload {
  return {
    sku: v.sku.trim(),
    title: v.title.trim(),
    price: v.price.trim(),
    stock: blank(v.stock),
    satProductCode: blank(v.satProductCode),
    satUnitCode: blank(v.satUnitCode),
    originSystem: blank(resolveOriginSystem(v)),
    originExternalId: blank(v.originExternalId),
  };
}

export interface UpdateProductPayload {
  expectedVersion: number;
  title: string;
  description?: string;
  tags: string[];
  synonyms: string[];
  status: EditProductValues["status"];
}

/** PATCH /catalog/products/:id. */
export function toUpdateProductPayload(v: EditProductValues, expectedVersion: number): UpdateProductPayload {
  return {
    expectedVersion,
    title: v.title.trim(),
    description: blank(v.description),
    tags: v.tags,
    synonyms: v.synonyms,
    status: v.status,
  };
}

export interface UpdateVariantPayload {
  expectedVersion: number;
  title: string;
  price: string;
  /** `null` = quitar el control de inventario (el formulario siempre resuelve el valor). */
  stock: string | null;
  satProductCode?: string;
  satUnitCode?: string;
  status: VariantValues["status"];
  /** `null` = ya no viene de un sistema externo. */
  originSystem: string | null;
  originExternalId: string | null;
}

/**
 * PATCH /catalog/variants/:id. A diferencia del alta, un campo vacío aquí
 * significa "bórralo" (`null`), no "no lo toques": el formulario siempre
 * trae el valor completo de la variante.
 */
export function toUpdateVariantPayload(v: VariantValues, expectedVersion: number): UpdateVariantPayload {
  return {
    expectedVersion,
    title: v.title.trim(),
    price: v.price.trim(),
    stock: blank(v.stock) ?? null,
    satProductCode: blank(v.satProductCode),
    satUnitCode: blank(v.satUnitCode),
    status: v.status,
    originSystem: blank(resolveOriginSystem(v)) ?? null,
    originExternalId: blank(v.originExternalId) ?? null,
  };
}

/**
 * Sugerencia de SKU de variante a partir del SKU del producto, mientras el
 * usuario no haya escrito uno propio: `PINT-MATE` → `PINT-MATE-1`.
 */
export function suggestVariantSku(productSku: string): string {
  const base = productSku.trim();
  return base ? `${base}-1`.slice(0, 64) : "";
}
