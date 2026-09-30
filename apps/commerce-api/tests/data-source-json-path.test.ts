import { describe, expect, it } from "vitest";
import { getJsonPath, isValidJsonPath, parseJsonPath } from "../src/data-sources/json-path.js";

const doc = {
  data: {
    items: [
      { sku: "A-1", price: { amount: 10 }, images: [{ url: "https://x/1.png" }, { url: "https://x/2.png" }] },
      { sku: "B-2", price: { amount: 20 }, images: [] },
    ],
    "Precio.Base": 5,
  },
  meta: { next: "abc" },
};

describe("JSONPath mínimo", () => {
  it("resuelve rutas por punto, índice y raíz", () => {
    expect(getJsonPath(doc, "data.items[0].sku")).toBe("A-1");
    expect(getJsonPath(doc, "$.data.items[1].price.amount")).toBe(20);
    expect(getJsonPath(doc, "data.items[-1].sku")).toBe("B-2");
    expect(getJsonPath(doc, "")).toBe(doc);
    expect(getJsonPath(doc, "$")).toBe(doc);
  });

  it("devuelve undefined cuando la ruta no existe (sin lanzar)", () => {
    expect(getJsonPath(doc, "data.nope.x")).toBeUndefined();
    expect(getJsonPath(doc, "data.items[9].sku")).toBeUndefined();
    expect(getJsonPath(null, "a.b")).toBeUndefined();
  });

  it("aplana con comodín y descarta los faltantes", () => {
    expect(getJsonPath(doc, "data.items[*].sku")).toEqual(["A-1", "B-2"]);
    expect(getJsonPath(doc, "data.items[*].images[*].url")).toEqual(["https://x/1.png", "https://x/2.png"]);
    expect(getJsonPath(doc, "data.items[*]")).toHaveLength(2);
  });

  it("admite claves entre comillas con puntos", () => {
    expect(getJsonPath(doc, 'data["Precio.Base"]')).toBe(5);
  });

  it("valida sintaxis", () => {
    expect(isValidJsonPath("a.b[0]")).toBe(true);
    expect(isValidJsonPath("a[")).toBe(false);
    expect(isValidJsonPath("a[x]")).toBe(false);
    expect(() => parseJsonPath("a[?(@.x)]")).toThrow(/no reconocido/);
  });
});
