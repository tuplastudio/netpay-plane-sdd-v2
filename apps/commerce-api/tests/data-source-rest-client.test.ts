import { describe, expect, it } from "vitest";
import { parseRestConfig } from "../src/data-sources/data-source-config.js";
import { DataSourceHttpError, buildAuthHeaders, httpRequest } from "../src/data-sources/http-client.js";
import { buildPageUrl, fetchRestItems, joinUrl } from "../src/data-sources/rest-client.js";

const noGuard = async () => undefined;
const noSleep = async () => undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** fetch falso que registra las URLs pedidas y responde según la cola. */
function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fetchImpl };
}

const conn = {
  baseUrl: "https://api.example.com/v1/",
  auth: { authType: "BEARER" as const, credential: "tok", authHeaderName: null, headers: { "X-Shop": "mx" } },
};

describe("REST: URL y headers", () => {
  it("une base y ruta sin duplicar barras y respeta URLs absolutas", () => {
    expect(joinUrl("https://api.example.com/v1/", "/products")).toBe("https://api.example.com/v1/products");
    expect(joinUrl("https://api.example.com/v1", "products")).toBe("https://api.example.com/v1/products");
    expect(joinUrl("https://api.example.com", "https://other.example.com/x")).toBe("https://other.example.com/x");
  });

  it("arma query fija + parámetros de página", () => {
    const config = parseRestConfig({
      listPath: "/products",
      query: { status: "active" },
      pagination: { type: "page", pageParam: "page", sizeParam: "limit", pageSize: 50 },
      fieldMap: { sku: "s", name: "n", price: "p" },
    });
    expect(buildPageUrl(conn, config, { pageNumber: 2 })).toBe(
      "https://api.example.com/v1/products?status=active&page=2&limit=50",
    );
  });

  it("autenticación por tipo; los headers extra no pisan Authorization", () => {
    expect(buildAuthHeaders(conn.auth)).toEqual({ "X-Shop": "mx", authorization: "Bearer tok" });
    expect(
      buildAuthHeaders({ authType: "API_KEY_HEADER", credential: "k", authHeaderName: "X-API-Key", headers: null }),
    ).toEqual({ "X-API-Key": "k" });
    expect(
      buildAuthHeaders({ authType: "BASIC", credential: "u:p", authHeaderName: null, headers: { Authorization: "hack" } }),
    ).toEqual({ authorization: `Basic ${Buffer.from("u:p").toString("base64")}` });
  });
});

describe("REST: paginación", () => {
  it("por página: sigue hasta una página incompleta y concatena", async () => {
    const pages: Record<string, unknown[]> = {
      "1": [{ sku: "A" }, { sku: "B" }],
      "2": [{ sku: "C" }, { sku: "D" }],
      "3": [{ sku: "E" }],
    };
    const { calls, fetchImpl } = fakeFetch((url) => {
      const page = new URL(url).searchParams.get("page") ?? "1";
      return jsonResponse({ data: pages[page] ?? [] });
    });
    const config = parseRestConfig({
      listPath: "/products",
      itemsJsonPath: "data",
      pagination: { type: "page", pageParam: "page", sizeParam: "limit", pageSize: 2 },
      fieldMap: { sku: "sku", name: "sku", price: "=1" },
    });
    const result = await fetchRestItems(conn, config, { fetchImpl, guard: noGuard, sleep: noSleep });
    expect(result.items.map((i) => (i as { sku: string }).sku)).toEqual(["A", "B", "C", "D", "E"]);
    expect(result.pages).toBe(3);
    expect(calls[0]!.init.headers).toMatchObject({ authorization: "Bearer tok", "X-Shop": "mx" });
  });

  it("por cursor: manda el cursor devuelto y para cuando no hay siguiente", async () => {
    const { calls, fetchImpl } = fakeFetch((url) => {
      const cursor = new URL(url).searchParams.get("after");
      if (!cursor) return jsonResponse({ items: [{ sku: "A" }], meta: { next: "c2" } });
      if (cursor === "c2") return jsonResponse({ items: [{ sku: "B" }], meta: { next: null } });
      throw new Error("cursor inesperado");
    });
    const config = parseRestConfig({
      listPath: "/products",
      itemsJsonPath: "items",
      pagination: { type: "cursor", cursorParam: "after", nextCursorPath: "meta.next" },
      fieldMap: { sku: "sku", name: "sku", price: "=1" },
    });
    const result = await fetchRestItems(conn, config, { fetchImpl, guard: noGuard, sleep: noSleep });
    expect(result.items).toHaveLength(2);
    expect(calls.map((c) => new URL(c.url).searchParams.get("after"))).toEqual([null, "c2"]);
  });

  it("respeta maxItems y maxPages (prueba de conexión)", async () => {
    const { calls, fetchImpl } = fakeFetch(() => jsonResponse([{ sku: "A" }, { sku: "B" }, { sku: "C" }]));
    const config = parseRestConfig({
      listPath: "/products",
      pagination: { type: "page", pageParam: "p" },
      fieldMap: { sku: "sku", name: "sku", price: "=1" },
    });
    const result = await fetchRestItems(conn, config, { fetchImpl, guard: noGuard, sleep: noSleep, maxItems: 2, maxPages: 1 });
    expect(result.items).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });

  it("falla claro si itemsJsonPath no existe en la respuesta", async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse({ products: [] }));
    const config = parseRestConfig({ listPath: "/p", itemsJsonPath: "data.items", fieldMap: { sku: "s", name: "n", price: "p" } });
    await expect(fetchRestItems(conn, config, { fetchImpl, guard: noGuard })).rejects.toThrow(/itemsJsonPath/);
  });
});

describe("HTTP: timeout, reintentos y guard", () => {
  it("reintenta en 5xx/429 con backoff y devuelve la respuesta buena", async () => {
    let n = 0;
    const slept: number[] = [];
    const { fetchImpl } = fakeFetch(() => {
      n += 1;
      return n < 3 ? jsonResponse({ error: "busy" }, n === 1 ? 503 : 429) : jsonResponse({ ok: true });
    });
    const res = await httpRequest("https://api.example.com/x", { method: "GET" }, {
      fetchImpl,
      guard: noGuard,
      retries: 2,
      retryBaseMs: 100,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(res.status).toBe(200);
    expect(slept).toEqual([100, 200]);
  });

  it("no reintenta 4xx y expone el status", async () => {
    let n = 0;
    const { fetchImpl } = fakeFetch(() => {
      n += 1;
      return jsonResponse({}, 401);
    });
    await expect(httpRequest("https://api.example.com/x", {}, { fetchImpl, guard: noGuard, sleep: noSleep })).rejects.toMatchObject({
      status: 401,
      retryable: false,
    });
    expect(n).toBe(1);
  });

  it("agota reintentos ante errores de red y trata redirecciones como error", async () => {
    let n = 0;
    const { fetchImpl } = fakeFetch(() => {
      n += 1;
      throw new Error("ECONNRESET");
    });
    await expect(httpRequest("https://api.example.com/x", {}, { fetchImpl, guard: noGuard, sleep: noSleep, retries: 1 })).rejects.toThrow(
      /ECONNRESET/,
    );
    expect(n).toBe(2);

    const redirect = fakeFetch(() => new Response(null, { status: 302, headers: { location: "http://10.0.0.1/" } }));
    await expect(httpRequest("https://api.example.com/x", {}, { fetchImpl: redirect.fetchImpl, guard: noGuard })).rejects.toBeInstanceOf(
      DataSourceHttpError,
    );
  });

  it("valida la URL con el guard antes de cada intento", async () => {
    const seen: string[] = [];
    const { fetchImpl } = fakeFetch(() => jsonResponse({}));
    await httpRequest("https://api.example.com/x", {}, {
      fetchImpl,
      guard: async (url) => {
        seen.push(url);
      },
    });
    expect(seen).toEqual(["https://api.example.com/x"]);
    await expect(
      httpRequest("http://169.254.169.254/latest", {}, { fetchImpl, guard: async () => { throw new Error("bloqueada"); } }),
    ).rejects.toThrow(/bloqueada/);
  });
});
