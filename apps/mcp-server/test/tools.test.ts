import { describe, it, expect } from "vitest";
import { routeInputShape } from "../src/tools.js";
import type { RouteDef } from "../src/registry/types.js";

// Helper: en los tests conozco las keys literales del shape. La base de TS
// tiene `noUncheckedIndexedAccess: true`, así que cada `shape[key]` es
// `T | undefined`. Estos `!` son seguros por construcción (las keys las
// escribimos nosotros arriba).
const get = <T>(shape: Record<string, T>, key: string): T => shape[key]!;

describe("routeInputShape", () => {
  it("marca path params como required y query/body como opcionales", () => {
    const route: RouteDef = {
      name: "test",
      method: "GET",
      path: "/foo/:id",
      description: "test",
      scopes: [],
      pathParams: { id: { type: "string" } },
      query: { q: { type: "string" } },
      body: { name: { type: "string" } },
    };
    const shape = routeInputShape(route);
    expect(get(shape, "id").safeParse(undefined).success).toBe(false);
    expect(get(shape, "id").safeParse("x").success).toBe(true);
    expect(get(shape, "q").safeParse(undefined).success).toBe(true);
    expect(get(shape, "q").safeParse("x").success).toBe(true);
    expect(get(shape, "name").safeParse(undefined).success).toBe(true);
    expect(get(shape, "name").safeParse("x").success).toBe(true);
  });

  it("respeta required explícito en query/body", () => {
    const route: RouteDef = {
      name: "test",
      method: "POST",
      path: "/foo",
      description: "test",
      scopes: [],
      body: { name: { type: "string", required: true } },
    };
    const shape = routeInputShape(route);
    expect(get(shape, "name").safeParse(undefined).success).toBe(false);
    expect(get(shape, "name").safeParse("ok").success).toBe(true);
  });

  it("unión de pathParams + query + body en una sola shape", () => {
    const route: RouteDef = {
      name: "test",
      method: "GET",
      path: "/foo/:id",
      description: "test",
      scopes: [],
      pathParams: { id: { type: "string" } },
      query: { q: { type: "string" } },
      body: { name: { type: "string" } },
    };
    const shape = routeInputShape(route);
    expect(Object.keys(shape).sort()).toEqual(["id", "name", "q"]);
  });

  it("arrays no quedan envueltos en .optional() aunque el campo sea required:false", () => {
    // Bug conocido que ya está fixeado: items de array nunca son opcionales
    // (required en items no tiene sentido). Si se re-rompe, zod-to-json-schema
    // emite `anyOf:[{not:{}},{...}]` y la tool queda con schema roto.
    const route: RouteDef = {
      name: "test",
      method: "POST",
      path: "/foo",
      description: "test",
      scopes: [],
      body: {
        tags: {
          type: "array",
          // intentionally NOT required
          items: { type: "string" },
        },
      },
    };
    const shape = routeInputShape(route);
    // El campo `tags` es opcional (no required), pero su contenido (el array
    // en sí, una vez presente) exige items string no-undefined.
    expect(get(shape, "tags").safeParse(undefined).success).toBe(true); // tags omitido OK
    expect(get(shape, "tags").safeParse([]).success).toBe(true); // array vacío OK
    expect(get(shape, "tags").safeParse(["a", "b"]).success).toBe(true); // strings OK
    expect(get(shape, "tags").safeParse([1, 2]).success).toBe(false); // números NO
    expect(get(shape, "tags").safeParse(["a", undefined]).success).toBe(false); // item undefined NO
  });

  it("objetos anidados respetan required interno", () => {
    const route: RouteDef = {
      name: "test",
      method: "POST",
      path: "/foo",
      description: "test",
      scopes: [],
      body: {
        address: {
          type: "object",
          fields: {
            line1: { type: "string", required: true },
            line2: { type: "string" },
          },
        },
      },
    };
    const shape = routeInputShape(route);
    expect(get(shape, "address").safeParse({ line1: "x" }).success).toBe(true); // line2 ausente OK
    expect(get(shape, "address").safeParse({ line2: "x" }).success).toBe(false); // line1 falta NO
    expect(get(shape, "address").safeParse({ line1: "x", line2: "y" }).success).toBe(true);
  });

  it("enums se traducen a z.enum (rechaza valores fuera del set)", () => {
    const route: RouteDef = {
      name: "test",
      method: "POST",
      path: "/foo",
      description: "test",
      scopes: [],
      body: { status: { type: "string", enum: ["A", "B", "C"] } },
    };
    const shape = routeInputShape(route);
    expect(get(shape, "status").safeParse("A").success).toBe(true);
    expect(get(shape, "status").safeParse("B").success).toBe(true);
    expect(get(shape, "status").safeParse("D").success).toBe(false);
    expect(get(shape, "status").safeParse(1).success).toBe(false);
  });

  it("numbers aceptan números pero rechazan strings y viceversa", () => {
    const route: RouteDef = {
      name: "test",
      method: "POST",
      path: "/foo",
      description: "test",
      scopes: [],
      body: { n: { type: "number" }, s: { type: "string" } },
    };
    const shape = routeInputShape(route);
    expect(get(shape, "n").safeParse(1).success).toBe(true);
    expect(get(shape, "n").safeParse("1").success).toBe(false);
    expect(get(shape, "s").safeParse(1).success).toBe(false);
    expect(get(shape, "s").safeParse("1").success).toBe(true);
  });

  it("booleans aceptan boolean y rechazan todo lo demás", () => {
    const route: RouteDef = {
      name: "test",
      method: "POST",
      path: "/foo",
      description: "test",
      scopes: [],
      body: { b: { type: "boolean" } },
    };
    const shape = routeInputShape(route);
    expect(get(shape, "b").safeParse(true).success).toBe(true);
    expect(get(shape, "b").safeParse(false).success).toBe(true);
    expect(get(shape, "b").safeParse("true").success).toBe(false);
    expect(get(shape, "b").safeParse(1).success).toBe(false);
  });

  it("any acepta cualquier cosa (escape hatch documentado)", () => {
    const route: RouteDef = {
      name: "test",
      method: "POST",
      path: "/foo",
      description: "test",
      scopes: [],
      body: { blob: { type: "any" } },
    };
    const shape = routeInputShape(route);
    expect(get(shape, "blob").safeParse({ whatever: 1 }).success).toBe(true);
    expect(get(shape, "blob").safeParse("string").success).toBe(true);
    expect(get(shape, "blob").safeParse([1, 2, 3]).success).toBe(true);
    expect(get(shape, "blob").safeParse(null).success).toBe(true);
  });

  it("campo sin description no rompe (description opcional)", () => {
    const route: RouteDef = {
      name: "test",
      method: "POST",
      path: "/foo",
      description: "test",
      scopes: [],
      body: { name: { type: "string", required: true } },
    };
    const shape = routeInputShape(route);
    expect(get(shape, "name").safeParse("ok").success).toBe(true);
  });
});