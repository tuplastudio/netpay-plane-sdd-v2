import type { Iso8601, Money, PageInput, Quantity, ResourceId, TenantId } from "./common.js";

export interface ProductSummary {
  id: ResourceId;
  tenantId: TenantId;
  sku: string;
  title: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  hasVariants: boolean;
  updatedAt: Iso8601;
}

export interface ProductVariant {
  id: ResourceId;
  productId: ResourceId;
  sku: string;
  title: string;
  price: Money;
  currency: "MXN";
  stock: Quantity | null; // null cuando inventario es EXTERNAL
  satProductCode: string; // c_ClaveProdServ
  satUnitCode: string; // c_ClaveUnidad
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
}

export interface CreateProductRequest {
  sku: string;
  title: string;
  description?: string;
  variants: Array<{
    sku: string;
    title: string;
    price: Money;
    satProductCode: string;
    satUnitCode: string;
  }>;
}

export interface SearchProductsRequest extends PageInput {
  q?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
}