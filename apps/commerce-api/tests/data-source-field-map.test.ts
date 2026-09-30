import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { extractItems, mapItem, parseActive, parseNumber } from "../src/data-sources/field-map.js";
import { parseDataSourceConfig, parseRestConfig } from "../src/data-sources/data-source-config.js";

const fieldMap = {
  sku: "code",
  name: "title",
  price: "pricing.amount",
  currency: "pricing.currency",
  stock: "inventory.qty",
  description: "desc",
  imageUrl: "images[*].src",
  category: "category.name",
  active: "isActive",
  externalId: "id",
};

describe("fieldMap → producto normalizado", () => {
  it("mapea y normaliza tipos", () => {
    const result = mapItem(
      {
        id: 77,
        code: " ABC-1 ",
        title: "Tornillo 1/4",
        pricing: { amount: "1,250.5", currency: "mxn" },
        inventory: { qty: "12" },
        desc: "Acero",
        images: [{ src: "https://cdn.example.com/a.png" }, { src: "ftp://no" }],
        category: { name: "Ferretería" },
        isActive: "true",
      },
      fieldMap,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item).toEqual({
      sku: "ABC-1",
      externalId: "77",
      name: "Tornillo 1/4",
      description: "Acero",
      price: "1250.50",
      currency: "MXN",
      stock: "12.000",
      imageUrls: ["https://cdn.example.com/a.png"],
      category: "ferretería",
      active: true,
    });
  });

  it("usa defaults: moneda MXN, externalId = sku, activo", () => {
    const result = mapItem({ code: "X", title: "Y", pricing: { amount: 3 } }, { sku: "code", name: "title", price: "pricing.amount" });
    expect(result).toEqual({
      ok: true,
      item: {
        sku: "X",
        externalId: "X",
        name: "Y",
        description: null,
        price: "3.00",
        currency: "MXN",
        stock: null,
        imageUrls: [],
        category: null,
        active: true,
      },
    });
  });

  it("acepta literales con prefijo =", () => {
    const result = mapItem({ code: "X", title: "Y", p: 1 }, { sku: "code", name: "title", price: "p", currency: "=usd" });
    expect(result.ok && result.item.currency).toBe("USD");
  });

  it("reporta errores sin lanzar", () => {
    expect(mapItem({ title: "sin sku", p: 1 }, { sku: "code", name: "title", price: "p" })).toEqual({
      ok: false,
      error: expect.stringContaining("sku vacío"),
    });
    expect(mapItem({ code: "A", p: "gratis" }, { sku: "code", name: "code", price: "p" })).toEqual({
      ok: false,
      error: expect.stringContaining("price inválido"),
    });
    expect(mapItem({ code: "A", p: 1, c: "pesos" }, { sku: "code", name: "code", price: "p", currency: "c" })).toEqual({
      ok: false,
      error: expect.stringContaining("currency inválida"),
    });
  });

  it("parseNumber y parseActive toleran formatos comunes", () => {
    expect(parseNumber("$1,234.56")).toBe(1234.56);
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("abc")).toBeNull();
    expect(parseActive(undefined)).toBe(true);
    expect(parseActive("inactive")).toBe(false);
    expect(parseActive(0)).toBe(false);
    expect(parseActive("yes")).toBe(true);
  });

  it("extractItems admite raíz, ruta y objeto suelto", () => {
    expect(extractItems([{ a: 1 }], "")).toEqual([{ a: 1 }]);
    expect(extractItems({ data: { items: [1, 2] } }, "data.items")).toEqual([1, 2]);
    expect(extractItems({ data: { item: { a: 1 } } }, "data.item")).toEqual([{ a: 1 }]);
    expect(extractItems({ data: {} }, "data.items")).toEqual([]);
  });
});

describe("validación de config", () => {
  it("REST: normaliza defaults y paginación", () => {
    const config = parseRestConfig({
      listPath: "/products",
      itemsJsonPath: "data",
      pagination: { type: "page", pageParam: "page", sizeParam: "limit", pageSize: 100 },
      fieldMap: { sku: "sku", name: "name", price: "price", description: "" },
    });
    expect(config.method).toBe("GET");
    expect(config.pagination).toEqual({
      type: "page",
      pageParam: "page",
      sizeParam: "limit",
      pageSize: 100,
      startPage: undefined,
      maxPages: undefined,
    });
    expect(config.fieldMap).toEqual({ sku: "sku", name: "name", price: "price" });
  });

  it("rechaza fieldMap incompleto, rutas inválidas y campos desconocidos", () => {
    expect(() => parseRestConfig({ listPath: "/p", fieldMap: { sku: "sku", name: "name" } })).toThrow(BadRequestException);
    expect(() => parseRestConfig({ listPath: "/p", fieldMap: { sku: "sku[", name: "n", price: "p" } })).toThrow(/ruta inválida/);
    expect(() => parseRestConfig({ listPath: "/p", fieldMap: { sku: "s", name: "n", price: "p", color: "c" } })).toThrow(/no es un campo conocido/);
    expect(() => parseRestConfig({ listPath: "/p", pagination: { type: "cursor" }, fieldMap: { sku: "s", name: "n", price: "p" } })).toThrow(/cursorParam/);
  });

  it("MCP: exige toolName", () => {
    expect(() => parseDataSourceConfig("MCP", { fieldMap: { sku: "s", name: "n", price: "p" } })).toThrow(/toolName/);
    const config = parseDataSourceConfig("MCP", {
      toolName: "list_products",
      toolArgs: { limit: 500 },
      itemsJsonPath: "products",
      fieldMap: { sku: "s", name: "n", price: "p" },
    });
    expect(config).toMatchObject({ toolName: "list_products", toolArgs: { limit: 500 }, itemsJsonPath: "products" });
  });
});
