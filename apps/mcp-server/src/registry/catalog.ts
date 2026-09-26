import type { RouteDef } from "./types.js";

const variantFields = {
  sku: { type: "string" as const, required: true, description: "Único por producto. Letras, números, punto, guion y guion bajo." },
  title: { type: "string" as const, required: true },
  price: { type: "string" as const, required: true, description: "Formato NN.NN, p. ej. \"149.00\"." },
  satProductCode: { type: "string" as const, description: "8 dígitos (clave de producto SAT)." },
  satUnitCode: { type: "string" as const, description: "Clave de unidad SAT, p. ej. \"H87\"." },
  stock: { type: "string" as const, description: "Existencia inicial (hasta 3 decimales). Ausente = sin control de inventario (EXTERNAL)." },
  originSystem: { type: "string" as const, description: "Sistema de origen (ecommerce/ERP), si el producto viene de una integración." },
  originExternalId: { type: "string" as const, description: "ID de este producto/variante en el sistema de origen." },
};

export const catalogRoutes: RouteDef[] = [
  {
    name: "catalog_list_products",
    method: "GET",
    path: "/catalog/products",
    description: "Lista productos del catálogo del tenant, paginado por cursor. Cada producto trae sus variantes.",
    scopes: ["catalog.read"],
    query: {
      q: { type: "string", description: "Búsqueda por título, SKU o sinónimo." },
      status: { type: "string", enum: ["DRAFT", "ACTIVE", "ARCHIVED"] },
      cursor: { type: "string", description: "pageInfo.nextCursor de la respuesta anterior." },
      limit: { type: "number", description: "Máximo por página (el backend lo topa a 100)." },
    },
  },
  {
    name: "catalog_get_product",
    method: "GET",
    path: "/catalog/products/:id",
    description: "Detalle de un producto por id, con todas sus variantes.",
    scopes: ["catalog.read"],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "catalog_create_product",
    method: "POST",
    path: "/catalog/products",
    description:
      "Crea un producto con al menos una variante. Nota: commerce-api exige un usuario humano en sesión " +
      "para este endpoint (`requireUser()`); una API key sin userId asociado recibe 403 aunque tenga catalog.write. " +
      "Usa el panel para alta de productos si esto falla.",
    scopes: ["catalog.write"],
    body: {
      sku: { type: "string", required: true },
      title: { type: "string", required: true },
      description: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      synonyms: { type: "array", items: { type: "string" } },
      satProductCode: { type: "string", description: "8 dígitos." },
      satUnitCode: { type: "string" },
      variants: {
        type: "array",
        required: true,
        description: "Al menos una variante.",
        items: { type: "object", fields: variantFields },
      },
    },
  },
  {
    name: "catalog_update_product",
    method: "PATCH",
    path: "/catalog/products/:id",
    description: "Actualiza campos de un producto (no sus variantes). Control de concurrencia optimista por expectedVersion.",
    scopes: ["catalog.write"],
    pathParams: { id: { type: "string" } },
    body: {
      expectedVersion: { type: "number", required: true, description: "Versión que el cliente cree tener; si no coincide, 409." },
      title: { type: "string" },
      description: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      synonyms: { type: "array", items: { type: "string" } },
      status: { type: "string", enum: ["DRAFT", "ACTIVE", "ARCHIVED"] },
    },
  },
  {
    name: "catalog_add_variant",
    method: "POST",
    path: "/catalog/products/:id/variants",
    description: "Agrega una variante nueva a un producto existente.",
    scopes: ["catalog.write"],
    pathParams: { id: { type: "string", description: "id del producto" } },
    body: variantFields,
  },
  {
    name: "catalog_update_variant",
    method: "PATCH",
    path: "/catalog/variants/:id",
    description:
      "Actualiza una variante. Control de concurrencia optimista por expectedVersion. " +
      "Limitación: desde esta tool no se puede poner stock/originSystem/originExternalId en null " +
      "(quitar el dato); usa el panel para eso.",
    scopes: ["catalog.write"],
    pathParams: { id: { type: "string" } },
    body: {
      expectedVersion: { type: "number", required: true },
      title: { type: "string" },
      price: { type: "string", description: "Formato NN.NN." },
      stock: { type: "string", description: "Existencia exacta (hasta 3 decimales)." },
      satProductCode: { type: "string" },
      satUnitCode: { type: "string" },
      status: { type: "string", enum: ["DRAFT", "ACTIVE", "ARCHIVED"] },
      originSystem: { type: "string" },
      originExternalId: { type: "string" },
    },
  },
  {
    name: "catalog_delete_image",
    method: "DELETE",
    path: "/catalog/images/:id",
    description: "Borra una foto de producto o de variante por id de imagen.",
    scopes: ["catalog.write"],
    pathParams: { id: { type: "string" } },
  },
  {
    name: "catalog_dry_run_import",
    method: "POST",
    path: "/catalog/imports/dry-run",
    description:
      "Valida (sin guardar nada) un lote de filas crudas de importación de catálogo, columna→valor tal cual vendrían de un CSV. " +
      "Devuelve por fila qué se crearía/actualizaría y qué errores tiene. Máximo 10 000 filas.",
    scopes: ["catalog.write"],
    body: {
      rows: {
        type: "array",
        required: true,
        description: "Cada fila es un objeto plano string→string (columna del CSV → valor).",
        items: { type: "any" },
      },
    },
  },
  {
    name: "catalog_archive_product",
    method: "DELETE",
    path: "/catalog/products/:id",
    description: "Archiva un producto (borrado lógico: status pasa a ARCHIVED, no se elimina de la base).",
    scopes: ["catalog.write"],
    pathParams: { id: { type: "string" } },
  },
];
